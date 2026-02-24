# Native Capture Sidecar
Native recording sidecar used by Velocity over JSON stdio IPC.

## Platform behavior
- Windows: Rust sidecar (`src/`) is used for native capture.
- macOS: Swift sidecar (`macos/NativeCaptureSidecar.swift`) is built and used in production flow for macOS native recording.

## Capture backends
- Windows screen capture: Windows Graphics Capture (WGC), monitor-level capture, crop/scale, cursor control.
- Windows window capture: WGC window capture.
- Windows encoding: FFmpeg pipeline with selectable encoders:
  - `h264_libx264` (CPU)
  - `h264_nvenc` (NVIDIA GPU, when available)
  - `h264_amf` (AMD GPU, when available)
- macOS capture: ScreenCaptureKit + AVAssetWriter (H.264 MP4) in the Swift sidecar.

## FFmpeg
- Required for Windows native capture and encoder probing.
- Also used by app-level post-processing paths (for example muxing microphone audio).
- Bundling prep in `scripts/prepareNativeCapture.mjs` prefers `ffmpeg-static`, then falls back to PATH.

## Build and prep
From repo root:
```bash
npm run build:sidecar
```

This prepares platform binaries under:
- `native-capture-sidecar/bin/win32/`
- `native-capture-sidecar/bin/darwin/`

## IPC commands
- `init`
- `get_encoder_options`
- `start_capture`
- `stop_capture`
