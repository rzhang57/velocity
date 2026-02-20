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
    openSourceSelector: () => Promise<void>
    openCameraPreviewWindow: (deviceId?: string) => Promise<{ success: boolean }>
    closeCameraPreviewWindow: () => Promise<{ success: boolean }>
    setHudOverlayWidth: (width: number) => Promise<{ success: boolean }>
    selectSource: (source: any) => Promise<any>
    getSelectedSource: () => Promise<any>
    storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => Promise<{ success: boolean; path?: string; message?: string }>
    storeRecordingSession: (payload: {
      screenVideoData: ArrayBuffer
      screenFileName: string
      cameraVideoData?: ArrayBuffer
      cameraFileName?: string
      session: Record<string, unknown>
    }) => Promise<{ success: boolean; session?: Record<string, unknown>; message?: string; error?: string }>
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
