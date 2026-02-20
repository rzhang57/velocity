/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  electronAPI: {
    getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>
    switchToEditor: () => Promise<void>
    startNewRecordingSession: (payload?: {
      replaceCurrentTake?: boolean
      session?: {
        screenVideoPath?: string
        cameraVideoPath?: string
        inputTelemetryPath?: string
      }
    }) => Promise<{ success: boolean }>
    openSourceSelector: () => Promise<void>
    openCameraPreviewWindow: (deviceId?: string) => Promise<{ success: boolean }>
    closeCameraPreviewWindow: () => Promise<{ success: boolean }>
    setHudOverlayWidth: (width: number) => Promise<{ success: boolean }>
    selectSource: (source: ProcessedDesktopSource) => Promise<ProcessedDesktopSource>
    getSelectedSource: () => Promise<ProcessedDesktopSource | null>
    storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => Promise<{ success: boolean; path?: string; message?: string }>
    storeRecordingSession: (payload: {
      screenVideoData: ArrayBuffer
      screenFileName: string
      cameraVideoData?: ArrayBuffer
      cameraFileName?: string
      inputTelemetry?: import('../src/types/inputTelemetry').InputTelemetryFileV1
      inputTelemetryFileName?: string
      session: Record<string, unknown>
    }) => Promise<{ success: boolean; session?: Record<string, unknown>; message?: string; error?: string }>
    startInputTracking: (payload: import('../src/types/inputTelemetry').StartInputTrackingPayload) => Promise<{ success: boolean; message?: string }>
    stopInputTracking: () => Promise<{ success: boolean; telemetry?: import('../src/types/inputTelemetry').InputTelemetryFileV1; message?: string }>
    getRecordedVideoPath: () => Promise<{ success: boolean; path?: string; message?: string }>
    setRecordingState: (recording: boolean) => Promise<void>
    onStopRecordingFromTray: (callback: () => void) => () => void
    openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>
    saveExportedVideo: (videoData: ArrayBuffer, fileName: string) => Promise<{ success: boolean; path?: string; message?: string; cancelled?: boolean }>
    openVideoFilePicker: () => Promise<{ success: boolean; path?: string; cancelled?: boolean }>
    setCurrentVideoPath: (path: string) => Promise<{ success: boolean }>
    getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>
    setCurrentRecordingSession: (session: Record<string, unknown>) => Promise<{ success: boolean }>
    getCurrentRecordingSession: () => Promise<{ success: boolean; session?: Record<string, unknown> }>
    clearCurrentVideoPath: () => Promise<{ success: boolean }>
    getPlatform: () => Promise<string>
    hudOverlayHide: () => void;
    hudOverlayClose: () => void;
  }
}

interface ProcessedDesktopSource {
  id: string
  name: string
  display_id: string
  thumbnail: string | null
  appIcon: string | null
}
