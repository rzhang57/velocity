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
  micStartOffsetMs?: number;
  cameraEnabled: boolean;
  cameraCaptured: boolean;
  cameraStartOffsetMs?: number;
  screenDurationMs: number;
  cameraDurationMs?: number;
  requestedCaptureFps?: 60 | 120;
  actualCaptureFps?: number;
  requestedCaptureWidth?: number;
  requestedCaptureHeight?: number;
  actualCaptureWidth?: number;
  actualCaptureHeight?: number;
  inputTelemetryPath?: string;
  inputTelemetry?: import("./types/inputTelemetry").InputTelemetryFileV1;
  autoZoomGeneratedAtMs?: number;
  autoZoomAlgorithmVersion?: string;
  customCursorEnabled?: boolean;
  captureBackend?: "native-sidecar" | "legacy-electron";
  recordingEncoder?: "h264_libx264" | "h264_nvenc" | "hevc_nvenc" | "h264_amf";
}

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
    setHudOverlayHeight: (height: number, anchor?: 'top' | 'bottom') => Promise<{ success: boolean }>
    getHudOverlayPopoverSide: () => Promise<{ success: boolean; side?: 'top' | 'bottom' }>
    getHudSettings: () => Promise<{
      success: boolean
      settings: {
        micEnabled: boolean
        selectedMicDeviceId: string
        micProcessingMode: 'raw' | 'cleaned'
        cameraEnabled: boolean
        cameraPreviewEnabled: boolean
        selectedCameraDeviceId: string
        recordingPreset: 'performance' | 'balanced' | 'quality'
        recordingFps: 60 | 120
        customCursorEnabled: boolean
        useLegacyRecorder: boolean
        recordingEncoder: 'h264_libx264' | 'h264_nvenc' | 'hevc_nvenc' | 'h264_amf'
        encoderOptions: Array<{ encoder: 'h264_libx264' | 'h264_nvenc' | 'hevc_nvenc' | 'h264_amf'; label: string; hardware: 'cpu' | 'nvidia' | 'amd' }>
      }
    }>
    setHudEncoderOptions: (options: Array<{ encoder: 'h264_libx264' | 'h264_nvenc' | 'hevc_nvenc' | 'h264_amf'; label: string; hardware: 'cpu' | 'nvidia' | 'amd' }>) => Promise<{ success: boolean; settings?: {
      micEnabled: boolean
      selectedMicDeviceId: string
      micProcessingMode: 'raw' | 'cleaned'
      cameraEnabled: boolean
      cameraPreviewEnabled: boolean
      selectedCameraDeviceId: string
      recordingPreset: 'performance' | 'balanced' | 'quality'
      recordingFps: 60 | 120
      customCursorEnabled: boolean
      useLegacyRecorder: boolean
      recordingEncoder: 'h264_libx264' | 'h264_nvenc' | 'hevc_nvenc' | 'h264_amf'
      encoderOptions: Array<{ encoder: 'h264_libx264' | 'h264_nvenc' | 'hevc_nvenc' | 'h264_amf'; label: string; hardware: 'cpu' | 'nvidia' | 'amd' }>
    }; message?: string }>
    preloadHudPopoverWindows: () => Promise<{ success: boolean; message?: string }>
    updateHudSettings: (partial: {
      micEnabled?: boolean
      selectedMicDeviceId?: string
      micProcessingMode?: 'raw' | 'cleaned'
      cameraEnabled?: boolean
      cameraPreviewEnabled?: boolean
      selectedCameraDeviceId?: string
      recordingPreset?: 'performance' | 'balanced' | 'quality'
      recordingFps?: 60 | 120
      customCursorEnabled?: boolean
      useLegacyRecorder?: boolean
      recordingEncoder?: 'h264_libx264' | 'h264_nvenc' | 'hevc_nvenc' | 'h264_amf'
    }) => Promise<{ success: boolean }>
    getNativeCaptureEncoderOptions: () => Promise<{
      success: boolean
      options: Array<{ encoder: 'h264_libx264' | 'h264_nvenc' | 'hevc_nvenc' | 'h264_amf'; label: string; hardware: 'cpu' | 'nvidia' | 'amd' }>
      message?: string
    }>
    openHudPopoverWindow: (payload: {
      kind: 'recording' | 'media'
      anchorRect: { x: number; y: number; width: number; height: number }
      side: 'top' | 'bottom'
    }) => Promise<{ success: boolean; message?: string }>
    toggleHudPopoverWindow: (payload: {
      kind: 'recording' | 'media'
      anchorRect: { x: number; y: number; width: number; height: number }
      side: 'top' | 'bottom'
    }) => Promise<{ success: boolean; opened?: boolean; message?: string }>
    closeHudPopoverWindow: (kind?: 'recording' | 'media') => Promise<{ success: boolean }>
    closeCurrentHudPopoverWindow: () => Promise<{ success: boolean }>
    onHudSettingsUpdated: (callback: (settings: {
      micEnabled: boolean
      selectedMicDeviceId: string
      micProcessingMode: 'raw' | 'cleaned'
      cameraEnabled: boolean
      cameraPreviewEnabled: boolean
      selectedCameraDeviceId: string
      recordingPreset: 'performance' | 'balanced' | 'quality'
      recordingFps: 60 | 120
      customCursorEnabled: boolean
      useLegacyRecorder: boolean
      recordingEncoder: 'h264_libx264' | 'h264_nvenc' | 'hevc_nvenc' | 'h264_amf'
      encoderOptions: Array<{ encoder: 'h264_libx264' | 'h264_nvenc' | 'hevc_nvenc' | 'h264_amf'; label: string; hardware: 'cpu' | 'nvidia' | 'amd' }>
    }) => void) => () => void
    selectSource: (source: ProcessedDesktopSource) => Promise<ProcessedDesktopSource>
    getSelectedSource: () => Promise<ProcessedDesktopSource | null>
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
      inputTelemetry?: import("./types/inputTelemetry").InputTelemetryFileV1
      inputTelemetryFileName?: string
      session: Omit<RecordingSession, 'screenVideoPath' | 'cameraVideoPath'>
    }) => Promise<{
      success: boolean
      session?: RecordingSession
      message?: string
      error?: string
    }>
    storeNativeRecordingSession: (payload: {
      screenVideoPath: string
      micAudioData?: ArrayBuffer
      micAudioFileName?: string
      cameraVideoData?: ArrayBuffer
      cameraFileName?: string
      inputTelemetry?: import("./types/inputTelemetry").InputTelemetryFileV1
      inputTelemetryFileName?: string
      session: Omit<RecordingSession, 'screenVideoPath' | 'cameraVideoPath'>
    }) => Promise<{
      success: boolean
      session?: RecordingSession
      message?: string
      error?: string
    }>
    startInputTracking: (payload: import("./types/inputTelemetry").StartInputTrackingPayload) => Promise<{ success: boolean; message?: string }>
    stopInputTracking: () => Promise<{ success: boolean; telemetry?: import("./types/inputTelemetry").InputTelemetryFileV1; message?: string }>
    nativeCaptureStart: (payload: import("./types/nativeCapture").NativeCaptureStartPayload) => Promise<{ success: boolean; message?: string }>
    nativeCaptureStop: (payload: import("./types/nativeCapture").NativeCaptureStopPayload) => Promise<{ success: boolean; result?: import("./types/nativeCapture").NativeCaptureSessionResult; message?: string }>
    nativeCaptureStatus: (sessionId?: string) => Promise<{ success: boolean; status: import("./types/nativeCapture").NativeCaptureStatus; message?: string; sessionId?: string; startedAtMs?: number }>
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
    getDefaultExportDirectory: () => Promise<{ success: boolean; path?: string; message?: string; error?: string }>
    chooseExportDirectory: (currentPath?: string) => Promise<{ success: boolean; cancelled?: boolean; path?: string; message?: string; error?: string }>
    saveExportedVideoToDirectory: (videoData: ArrayBuffer, fileName: string, directoryPath: string) => Promise<{ success: boolean; path?: string; message?: string; error?: string }>
    openDirectory: (directoryPath: string) => Promise<{ success: boolean; message?: string; error?: string }>
    openVideoFilePicker: () => Promise<{ success: boolean; path?: string; cancelled?: boolean }>
    setCurrentVideoPath: (path: string) => Promise<{ success: boolean }>
    getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>
    setCurrentRecordingSession: (session: RecordingSession) => Promise<{ success: boolean }>
    getCurrentRecordingSession: () => Promise<{ success: boolean; session?: RecordingSession }>
    clearCurrentVideoPath: () => Promise<{ success: boolean }>
    logRendererDiagnostic: (payload: {
      level: 'log' | 'warn' | 'error'
      scope: string
      message: string
      data?: unknown
    }) => void
  }
}
