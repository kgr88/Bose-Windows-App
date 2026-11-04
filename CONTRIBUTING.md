# Contributing

Thank you for helping with bosectl. This guide explains how to set up the
project, run the checks, and open a pull request.

## Project layout

- `desktop/src/` — React and TypeScript user interface.
- `desktop/src-tauri/` — Tauri Rust host. It owns the tray, the window, and the backend process.
- `python/` — `pybmap` library and the Bluetooth backend sidecar.
- `packaging/windows/` — Windows release build scripts.
- `docs/` — Architecture, protocol, and IPC documentation.
- `fixtures/` — Captured BMAP packets for tests.

## Requirements

- Windows 10 or 11 with WebView2.
- Python 3.12 or newer.
- Node.js 22.12 or newer with Corepack.
- Rust stable with the MSVC target.

## Set up

Start each step from the repository root.

1. Install the Python package and the development tools:

   ```powershell
   cd python
   python -m pip install -e .
   python -m pip install -r requirements-dev.txt
   ```

2. Install the desktop dependencies:

   ```powershell
   cd desktop
   corepack pnpm install
   ```

3. Start the app in development mode:

   ```powershell
   cd desktop
   corepack pnpm dev
   ```

See [desktop/README.md](desktop/README.md) and
[packaging/windows/README.md](packaging/windows/README.md) for more detail.

## Checks

Run all checks before each commit. CI runs the same checks, and they must pass
before a merge to `main`.

From `python/`:

```powershell
python -m ruff check
python -m ruff format --check
python -m pytest
```

From `desktop/`:

```powershell
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

From `desktop/src-tauri/`:

```powershell
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

To fix formatting, run `python -m ruff format` in `python/`,
`corepack pnpm exec prettier --write .` in `desktop/`, and `cargo fmt` in
`desktop/src-tauri/`.

Do not disable a lint rule or add a suppression to pass a check. Fix the code
instead.

## Pull requests

1. Create a branch from `main`.
2. Make one focused change per pull request.
3. Add or update tests for the change.
4. Use a Conventional Commit subject with a scope, for example
   `fix(python): handle a closed RFCOMM channel` or `feat(desktop): add a battery widget`.
5. Open a pull request and fill in the template.

If your change depends on headphone behavior, say which headphones you tested
with. Do not mark hardware behavior as tested without a real paired headset.

## Add support for new headphones

Open a [device report](https://github.com/kgr88/Bose-Windows-App/issues/new/choose)
first. See [Adding a New Device](docs/architecture.md#adding-a-new-device) for
the steps.
