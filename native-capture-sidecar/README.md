# Native Capture Sidecar (Windows backend)

This sidecar provides OS-level recording orchestration for velocity via stdio JSON IPC.

## Current backend

- Windows: implemented using FFmpeg `gdigrab`
  - screen mode (`-i desktop` + selected monitor region)
  - window mode (`-i title=<window title>`)
- macOS/Linux: scaffold only (not implemented yet)

## Build

From repo root:

```bash
npm run build:sidecar:win
```

This produces:

- `native-capture-sidecar/bin/win32/native-capture-sidecar.exe`

## FFmpeg requirement

The sidecar requires `ffmpeg.exe` to be available via either:

1. Bundled path:
   - `native-capture-sidecar/bin/win32/ffmpeg.exe` (dev)
   - `resources/native-capture/win32/ffmpeg.exe` (packaged)
2. System PATH (`ffmpeg.exe`)

Dev/build prep now tries this order automatically:

1. `@ffmpeg-installer/ffmpeg` bundled npm binary
2. `ffmpeg.exe` on PATH

## Protocol commands

- `init`
- `get_encoder_options`
- `start_capture`
- `stop_capture`

Responses are line-delimited JSON with matching `id`.
