use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{self, BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStderr, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::Duration,
};

use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    contracts::{ApiError, BackendInfo, ConnectionState, DeviceEvent, ErrorCode, PROTOCOL_VERSION},
    lifecycle::tray_image,
    state::AppState,
};

const MAX_LINE_BYTES: usize = 64 * 1024;
const MAX_LOG_BYTES: u64 = 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
const SLOW_REQUEST_TIMEOUT: Duration = Duration::from_secs(45);
type PendingSender = mpsc::Sender<Result<Value, ApiError>>;

struct BackendProcess {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
}

struct ClientInner {
    process: Mutex<Option<BackendProcess>>,
    startup: Mutex<()>,
    pending: Mutex<HashMap<String, PendingSender>>,
    next_id: AtomicU64,
    healthy: AtomicBool,
    stopping: AtomicBool,
    app: Mutex<Option<AppHandle>>,
}

#[derive(Clone)]
pub struct BackendClient {
    inner: Arc<ClientInner>,
}

impl Default for BackendClient {
    fn default() -> Self {
        Self {
            inner: Arc::new(ClientInner {
                process: Mutex::new(None),
                startup: Mutex::new(()),
                pending: Mutex::new(HashMap::new()),
                next_id: AtomicU64::new(1),
                healthy: AtomicBool::new(false),
                stopping: AtomicBool::new(false),
                app: Mutex::new(None),
            }),
        }
    }
}

impl BackendClient {
    pub fn attach_app(&self, app: AppHandle) {
        *self.inner.app.lock().expect("app mutex poisoned") = Some(app);
    }

    pub fn request<P, R>(&self, method: &'static str, params: &P) -> Result<R, ApiError>
    where
        P: Serialize,
        R: DeserializeOwned,
    {
        self.ensure_started()?;
        self.request_running(method, params)
    }

    fn request_running<P, R>(&self, method: &'static str, params: &P) -> Result<R, ApiError>
    where
        P: Serialize,
        R: DeserializeOwned,
    {
        let params = serde_json::to_value(params)
            .map_err(|_| ApiError::invalid("request could not be serialized"))?;
        let id = self
            .inner
            .next_id
            .fetch_add(1, Ordering::Relaxed)
            .to_string();
        let wire = serde_json::to_vec(&json!({
            "v": PROTOCOL_VERSION, "id": id, "method": method, "params": params
        }))
        .map_err(|_| ApiError::invalid("request could not be serialized"))?;
        if wire.len() + 1 > MAX_LINE_BYTES {
            return Err(ApiError::invalid("request is too large"));
        }

        let (sender, receiver) = mpsc::channel();
        self.inner
            .pending
            .lock()
            .map_err(|_| ApiError::internal("backend state is unavailable"))?
            .insert(id.clone(), sender);

        let write_result = (|| -> Result<(), ApiError> {
            let process = self
                .inner
                .process
                .lock()
                .map_err(|_| ApiError::backend_unavailable())?;
            let process = process.as_ref().ok_or_else(ApiError::backend_unavailable)?;
            let mut stdin = process
                .stdin
                .lock()
                .map_err(|_| ApiError::backend_unavailable())?;
            stdin
                .write_all(&wire)
                .and_then(|_| stdin.write_all(b"\n"))
                .and_then(|_| stdin.flush())
                .map_err(|_| ApiError::backend_crashed("The backend input stream closed"))
        })();
        if write_result.is_err() {
            self.inner
                .pending
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(&id));
            return Err(ApiError::backend_crashed("The backend input stream closed"));
        }

        let timeout = match method {
            "connect" | "discover" | "get_profiles" | "set_profile" | "delete_profile" => {
                SLOW_REQUEST_TIMEOUT
            }
            _ => REQUEST_TIMEOUT,
        };
        let value = match receiver.recv_timeout(timeout) {
            Ok(result) => result?,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.inner
                    .pending
                    .lock()
                    .ok()
                    .and_then(|mut pending| pending.remove(&id));
                return Err(ApiError::timeout());
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(ApiError::backend_crashed("The backend exited"));
            }
        };
        serde_json::from_value(value)
            .map_err(|_| ApiError::backend_crashed("The backend returned invalid data"))
    }

    fn ensure_started(&self) -> Result<(), ApiError> {
        let _startup = self
            .inner
            .startup
            .lock()
            .map_err(|_| ApiError::backend_unavailable())?;
        {
            let process = self
                .inner
                .process
                .lock()
                .map_err(|_| ApiError::backend_unavailable())?;
            if process.is_some() && self.inner.healthy.load(Ordering::Acquire) {
                return Ok(());
            }
        }
        self.stop_process();
        self.inner.stopping.store(false, Ordering::Release);
        let (child, stdin, stdout, stderr) = spawn_backend()?;
        let stdin = Arc::new(Mutex::new(stdin));
        self.inner.healthy.store(true, Ordering::Release);
        {
            let mut process = self
                .inner
                .process
                .lock()
                .map_err(|_| ApiError::backend_unavailable())?;
            *process = Some(BackendProcess {
                child,
                stdin: stdin.clone(),
            });
        }
        let inner = self.inner.clone();
        thread::Builder::new()
            .name("bosectl-backend-reader".into())
            .spawn(move || read_backend(inner, stdout))
            .map_err(|_| ApiError::backend_unavailable())?;
        let log_path = self
            .inner
            .app
            .lock()
            .ok()
            .and_then(|app| app.clone())
            .and_then(|app| app.path().app_log_dir().ok())
            .map(|directory| directory.join("backend.log"));
        thread::Builder::new()
            .name("bosectl-backend-log".into())
            .spawn(move || drain_backend_log(stderr, log_path))
            .map_err(|_| ApiError::backend_unavailable())?;

        let hello: BackendInfo = match self.request_running::<_, BackendInfo>("hello", &json!({})) {
            Ok(info) if info.protocol_version == PROTOCOL_VERSION => info,
            Ok(_) => {
                self.stop_process();
                return Err(ApiError::new(
                    ErrorCode::UnsupportedProtocol,
                    "The backend protocol version is not supported",
                    false,
                ));
            }
            Err(error) => {
                self.stop_process();
                return Err(error);
            }
        };
        if hello.backend_version.chars().count() > 64
            || hello.python_version.chars().count() > 64
            || !hello.operations.iter().any(|method| method == "shutdown")
        {
            self.stop_process();
            return Err(ApiError::backend_crashed(
                "The backend handshake is incomplete",
            ));
        }
        Ok(())
    }

    pub fn shutdown(&self) {
        let _startup = match self.inner.startup.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        self.inner.stopping.store(true, Ordering::Release);
        if self.inner.healthy.load(Ordering::Acquire) {
            let _: Result<Value, ApiError> = self.request_running("shutdown", &json!({}));
        }
        self.stop_process();
    }

    fn stop_process(&self) {
        self.inner.stopping.store(true, Ordering::Release);
        self.inner.healthy.store(false, Ordering::Release);
        let process = self
            .inner
            .process
            .lock()
            .ok()
            .and_then(|mut process| process.take());
        if let Some(mut process) = process {
            drop(process.stdin);
            if process.child.try_wait().ok().flatten().is_none() {
                let _ = process.child.kill();
            }
            let _ = process.child.wait();
        }
        fail_pending(
            &self.inner,
            ApiError::backend_crashed("The backend stopped"),
        );
    }
}

fn read_backend(inner: Arc<ClientInner>, stdout: impl std::io::Read) {
    let mut reader = BufReader::new(stdout);
    loop {
        let line = match read_capped_line(&mut reader) {
            Ok(None) => break,
            Ok(Some(line)) => line,
            Err(error) if error.kind() == io::ErrorKind::InvalidData => {
                fail_all(
                    &inner,
                    ApiError::backend_crashed("The backend emitted an oversized message"),
                );
                break;
            }
            Err(_) => break,
        };
        let message: Value = match serde_json::from_slice(&line) {
            Ok(message) => message,
            Err(_) => {
                fail_all(
                    &inner,
                    ApiError::backend_crashed("The backend emitted malformed JSON"),
                );
                break;
            }
        };
        if message.get("v").and_then(Value::as_u64) != Some(PROTOCOL_VERSION.into()) {
            fail_all(
                &inner,
                ApiError::backend_crashed("The backend emitted an unsupported message"),
            );
            break;
        }
        if let Some(id) = message.get("id").and_then(Value::as_str) {
            let sender = inner
                .pending
                .lock()
                .ok()
                .and_then(|mut pending| pending.remove(id));
            if let Some(sender) = sender {
                let response = if let Some(result) = message.get("result") {
                    Ok(result.clone())
                } else if let Some(error) = message.get("error") {
                    serde_json::from_value::<ApiError>(error.clone()).map_or_else(
                        |_| {
                            Err(ApiError::backend_crashed(
                                "The backend returned an invalid error",
                            ))
                        },
                        Err,
                    )
                } else {
                    Err(ApiError::backend_crashed(
                        "The backend returned an invalid response",
                    ))
                };
                let _ = sender.send(response);
            }
            continue;
        }
        if message.get("event").is_some() {
            match serde_json::from_value::<DeviceEvent>(message) {
                Ok(event) if event.validate_wire().is_ok() => {
                    if let Some(app) = inner.app.lock().ok().and_then(|app| app.clone()) {
                        app.state::<AppState>().record_backend_event(&event);
                        update_tray_status(&app, &event);
                        let _ = app.emit_to("main", "bose://device-event", event);
                    }
                }
                _ => {
                    fail_all(
                        &inner,
                        ApiError::backend_crashed("The backend emitted an invalid event"),
                    );
                    break;
                }
            }
        }
    }
    inner.healthy.store(false, Ordering::Release);
    if !inner.stopping.load(Ordering::Acquire) {
        fail_all(
            &inner,
            ApiError::backend_crashed("The backend exited unexpectedly"),
        );
    }
}

enum TrayIconUpdate {
    Keep,
    Default,
    Battery(u8),
}

fn update_tray_status(app: &AppHandle, event: &DeviceEvent) {
    let (tooltip, icon_update) = match event {
        DeviceEvent::SnapshotChanged { data }
            if data.connection.state == ConnectionState::Connected =>
        {
            let name = data
                .identity
                .as_ref()
                .map_or("Headset", |identity| identity.name.as_str());
            let battery = data
                .battery
                .as_ref()
                .map(|battery| format!(" · {}%", battery.percent))
                .unwrap_or_default();
            let icon_update = data
                .battery
                .as_ref()
                .map_or(TrayIconUpdate::Default, |battery| {
                    TrayIconUpdate::Battery(battery.percent)
                });
            (format!("Bose Windows App · {name}{battery}"), icon_update)
        }
        DeviceEvent::ConnectionChanged { data } => match data.state {
            ConnectionState::Discovering => (
                "Bose Windows App · Discovering…".into(),
                TrayIconUpdate::Default,
            ),
            ConnectionState::Connecting | ConnectionState::Reconnecting => (
                "Bose Windows App · Connecting…".into(),
                TrayIconUpdate::Default,
            ),
            ConnectionState::Disconnecting => (
                "Bose Windows App · Disconnecting…".into(),
                TrayIconUpdate::Default,
            ),
            ConnectionState::Disconnected => (
                "Bose Windows App · Disconnected".into(),
                TrayIconUpdate::Default,
            ),
            ConnectionState::Error => (
                "Bose Windows App · Connection error".into(),
                TrayIconUpdate::Default,
            ),
            ConnectionState::Connected => {
                ("Bose Windows App · Connected".into(), TrayIconUpdate::Keep)
            }
        },
        DeviceEvent::BackendError { .. } => (
            "Bose Windows App · Backend error".into(),
            TrayIconUpdate::Default,
        ),
        DeviceEvent::SnapshotChanged { .. } => ("Bose Windows App".into(), TrayIconUpdate::Default),
    };
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(tooltip));
        match icon_update {
            TrayIconUpdate::Keep => {}
            TrayIconUpdate::Default => {
                let _ = tray.set_icon(Some(tray_image(None)));
            }
            TrayIconUpdate::Battery(percent) => {
                let _ = tray.set_icon(Some(tray_image(Some(percent))));
            }
        }
    }
}

fn read_capped_line<R: BufRead>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut line = Vec::new();
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok((!line.is_empty()).then_some(line));
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(available.len(), |position| position + 1);
        if line.len() + take > MAX_LINE_BYTES {
            reader.consume(take);
            if newline.is_none() {
                discard_line(reader)?;
            }
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "oversized backend line",
            ));
        }
        line.extend_from_slice(&available[..take]);
        reader.consume(take);
        if newline.is_some() {
            return Ok(Some(line));
        }
    }
}

fn discard_line<R: BufRead>(reader: &mut R) -> io::Result<()> {
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok(());
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(available.len(), |position| position + 1);
        reader.consume(take);
        if newline.is_some() {
            return Ok(());
        }
    }
}

fn fail_all(inner: &ClientInner, error: ApiError) {
    fail_pending(inner, error.clone());
    if let Some(app) = inner.app.lock().ok().and_then(|app| app.clone()) {
        let event = DeviceEvent::BackendError { data: error };
        app.state::<AppState>().record_backend_event(&event);
        update_tray_status(&app, &event);
        let _ = app.emit_to("main", "bose://device-event", event);
    }
}

fn fail_pending(inner: &ClientInner, error: ApiError) {
    if let Ok(mut pending) = inner.pending.lock() {
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(error.clone()));
        }
    }
}

fn drain_backend_log(stderr: ChildStderr, log_path: Option<PathBuf>) {
    let mut log = log_path.and_then(open_backend_log);
    let mut log_size = log
        .as_ref()
        .and_then(|file| file.metadata().ok())
        .map_or(0, |metadata| metadata.len());
    let mut reader = BufReader::new(stderr);
    loop {
        let line = match read_capped_line(&mut reader) {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(_) => {
                if let Some(log) = log.as_mut() {
                    let _ = writeln!(log, "backend log line discarded");
                }
                continue;
            }
        };
        if log.is_some() {
            let line = redact_sensitive(&line);
            let line = line.trim_end_matches(['\r', '\n']);
            let entry_bytes = line.len() as u64 + 2;
            if log_size.saturating_add(entry_bytes) <= MAX_LOG_BYTES {
                if let Some(file) = log.as_mut() {
                    let _ = writeln!(file, "{line}");
                }
                log_size += entry_bytes;
            } else {
                log = None;
            }
        }
    }
}

fn open_backend_log(path: PathBuf) -> Option<std::fs::File> {
    let directory = path.parent()?;
    fs::create_dir_all(directory).ok()?;
    if path
        .metadata()
        .is_ok_and(|metadata| metadata.len() >= MAX_LOG_BYTES)
    {
        let previous = directory.join("backend.previous.log");
        let _ = fs::remove_file(&previous);
        let _ = fs::rename(&path, previous);
    }
    OpenOptions::new().create(true).append(true).open(path).ok()
}

fn redact_sensitive(line: &[u8]) -> String {
    const REDACTED: &[u8] = b"[redacted Bluetooth address]";
    let mut output = Vec::with_capacity(line.len());
    let mut index = 0;
    while index < line.len() {
        if is_bluetooth_address_at(line, index) {
            output.extend_from_slice(REDACTED);
            index += 17;
        } else {
            output.push(line[index]);
            index += 1;
        }
    }
    String::from_utf8_lossy(&output).into_owned()
}

fn is_bluetooth_address_at(value: &[u8], start: usize) -> bool {
    if start + 17 > value.len() || (start > 0 && value[start - 1].is_ascii_hexdigit()) {
        return false;
    }
    for offset in 0..17 {
        let byte = value[start + offset];
        if (offset + 1) % 3 == 0 {
            if byte != b':' {
                return false;
            }
        } else if !byte.is_ascii_hexdigit() {
            return false;
        }
    }
    start + 17 == value.len() || !value[start + 17].is_ascii_hexdigit()
}

#[cfg(debug_assertions)]
fn spawn_backend() -> Result<(Child, ChildStdin, std::process::ChildStdout, ChildStderr), ApiError>
{
    let python_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../python");
    let mut command = if let Some(executable) = std::env::var_os("PYBMAP_PYTHON") {
        Command::new(executable)
    } else {
        Command::new("python")
    };
    command
        .args(["-m", "pybmap.backend"])
        .current_dir(python_dir);
    spawn_command(command)
}

#[cfg(not(debug_assertions))]
fn spawn_backend() -> Result<(Child, ChildStdin, std::process::ChildStdout, ChildStderr), ApiError>
{
    let executable = std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.parent()
                .map(|parent| parent.join("bosectl-backend.exe"))
        })
        .ok_or_else(ApiError::backend_unavailable)?;
    spawn_command(Command::new(executable))
}

fn spawn_command(
    mut command: Command,
) -> Result<(Child, ChildStdin, std::process::ChildStdout, ChildStderr), ApiError> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| ApiError::backend_unavailable())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(ApiError::backend_unavailable)?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(ApiError::backend_unavailable)?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(ApiError::backend_unavailable)?;
    Ok((child, stdin, stdout, stderr))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_output_fails_pending_requests() {
        let client = BackendClient::default();
        let (sender, receiver) = mpsc::channel();
        client
            .inner
            .pending
            .lock()
            .unwrap()
            .insert("1".into(), sender);
        read_backend(client.inner.clone(), b"not-json\n".as_slice());
        assert_eq!(
            receiver.recv().unwrap().unwrap_err().code,
            ErrorCode::BackendCrashed
        );
    }

    #[test]
    fn oversized_output_fails_pending_requests() {
        let client = BackendClient::default();
        let (sender, receiver) = mpsc::channel();
        client
            .inner
            .pending
            .lock()
            .unwrap()
            .insert("1".into(), sender);
        read_backend(
            client.inner.clone(),
            vec![b'x'; MAX_LINE_BYTES + 1].as_slice(),
        );
        assert_eq!(
            receiver.recv().unwrap().unwrap_err().code,
            ErrorCode::BackendCrashed
        );
    }

    #[test]
    fn responses_are_correlated_even_when_they_arrive_out_of_order() {
        let client = BackendClient::default();
        let (first_sender, first_receiver) = mpsc::channel();
        let (second_sender, second_receiver) = mpsc::channel();
        {
            let mut pending = client.inner.pending.lock().unwrap();
            pending.insert("first".into(), first_sender);
            pending.insert("second".into(), second_sender);
        }
        let output = br#"{"v":3,"id":"second","result":{"value":2}}
{"v":3,"id":"first","result":{"value":1}}
"#;
        read_backend(client.inner.clone(), output.as_slice());
        assert_eq!(first_receiver.recv().unwrap().unwrap()["value"], 1);
        assert_eq!(second_receiver.recv().unwrap().unwrap()["value"], 2);
    }

    #[test]
    fn unexpected_eof_is_reported_as_a_backend_crash() {
        let client = BackendClient::default();
        let (sender, receiver) = mpsc::channel();
        client
            .inner
            .pending
            .lock()
            .unwrap()
            .insert("1".into(), sender);
        read_backend(client.inner.clone(), b"".as_slice());
        assert_eq!(
            receiver.recv().unwrap().unwrap_err().code,
            ErrorCode::BackendCrashed
        );
    }

    #[test]
    fn backend_logs_redact_bluetooth_addresses() {
        assert_eq!(
            redact_sensitive(b"connection to AA:bb:CC:dd:EE:fF failed\n"),
            "connection to [redacted Bluetooth address] failed\n"
        );
        assert_eq!(redact_sensitive(b"error code 12:34"), "error code 12:34");
    }
}
