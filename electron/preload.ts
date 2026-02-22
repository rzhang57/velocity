import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
    hudOverlayHide: () => {
      ipcRenderer.send('hud-overlay-hide');
    },
    hudOverlayClose: () => {
      ipcRenderer.send('hud-overlay-close');
    },
  getAssetBasePath: async () => {
    // ask main process for the correct base path (production vs dev)
    return await ipcRenderer.invoke('get-asset-base-path')
  },
  getSources: async (opts: Electron.SourcesOptions) => {
    return await ipcRenderer.invoke('get-sources', opts)
  },
  switchToEditor: () => {
    return ipcRenderer.invoke('switch-to-editor')
  },
  startNewRecordingSession: (payload?: {
    replaceCurrentTake?: boolean
    session?: {
      screenVideoPath?: string
      cameraVideoPath?: string
      inputTelemetryPath?: string
    }
  }) => {
    return ipcRenderer.invoke('start-new-recording-session', payload)
  },
  openSourceSelector: () => {
    return ipcRenderer.invoke('open-source-selector')
  },
  openCameraPreviewWindow: (deviceId?: string) => {
    return ipcRenderer.invoke('open-camera-preview-window', deviceId)
  },
  closeCameraPreviewWindow: () => {
    return ipcRenderer.invoke('close-camera-preview-window')
  },
  setHudOverlayWidth: (width: number) => {
    return ipcRenderer.invoke('set-hud-overlay-width', width)
  },
  setHudOverlayHeight: (height: number, anchor?: 'top' | 'bottom') => {
    return ipcRenderer.invoke('set-hud-overlay-height', height, anchor)
  },
  getHudOverlayPopoverSide: () => {
    return ipcRenderer.invoke('get-hud-overlay-popover-side')
  },
  getHudSettings: () => {
    return ipcRenderer.invoke('get-hud-settings')
  },
  setHudEncoderOptions: (options: Array<{ encoder: 'h264_libx264' | 'h264_nvenc' | 'hevc_nvenc' | 'h264_amf'; label: string; hardware: 'cpu' | 'nvidia' | 'amd' }>) => {
    return ipcRenderer.invoke('set-hud-encoder-options', options)
  },
  preloadHudPopoverWindows: () => {
    return ipcRenderer.invoke('preload-hud-popover-windows')
  },
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
  }) => {
    return ipcRenderer.invoke('update-hud-settings', partial)
  },
  getNativeCaptureEncoderOptions: () => {
    return ipcRenderer.invoke('native-capture-encoder-options')
  },
  openHudPopoverWindow: (payload: {
    kind: 'recording' | 'media'
    anchorRect: { x: number; y: number; width: number; height: number }
    side: 'top' | 'bottom'
  }) => {
    return ipcRenderer.invoke('open-hud-popover-window', payload)
  },
  toggleHudPopoverWindow: (payload: {
    kind: 'recording' | 'media'
    anchorRect: { x: number; y: number; width: number; height: number }
    side: 'top' | 'bottom'
  }) => {
    return ipcRenderer.invoke('toggle-hud-popover-window', payload)
  },
  closeHudPopoverWindow: (kind?: 'recording' | 'media') => {
    return ipcRenderer.invoke('close-hud-popover-window', kind)
  },
  closeCurrentHudPopoverWindow: () => {
    return ipcRenderer.invoke('close-current-hud-popover-window')
  },
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
    }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: {
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
    }) => callback(settings)
    ipcRenderer.on('hud-settings-updated', listener)
    return () => ipcRenderer.removeListener('hud-settings-updated', listener)
  },
  selectSource: (source: { id?: string; display_id?: string; name?: string }) => {
    return ipcRenderer.invoke('select-source', source)
  },
  getSelectedSource: () => {
    return ipcRenderer.invoke('get-selected-source')
  },

  storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => {
    return ipcRenderer.invoke('store-recorded-video', videoData, fileName)
  },
  storeRecordingSession: (payload: {
    screenVideoData: ArrayBuffer
    screenFileName: string
    cameraVideoData?: ArrayBuffer
    cameraFileName?: string
    inputTelemetry?: Record<string, unknown>
    inputTelemetryFileName?: string
    session: Record<string, unknown>
  }) => {
    return ipcRenderer.invoke('store-recording-session', payload)
  },
  storeNativeRecordingSession: (payload: {
    screenVideoPath: string
    micAudioData?: ArrayBuffer
    micAudioFileName?: string
    cameraVideoData?: ArrayBuffer
    cameraFileName?: string
    inputTelemetry?: import('../src/types/inputTelemetry').InputTelemetryFileV1
    inputTelemetryFileName?: string
    session: Record<string, unknown>
  }) => {
    return ipcRenderer.invoke('store-native-recording-session', payload)
  },
  startInputTracking: (payload: {
    sessionId: string
    startedAtMs: number
    sourceId?: string
    sourceDisplayId?: string
  }) => {
    return ipcRenderer.invoke('start-input-tracking', payload)
  },
  stopInputTracking: () => {
    return ipcRenderer.invoke('stop-input-tracking')
  },
  nativeCaptureStart: (payload: import('../src/types/nativeCapture').NativeCaptureStartPayload) => {
    return ipcRenderer.invoke('native-capture-start', payload)
  },
  nativeCaptureStop: (payload: import('../src/types/nativeCapture').NativeCaptureStopPayload) => {
    return ipcRenderer.invoke('native-capture-stop', payload)
  },
  nativeCaptureStatus: (sessionId?: string) => {
    return ipcRenderer.invoke('native-capture-status', sessionId)
  },

  getRecordedVideoPath: () => {
    return ipcRenderer.invoke('get-recorded-video-path')
  },
  setRecordingState: (recording: boolean) => {
    return ipcRenderer.invoke('set-recording-state', recording)
  },
  onStopRecordingFromTray: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('stop-recording-from-tray', listener)
    return () => ipcRenderer.removeListener('stop-recording-from-tray', listener)
  },
  openExternalUrl: (url: string) => {
    return ipcRenderer.invoke('open-external-url', url)
  },
  saveExportedVideo: (videoData: ArrayBuffer, fileName: string) => {
    return ipcRenderer.invoke('save-exported-video', videoData, fileName)
  },
  getDefaultExportDirectory: () => {
    return ipcRenderer.invoke('get-default-export-directory')
  },
  chooseExportDirectory: (currentPath?: string) => {
    return ipcRenderer.invoke('choose-export-directory', currentPath)
  },
  saveExportedVideoToDirectory: (videoData: ArrayBuffer, fileName: string, directoryPath: string) => {
    return ipcRenderer.invoke('save-exported-video-to-directory', videoData, fileName, directoryPath)
  },
  openDirectory: (directoryPath: string) => {
    return ipcRenderer.invoke('open-directory', directoryPath)
  },
  openVideoFilePicker: () => {
    return ipcRenderer.invoke('open-video-file-picker')
  },
  setCurrentVideoPath: (path: string) => {
    return ipcRenderer.invoke('set-current-video-path', path)
  },
  getCurrentVideoPath: () => {
    return ipcRenderer.invoke('get-current-video-path')
  },
  setCurrentRecordingSession: (session: Record<string, unknown>) => {
    return ipcRenderer.invoke('set-current-recording-session', session)
  },
  getCurrentRecordingSession: () => {
    return ipcRenderer.invoke('get-current-recording-session')
  },
  clearCurrentVideoPath: () => {
    return ipcRenderer.invoke('clear-current-video-path')
  },
  getPlatform: () => {
    return ipcRenderer.invoke('get-platform')
  },
})
