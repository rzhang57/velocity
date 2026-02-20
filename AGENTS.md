# Repository Guidelines

## Project overview
Openscreen is a screen recording software built for beautiful software product demo videos

## Project Structure & Module Organization
OpenScreen is a Vite + React + TypeScript renderer with an Electron main process.
- `src/`: renderer app code.
- `src/components/`: UI and feature components (`launch/`, `video-editor/`, `ui/`).
- `src/lib/`: export pipeline and shared library code (`exporter/`, helpers).
- `src/hooks/`, `src/utils/`: reusable hooks and utilities.
- `electron/`: Electron entry points (`main.ts`, `preload.ts`, IPC handlers).
- `public/`: static assets (preview images, wallpapers, icons used at runtime).
- `icons/`: packaging icons; `dist-electron/` is build output and should not be hand-edited.

## Build, Test, and Development Commands
Use npm scripts from `package.json`:
- `npm run dev`: start local Vite dev server.
- `npm run build`: type-check, build renderer, then package with Electron Builder.
- `npm run build:win` / `build:mac` / `build:linux`: platform-specific packaging.
- `npm run preview`: preview production web build.
- `npm run lint`: run ESLint on `ts`/`tsx` files (warnings are treated strictly).
- `npm test`: run Vitest once.
- `npm run test:watch`: run Vitest in watch mode.

## Coding Style & Naming Conventions
- Language: TypeScript (`.ts`/`.tsx`), React function components.
- Follow existing ESLint config in `.eslintrc.cjs` (`@typescript-eslint`, `react-hooks`).
- Use 2-space indentation and match surrounding file style before introducing new patterns.
- Naming:
  - Components/files: `PascalCase` (for example `VideoEditor.tsx`).
  - Hooks: `useSomething` (for example `useScreenRecorder.ts`).
  - Utilities/modules: `camelCase` file names where appropriate.
- No unnecessary comments

## Testing Guidelines
- Framework: Vitest (`vitest.config.ts`) with tests located near code (for example `src/lib/exporter/gifExporter.test.ts`).
- Name test files `*.test.ts` or `*.test.tsx`.
- To save time, only create basic tests if really needed for non-trivial tasks/ bug fixes. No unnecessary testing.
- Run `npm test` and `npm run lint` before finishing
