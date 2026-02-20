/// <reference types="vite/client" />
/// <reference types="../electron/electron-env" />

interface ProcessedDesktopSource {
  id: string;
  name: string;
  display_id: string;
  thumbnail: string | null;
  appIcon: string | null;
}

interface RecordingSession {
  id: string;
  startedAtMs: number;
  screenVideoPath: string;
  cameraVideoPath?: string;
  micEnabled: boolean;
  micCaptured: boolean;
  cameraEnabled: boolean;
  cameraCaptured: boolean;
  cameraStartOffsetMs?: number;
  screenDurationMs: number;
  cameraDurationMs?: number;
}

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
    storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => Promise<{
      success: boolean
      path?: string
      message: string
      error?: string
    }>
    storeRecordingSession: (payload: {
      screenVideoData: ArrayBuffer
      screenFileName: string
      cameraVideoData?: ArrayBuffer
      cameraFileName?: string
      session: Omit<RecordingSession, 'screenVideoPath' | 'cameraVideoPath'>
    }) => Promise<{
      success: boolean
      session?: RecordingSession
      message?: string
      error?: string
    }>
    getRecordedVideoPath: () => Promise<{
      success: boolean
      path?: string
      message?: string
      error?: string
    }>
    getAssetBasePath: () => Promise<string | null>
    setRecordingState: (recording: boolean) => Promise<void>
    onStopRecordingFromTray: (callback: () => void) => () => void
    openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>
    saveExportedVideo: (videoData: ArrayBuffer, fileName: string) => Promise<{
      success: boolean
      path?: string
      message?: string
      cancelled?: boolean
    }>
    openVideoFilePicker: () => Promise<{ success: boolean; path?: string; cancelled?: boolean }>
    setCurrentVideoPath: (path: string) => Promise<{ success: boolean }>
    getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>
    setCurrentRecordingSession: (session: RecordingSession) => Promise<{ success: boolean }>
    getCurrentRecordingSession: () => Promise<{ success: boolean; session?: RecordingSession }>
    clearCurrentVideoPath: () => Promise<{ success: boolean }>
  }
}
