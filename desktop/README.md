# Bose Windows App Windows desktop development

Stage 2 implements the Windows Bluetooth backend, supervised JSON-lines
sidecar, native tray/window lifecycle, and capability-driven React controls.
The IPC and renderer command contracts are documented in
`../docs/windows-gui-protocol.md`.

## Prerequisites

- Windows 10 or 11 with Evergreen WebView2
- Node.js 22.12 or newer with Corepack
- Rust 1.77.2 or newer with the MSVC Windows target
- Python 3.12 or newer for backend development

## Commands

From either the repository root or `desktop/`, start the complete desktop
application with:

```powershell
pnpm dev
```

From `desktop/`:

```powershell
pnpm install
pnpm dev
pnpm test
pnpm build
pnpm tauri build
```

In development the Rust host launches `python -m pybmap.backend`. Set the fixed
host-side `PYBMAP_PYTHON` environment variable when `python.exe` is not on PATH.
The variable is read only by the native host and is never exposed to renderer
commands.

Release builds freeze and smoke-test the Python backend, stage the target-triple
sidecar, run the software-only test suites, and create the current-user NSIS
installer with:

```powershell
pnpm release:windows
```

See `../packaging/windows/README.md` for prerequisites, optional certificate
signing, artifact locations, and the clean-machine release checklist.

From `python/`:

```powershell
python -m pytest
python -m pybmap.backend
```

To smoke-test the sidecar, write one compact JSON request per line. Start with
`{"v":3,"id":"1","method":"hello","params":{}}` and finish with
`{"v":3,"id":"2","method":"shutdown","params":{}}`.

The desktop setting contract includes sidetone, auto play/pause, spatial audio,
wind block, and ANC toggle. It intentionally excludes voice prompts, prompt
language, multipoint, auto-answer calls, button mapping, audio source, and
Bluetooth audio routing.

The renderer imports native APIs only through `src/api.ts`. Do not add shell,
filesystem, path, process, or arbitrary event capabilities. The Rust host accepts
typed domain inputs and validates them before the sidecar boundary.

Renderer styling uses Tailwind CSS through the official Vite plugin. Theme tokens
and the small set of global accessibility rules live in `src/styles/app.css`;
shared utility class strings live in `src/styles/ui.ts`. Prefer Tailwind utilities
in components and keep light/dark colors capability-neutral through the theme
tokens instead of adding model-specific styles.
