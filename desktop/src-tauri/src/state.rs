use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
};

use crate::{
    backend_client::BackendClient,
    contracts::{ApiError, ConnectionState, DeviceEvent, DeviceSnapshot, ErrorCode},
};

#[derive(Default)]
pub struct AppState {
    pub backend: BackendClient,
    generation: AtomicU64,
    revision: AtomicU64,
    connection_attempt: AtomicU64,
    snapshot: Mutex<Option<DeviceSnapshot>>,
    pub quitting: AtomicBool,
    pub shutdown_complete: AtomicBool,
}

impl AppState {
    pub fn begin_connection(&self) -> u64 {
        self.clear_snapshot();
        self.connection_attempt.fetch_add(1, Ordering::AcqRel) + 1
    }

    pub fn accept_connection_snapshot(
        &self,
        snapshot: DeviceSnapshot,
        attempt: u64,
    ) -> Result<DeviceSnapshot, ApiError> {
        snapshot.validate_wire()?;
        if attempt != self.connection_attempt.load(Ordering::Acquire) {
            return Err(ApiError::new(
                ErrorCode::StaleGeneration,
                "A newer connection attempt has replaced this one",
                false,
            ));
        }
        // A stopped sidecar starts its generation and revision counters over.
        // A successful connect establishes a new ordering epoch, so its first
        // snapshot must not be compared with the previous sidecar's counters.
        self.generation
            .store(snapshot.generation, Ordering::Release);
        self.revision.store(snapshot.revision, Ordering::Release);
        *self
            .snapshot
            .lock()
            .map_err(|_| ApiError::internal("device state is unavailable"))? =
            Some(snapshot.clone());
        Ok(snapshot)
    }

    pub fn validate_generation(&self, generation: u64) -> Result<(), ApiError> {
        let current = self.generation.load(Ordering::Acquire);
        if current != 0 && generation != current {
            Err(ApiError::new(
                ErrorCode::StaleGeneration,
                "The request belongs to an older device connection",
                false,
            ))
        } else {
            Ok(())
        }
    }

    pub fn accept_snapshot(&self, snapshot: DeviceSnapshot) -> Result<DeviceSnapshot, ApiError> {
        snapshot.validate_wire()?;
        let current = self.generation.load(Ordering::Acquire);
        let revision = self.revision.load(Ordering::Acquire);
        if snapshot.generation < current
            || (snapshot.generation == current && snapshot.revision < revision)
        {
            return Err(ApiError::new(
                ErrorCode::StaleGeneration,
                "The backend returned a stale device snapshot",
                false,
            ));
        }
        self.generation
            .store(snapshot.generation, Ordering::Release);
        self.revision.store(snapshot.revision, Ordering::Release);
        *self
            .snapshot
            .lock()
            .map_err(|_| ApiError::internal("device state is unavailable"))? =
            Some(snapshot.clone());
        Ok(snapshot)
    }

    pub fn current_snapshot(&self) -> Result<Option<DeviceSnapshot>, ApiError> {
        self.snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .map_err(|_| ApiError::internal("device state is unavailable"))
    }

    pub fn clear_snapshot(&self) {
        if let Ok(mut snapshot) = self.snapshot.lock() {
            *snapshot = None;
        }
    }

    pub fn record_backend_event(&self, event: &DeviceEvent) {
        match event {
            DeviceEvent::SnapshotChanged { data } => {
                let _ = self.accept_snapshot((**data).clone());
            }
            DeviceEvent::ConnectionChanged { data } => {
                let generation = self.generation.load(Ordering::Acquire);
                let revision = self.revision.load(Ordering::Acquire);
                if data.generation > generation
                    || (data.generation == generation && data.revision >= revision)
                {
                    self.generation.store(data.generation, Ordering::Release);
                    self.revision.store(data.revision, Ordering::Release);
                    if data.state != ConnectionState::Connected {
                        self.clear_snapshot();
                    }
                }
            }
            DeviceEvent::BackendError { data }
                if matches!(data.code, ErrorCode::BackendCrashed | ErrorCode::DeviceLost) =>
            {
                self.clear_snapshot();
            }
            DeviceEvent::BackendError { .. } => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(generation: u64, revision: u64) -> DeviceSnapshot {
        serde_json::from_value(serde_json::json!({
            "identity": null, "battery": null, "firmware": null,
            "connection": {"state": "connected", "reason": null, "rfcomm_channel": 2},
            "capabilities": {"noise_control": null, "equalizer": [], "settings": [], "profiles": null},
            "values": {"noise_control": null, "eq": {}, "settings": {}, "profile_id": null},
            "generation": generation, "revision": revision
        })).unwrap()
    }

    #[test]
    fn rejects_old_generations_and_revisions() {
        let state = AppState::default();
        state.accept_snapshot(snapshot(2, 4)).unwrap();
        assert_eq!(
            state.accept_snapshot(snapshot(1, 99)).unwrap_err().code,
            ErrorCode::StaleGeneration
        );
        assert_eq!(
            state.accept_snapshot(snapshot(2, 3)).unwrap_err().code,
            ErrorCode::StaleGeneration
        );
        assert!(state.accept_snapshot(snapshot(3, 0)).is_ok());
    }

    #[test]
    fn connection_attempt_starts_a_new_backend_ordering_epoch() {
        let state = AppState::default();
        state.accept_snapshot(snapshot(7, 40)).unwrap();

        let attempt = state.begin_connection();
        assert!(state
            .accept_connection_snapshot(snapshot(1, 2), attempt)
            .is_ok());
        assert!(state.accept_snapshot(snapshot(1, 3)).is_ok());

        let superseded = state.begin_connection();
        let current = state.begin_connection();
        assert_eq!(
            state
                .accept_connection_snapshot(snapshot(2, 1), superseded)
                .unwrap_err()
                .code,
            ErrorCode::StaleGeneration
        );
        assert!(state
            .accept_connection_snapshot(snapshot(3, 1), current)
            .is_ok());
    }

    #[test]
    fn cached_snapshot_is_available_for_a_recreated_webview_and_clears_on_disconnect() {
        let state = AppState::default();
        state.accept_snapshot(snapshot(2, 4)).unwrap();
        assert_eq!(state.current_snapshot().unwrap().unwrap().revision, 4);
        state.record_backend_event(&DeviceEvent::ConnectionChanged {
            data: crate::contracts::ConnectionChangedData {
                state: ConnectionState::Disconnected,
                generation: 2,
                revision: 5,
                reason: None,
            },
        });
        assert!(state.current_snapshot().unwrap().is_none());
    }
}
