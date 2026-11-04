# Bose Windows App

[![CI](https://github.com/kgr88/Bose-Windows-App/actions/workflows/ci.yml/badge.svg)](https://github.com/kgr88/Bose-Windows-App/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/kgr88/Bose-Windows-App?include_prereleases)](https://github.com/kgr88/Bose-Windows-App/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows_10_%7C_11-0078D4.svg)](#requirements)

**Control your Bose headphones from Windows. No Bose app, no cloud, no account.**

Bose Windows App is a small Windows app that connects directly to your paired Bose
headphones over Bluetooth. It stays in the system tray, so your headphone
controls are always one click away.

## Download

[**Download the latest installer**](https://github.com/kgr88/Bose-Windows-App/releases)
(`Bose Windows App_<version>_x64-setup.exe`).

## Features

- Change noise cancellation mode and strength.
- Adjust the bass, mid, and treble equalizer.
- Switch spatial audio modes.
- Edit and select listening profiles.
- Change device settings that your headphones report.
- See the battery level in the tray icon.
- Use the light, dark, or system color theme.

The app only shows the controls that your headphones support.

## Supported headphones

| Headphones | Status |
|------------|--------|
| QuietComfort Ultra Headphones (2nd Gen) | Tested |
| QuietComfort 35 / 35 II | Tested |
| QuietComfort Ultra Earbuds (2nd Gen) | Supported, not tested |

The app also recognizes other Bose headphones, earbuds, and speakers.
These devices are not tested yet. If you own one, please
[send a device report](https://github.com/kgr88/Bose-Windows-App/issues/new/choose).

## Requirements

- Windows 10 or 11.
- A Bluetooth adapter (built-in or USB).
- Bose headphones paired in Windows Bluetooth settings.

You do not need administrator rights, Python, or any other runtime.

## Install

1. Download the installer from the [releases page](https://github.com/kgr88/Bose-Windows-App/releases).
2. Run the installer.
3. If Windows SmartScreen shows a warning, select **More info**, then **Run anyway**.
   The installer is not code-signed yet, so Windows shows this warning.
4. Start **Bose Windows App** from the Start menu.

Optional: compare the installer hash with the `.sha256` file from the release.
Put both files in the same folder, then run this command there. It prints
`True` when the hashes match:

```powershell
(Get-FileHash ".\Bose Windows App_<version>_x64-setup.exe" -Algorithm SHA256).Hash -eq (Get-Content ".\Bose Windows App_<version>_x64-setup.exe.sha256").Split(' ')[0]
```

## Use

1. Pair your headphones in Windows **Settings > Bluetooth & devices**.
2. Start Bose Windows App.
3. Select **Find devices**, then select **Connect** next to your headphones.
   If the connection drops, the app tries to reconnect three times.
4. Change settings in the main window.
5. Close the window to keep Bose Windows App in the tray.
   Right-click the tray icon and select **Quit** to stop the app.

## Troubleshooting

- **The app does not find my headphones.** Make sure the headphones are paired
  in Windows and turned on. Disconnect them from your phone, then try again.
- **The connection drops.** Turn Bluetooth off and on in Windows, then reconnect
  in the app.
- **Something else is wrong.** Open the **Diagnostics** page in the app, then
  [open a bug report](https://github.com/kgr88/Bose-Windows-App/issues/new/choose)
  with that information.

## Uninstall

Open Windows **Settings > Apps > Installed apps**, find **Bose Windows App**, and select
**Uninstall**.

## Privacy

Bose Windows App talks only to your headphones. It does not connect to the internet,
collect data, or need an account.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup and checks.
Technical documentation is in [docs/](docs/).

## Credits and license

This project is a fork of [aaronsb/bosectl](https://github.com/aaronsb/bosectl).
It is released under the [MIT license](LICENSE).

Bose Windows App is not affiliated with or endorsed by Bose Corporation.
"Bose" and "QuietComfort" are trademarks of Bose Corporation.
