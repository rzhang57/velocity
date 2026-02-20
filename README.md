# velocity
opensource screen recording. built to deliver beautiful, smooth videos quickly. a free alternative to screen studio, loom, cap

<img src="https://github.com/user-attachments/assets/477f39a8-1f50-43c6-b24b-47e8f42045ad" width="700" alt="demo recording">

## stack
- TypeScript
- Electron
- React
- Rust

## current features
- record screen (or a specific window), microphone input, and your webcam simultaneously, also includes:
  - smooth custom cursor movement
  - encoder
  - quality preset (resolution)
  - framerate
  - automatic zoom in/out animations created at recording time based on input telemetry
- built in editor allowing you to:
  - adjust automatic focus animation intensity (regeneration)
  - manually add smooth zoom in/out animations with adjustable duration, position, depth
  - crop viewable video area
  - add custom backgrounds
  - trim recordings
  - adjust webcam viewable timestamps
  - add annotations (text, arrows, images)
- export final edit to different resolutions, formats
  - up to 4k 120FPS

## soon
- bug fixes
- improved editor
- custom user imported cursors

## getting started
```npm run dev```

## pre-release distributions
no official releases yet since development is still underway. if you'd like to install it on your computer in its current state, run
```
npm run build:win  # windows
npm run build:mac  # macos
npm run build:linux # linux
```

## credit/ shoutout
this repo is a fork of https://github.com/siddharthvaddem/openscreen which served as a strong initial foundation for the project. check it out!

## license
this project is licensed under the [MIT License](./LICENSE). by using this software, you agree that the authors are not liable for any issues, damages, or claims arising from its use.
