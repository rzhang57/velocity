import { ipcMain, desktopCapturer, BrowserWindow, shell, app, dialog, screen, systemPreferences, type Rectangle } from 'electron'

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { RECORDINGS_DIR, VITE_DEV_SERVER_URL, RENDERER_DIST } from '../main'
import { InputTrackingService } from '../services/inputTrackingService'
import { NativeCaptureService } from '../services/nativeCaptureService'
import type { InputTelemetryFileV1 } from '@/types/inputTelemetry'
import type { NativeCaptureStartPayload, NativeCaptureStopPayload } from '@/types/nativeCapture'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let selectedSource: { id?: string; display_id?: string; name?: string } | null = null
let currentVideoPath: string | null = null
let currentRecordingSession: Record<string, unknown> | null = null
const inputTrackingService = new InputTrackingService()
const nativeCaptureService = new NativeCaptureService()
const DEFAULT_EXPORTS_DIR = path.join(app.getPath('documents'), 'velocity exports')
type HudPopoverKind = 'recording' | 'media'
type HudPopoverSide = 'top' | 'bottom'

type HudSettings = {
  micEnabled: boolean
  selectedMicDeviceId: string
  micProcessingMode: 'raw' | 'cleaned'
  cameraEnabled: boolean
  cameraPreviewEnabled: boolean
  selectedCameraDeviceId: string
  recordingPreset: 'performance' | 'balanced' | 'quality'
  recordingFps: 30 | 60
  customCursorEnabled: boolean
  useLegacyRecorder: boolean
  recordingEncoder: 'h264_libx264' | 'h264_nvenc' | 'hevc_nvenc' | 'h264_amf'
  encoderOptions: Array<{
    encoder: 'h264_libx264' | 'h264_nvenc' | 'hevc_nvenc' | 'h264_amf'
    label: string
    hardware: 'cpu' | 'nvidia' | 'amd'
  }>
}

type RecordingFinalizationPhase = 'stopping-native' | 'storing-assets' | 'muxing-audio' | 'done'
type RecordingFinalizationStatus = 'idle' | 'finalizing' | 'ready' | 'error'
type RecordingFinalizationState = {
  status: RecordingFinalizationStatus
  sessionId?: string
  message?: string
  progressPhase?: RecordingFinalizationPhase
}

const hudSettings: HudSettings = {
  micEnabled: process.platform === 'darwin' ? false : true,
  selectedMicDeviceId: '',
  micProcessingMode: 'cleaned',
  cameraEnabled: false,
  cameraPreviewEnabled: true,
  selectedCameraDeviceId: '',
  recordingPreset: 'quality',
  recordingFps: 60,
  customCursorEnabled: true,
  useLegacyRecorder: false,
  recordingEncoder: 'h264_libx264',
  encoderOptions: [
    { encoder: 'h264_libx264', label: 'x264 (CPU)', hardware: 'cpu' },
  ],
}
let recordingEncoderManuallySet = false
let recordingFinalizationState: RecordingFinalizationState = { status: 'idle' }

function pickPreferredHardwareEncoder(options: HudSettings['encoderOptions']): HudSettings['recordingEncoder'] | null {
  const preferredOrder: HudSettings['recordingEncoder'][] = ['h264_nvenc', 'h264_amf', 'hevc_nvenc']
  for (const encoder of preferredOrder) {
    if (options.some((option) => option.encoder === encoder)) {
      return encoder
    }
  }
  return null
}

function resolveCaptureRegionForDisplay(displayId?: string): { x: number; y: number; width: number; height: number } | undefined {
  if (!displayId) return undefined
  const displays = screen.getAllDisplays()
  const display = displays.find((item) => String(item.id) === displayId)
  if (!display) return undefined

  const dipToScreenPoint = (point: { x: number; y: number }) => {
    const maybe = (screen as unknown as { dipToScreenPoint?: (p: { x: number; y: number }) => { x: number; y: number } }).dipToScreenPoint
    return typeof maybe === 'function' ? maybe(point) : point
  }

  const topLeft = dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y })
  const bottomRight = dipToScreenPoint({
    x: display.bounds.x + display.bounds.width,
    y: display.bounds.y + display.bounds.height,
  })

  return {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.max(1, bottomRight.x - topLeft.x),
    height: Math.max(1, bottomRight.y - topLeft.y),
  }
}

function toEven(value: number): number {
  const rounded = Math.round(value)
  return Math.max(2, rounded - (rounded % 2))
}

type RectBounds = { x: number; y: number; width: number; height: number }

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toRectBounds(value: unknown): RectBounds | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
  const x = toFiniteNumber(candidate.x)
  const y = toFiniteNumber(candidate.y)
  const width = toFiniteNumber(candidate.width)
  const height = toFiniteNumber(candidate.height)
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') {
    return undefined
  }
  if (width <= 0 || height <= 0) return undefined
  return { x, y, width, height }
}

function resolveDisplayPhysicalMapper(sourceDisplayId?: string): ((point: { x: number; y: number }) => { x: number; y: number }) | undefined {
  if (!sourceDisplayId) return undefined
  const displays = screen.getAllDisplays()
  const targetDisplay = displays.find((display) => String(display.id) === sourceDisplayId)
  if (!targetDisplay) return undefined
  const dipToScreenPoint = (screen as unknown as { dipToScreenPoint?: (p: { x: number; y: number }) => { x: number; y: number } }).dipToScreenPoint
  if (typeof dipToScreenPoint !== 'function') return undefined

  const dipBounds = targetDisplay.bounds
  const physicalTopLeft = dipToScreenPoint({ x: dipBounds.x, y: dipBounds.y })
  const physicalBottomRight = dipToScreenPoint({ x: dipBounds.x + dipBounds.width, y: dipBounds.y + dipBounds.height })
  const physicalWidth = physicalBottomRight.x - physicalTopLeft.x
  const physicalHeight = physicalBottomRight.y - physicalTopLeft.y
  if (!Number.isFinite(physicalWidth) || !Number.isFinite(physicalHeight) || Math.abs(physicalWidth) < 1 || Math.abs(physicalHeight) < 1) {
    return undefined
  }

  const scaleX = physicalWidth / dipBounds.width
  const scaleY = physicalHeight / dipBounds.height
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || Math.abs(scaleX) < 0.01 || Math.abs(scaleY) < 0.01) {
    return undefined
  }

  return (point: { x: number; y: number }) => ({
    x: dipBounds.x + ((point.x - physicalTopLeft.x) / scaleX),
    y: dipBounds.y + ((point.y - physicalTopLeft.y) / scaleY),
  })
}

function normalizeWindowTelemetryForBounds(
  telemetry: InputTelemetryFileV1,
  sourceBounds: RectBounds
): InputTelemetryFileV1 {
  const shouldConvertPhysicalToDip = process.platform === 'darwin'
  const physicalToDip = shouldConvertPhysicalToDip
    ? resolveDisplayPhysicalMapper(telemetry.sourceDisplayId)
    : undefined
  const normalizedEvents = telemetry.events.map((event) => {
    if (
      (event.type !== 'mouseDown' && event.type !== 'mouseUp' && event.type !== 'mouseMoveSampled' && event.type !== 'wheel')
      || typeof event.x !== 'number'
      || typeof event.y !== 'number'
    ) {
      return event
    }
    if (!physicalToDip) {
      return event
    }
    const dipPoint = physicalToDip({ x: event.x, y: event.y })
    return {
      ...event,
      x: dipPoint.x,
      y: dipPoint.y,
    }
  })

  return {
    ...telemetry,
    sourceBounds: {
      x: sourceBounds.x,
      y: sourceBounds.y,
      width: sourceBounds.width,
      height: sourceBounds.height,
    },
    events: normalizedEvents,
  }
}

export function getSelectedSourceForDisplayMedia(): { id?: string; display_id?: string } | null {
  if (!selectedSource || typeof selectedSource !== 'object') {
    return null
  }
  return {
    id: typeof selectedSource.id === 'string' ? selectedSource.id : undefined,
    display_id: typeof selectedSource.display_id === 'string' ? selectedSource.display_id : undefined,
  }
}

let recordingPopoverWindow: BrowserWindow | null = null
let mediaPopoverWindow: BrowserWindow | null = null
const popoverAnchors: Partial<Record<HudPopoverKind, {
  anchorRect: { x: number; y: number; width: number; height: number }
  side: HudPopoverSide
}>> = {}

function getTelemetryFilePath(videoPath: string) {
  const parsed = path.parse(videoPath)
  return path.join(parsed.dir, `${parsed.name}.telemetry.json`)
}

async function loadTelemetryForVideo(videoPath: string): Promise<{ path: string; telemetry: InputTelemetryFileV1 } | null> {
  const telemetryPath = getTelemetryFilePath(videoPath)
  try {
    const raw = await fs.readFile(telemetryPath, 'utf-8')
    const parsed = JSON.parse(raw) as InputTelemetryFileV1
    if (parsed && parsed.version === 1 && Array.isArray(parsed.events)) {
      console.info('[auto-zoom][main] Telemetry sidecar loaded', {
        telemetryPath,
        sessionId: parsed.sessionId,
        totalEvents: parsed.stats?.totalEvents ?? 0,
      })
      return { path: telemetryPath, telemetry: parsed }
    }
    console.warn('[auto-zoom][main] Telemetry sidecar was present but invalid format', {
      telemetryPath,
    })
  } catch {
    console.info('[auto-zoom][main] No telemetry sidecar found for video', {
      videoPath,
      telemetryPath,
    })
  }

  return null
}

export function registerIpcHandlers(
  createEditorWindow: () => void,
  openEditorWindowNow: () => void,
  createHudOverlayWindow: () => void,
  openHudOverlayWindowNow: () => void,
  createSourceSelectorWindow: () => BrowserWindow,
  createCameraPreviewWindow: (deviceId?: string) => BrowserWindow,
  closeCameraPreviewWindow: () => void,
  getMainWindow: () => BrowserWindow | null,
  getSourceSelectorWindow: () => BrowserWindow | null,
  getCameraPreviewWindow: () => BrowserWindow | null,
  onRecordingStateChange?: (recording: boolean, sourceName: string) => void
) {
  const getPopoverWindow = (kind: HudPopoverKind) => (kind === 'recording' ? recordingPopoverWindow : mediaPopoverWindow)
  const setPopoverWindow = (kind: HudPopoverKind, win: BrowserWindow | null) => {
    if (kind === 'recording') {
      recordingPopoverWindow = win
      if (!win) {
        delete popoverAnchors.recording
      }
      return
    }
    mediaPopoverWindow = win
    if (!win) {
      delete popoverAnchors.media
    }
  }

  const closeHudPopoverWindows = () => {
    const windows = [recordingPopoverWindow, mediaPopoverWindow]
    for (const win of windows) {
      if (win && !win.isDestroyed()) {
        win.close()
      }
    }
    recordingPopoverWindow = null
    mediaPopoverWindow = null
    delete popoverAnchors.recording
    delete popoverAnchors.media
  }

  const broadcastRecordingSessionReady = () => {
    const payload = currentRecordingSession ? { session: currentRecordingSession } : {}
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('recording-session-ready', payload)
      }
    })
  }

  const computePopoverBounds = (
    mainBounds: Rectangle,
    kind: HudPopoverKind,
    anchorRect: { x: number; y: number; width: number; height: number },
    side: HudPopoverSide
  ) => {
    const popoverSize = kind === 'recording'
      ? { width: 420, height: 560 }
      : { width: 360, height: 290 }
    const margin = 8
    const absoluteAnchor = {
      x: mainBounds.x + anchorRect.x,
      y: mainBounds.y + anchorRect.y,
      width: anchorRect.width,
      height: anchorRect.height,
    }
    const display = screen.getDisplayMatching(mainBounds)
    const workArea = display.workArea
    const centeredX = absoluteAnchor.x + Math.round((absoluteAnchor.width - popoverSize.width) / 2)
    const maxX = workArea.x + workArea.width - popoverSize.width
    const x = Math.max(workArea.x, Math.min(centeredX, maxX))
    const preferredY = side === 'top'
      ? absoluteAnchor.y - popoverSize.height - margin
      : absoluteAnchor.y + absoluteAnchor.height + margin
    const maxY = workArea.y + workArea.height - popoverSize.height
    const y = Math.max(workArea.y, Math.min(preferredY, maxY))
    return { x, y, width: popoverSize.width, height: popoverSize.height }
  }

  const broadcastHudSettings = () => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('hud-settings-updated', hudSettings)
      }
    })
  }

  const createHudPopoverWindow = (
    kind: HudPopoverKind,
    bounds: { x: number; y: number; width: number; height: number }
  ) => {
    const popoverWindow = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      resizable: false,
      frame: false,
      transparent: true,
      show: false,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      x: bounds.x,
      y: bounds.y,
      webPreferences: {
        preload: path.join(__dirname, 'preload.mjs'),
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    })

    popoverWindow.on('closed', () => {
      setPopoverWindow(kind, null)
    })

    if (VITE_DEV_SERVER_URL) {
      const url = new URL(VITE_DEV_SERVER_URL)
      url.searchParams.set('windowType', 'hud-popover')
      url.searchParams.set('kind', kind)
      popoverWindow.loadURL(url.toString())
    } else {
      popoverWindow.loadFile(path.join(RENDERER_DIST, 'index.html'), {
        query: { windowType: 'hud-popover', kind },
      })
    }

    setPopoverWindow(kind, popoverWindow)
    return popoverWindow
  }

  const openHudPopoverWindow = (
    kind: HudPopoverKind,
    anchorRect: { x: number; y: number; width: number; height: number },
    side: HudPopoverSide
  ) => {
    const mainWin = getMainWindow()
    if (!mainWin || mainWin.isDestroyed()) {
      return { success: false as const, message: 'HUD window unavailable' }
    }
    popoverAnchors[kind] = { anchorRect, side }
    const bounds = computePopoverBounds(mainWin.getBounds(), kind, anchorRect, side)

    const existing = getPopoverWindow(kind)
    if (existing && !existing.isDestroyed()) {
      existing.setBounds(bounds, false)
      const showReady = () => {
        if (existing.isDestroyed()) return
        if (!existing.isVisible()) {
          existing.show()
        }
        existing.webContents.send('hud-settings-updated', hudSettings)
      }
      if (existing.webContents.isLoadingMainFrame()) {
        existing.webContents.once('did-finish-load', showReady)
      } else {
        showReady()
      }
      return { success: true as const }
    }

    const popoverWindow = createHudPopoverWindow(kind, bounds)

    popoverWindow.webContents.once('did-finish-load', () => {
      if (!popoverWindow.isDestroyed()) {
        popoverWindow.webContents.send('hud-settings-updated', hudSettings)
        popoverWindow.show()
      }
    })

    return { success: true as const }
  }

  const ensureDirectoryExists = async (directoryPath: string) => {
    await fs.mkdir(directoryPath, { recursive: true })
  }

  const resolvePackagedFfmpegPath = () => (
    app.isPackaged
      ? path.join(process.resourcesPath, 'native-capture', process.platform, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
      : path.join(app.getAppPath(), 'native-capture-sidecar', 'bin', process.platform, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  )

  const resolveMuxFfmpegPath = () => {
    const packaged = resolvePackagedFfmpegPath()
    if (fsSync.existsSync(packaged)) return packaged
    if (process.platform !== 'darwin') return null
    const probe = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' })
    if (probe.status !== 0) return null
    const candidate = probe.stdout.trim()
    return candidate && fsSync.existsSync(candidate) ? candidate : null
  }

  const muxAudioIntoVideo = async (videoPath: string, audioPath: string, audioOffsetMs = 0): Promise<{ success: boolean; outputPath?: string; message?: string }> => {
    const ffmpegPath = resolveMuxFfmpegPath()
    if (!ffmpegPath) {
      return { success: false, message: 'ffmpeg executable not found for native audio muxing' }
    }

    const parsed = path.parse(videoPath)
    const tempOutputPath = path.join(parsed.dir, `${parsed.name}.with-audio${parsed.ext || '.mp4'}`)
    const ffmpegArgs = [
      '-y',
      '-i', videoPath,
    ]
    const normalizedOffsetSeconds = Math.abs(audioOffsetMs) / 1000
    if (audioOffsetMs > 0 && normalizedOffsetSeconds > 0.001) {
      ffmpegArgs.push('-itsoffset', normalizedOffsetSeconds.toFixed(3))
    } else if (audioOffsetMs < 0 && normalizedOffsetSeconds > 0.001) {
      ffmpegArgs.push('-ss', normalizedOffsetSeconds.toFixed(3))
    }
    ffmpegArgs.push(
      '-i', audioPath,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      tempOutputPath,
    )

    const muxResult = await new Promise<{ success: boolean; message?: string }>((resolve) => {
      const child = spawn(ffmpegPath, ffmpegArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let stderr = ''

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 4000) {
          stderr += String(chunk)
        }
      })
      child.on('error', (error) => {
        resolve({ success: false, message: `ffmpeg failed to start: ${String(error)}` })
      })
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true })
          return
        }
        resolve({
          success: false,
          message: `ffmpeg mux failed with exit code ${String(code)}${stderr ? `: ${stderr.trim()}` : ''}`,
        })
      })
    })

    if (!muxResult.success) {
      await deleteFileIfExists(tempOutputPath)
      return { success: false, message: muxResult.message }
    }

    try {
      await fs.unlink(videoPath)
    } catch {
      // intentional: ignore error if file doesn't exist
    }
    await fs.rename(tempOutputPath, videoPath)
    return { success: true, outputPath: videoPath }
  }

  const getUniqueFilePath = async (directoryPath: string, fileName: string) => {
    const parsed = path.parse(fileName)
    let candidate = path.join(directoryPath, fileName)
    let suffix = 1

    for (;;) {
      try {
        await fs.access(candidate)
        candidate = path.join(directoryPath, `${parsed.name} (${suffix})${parsed.ext}`)
        suffix += 1
      } catch {
        return candidate
      }
    }
  }

  const deleteFileIfExists = async (filePath?: string) => {
    if (!filePath) return
    try {
      await fs.unlink(filePath)
      console.info('[editor][main] Deleted recording asset', { filePath })
    } catch {
      console.warn('[editor][main] Could not delete recording asset (ignored)', { filePath })
    }
  }

  ipcMain.handle('get-sources', async (_, opts) => {
    const sources = await desktopCapturer.getSources(opts)
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      display_id: source.display_id,
      thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
      appIcon: source.appIcon ? source.appIcon.toDataURL() : null
    }))
  })

  ipcMain.handle('select-source', (_, source) => {
    selectedSource = source
    const sourceSelectorWin = getSourceSelectorWindow()
    if (sourceSelectorWin) {
      sourceSelectorWin.close()
    }
    return selectedSource
  })

  ipcMain.handle('get-selected-source', () => {
    return selectedSource
  })

  ipcMain.handle('start-input-tracking', (_, payload: {
    sessionId: string
    startedAtMs: number
    sourceId?: string
    sourceDisplayId?: string
  }) => {
    console.info('[auto-zoom][main] start-input-tracking requested', {
      sessionId: payload.sessionId,
      sourceId: payload.sourceId,
      sourceDisplayId: payload.sourceDisplayId,
      selectedSourceId: selectedSource?.id,
      selectedSourceDisplayId: selectedSource?.display_id,
    })
    const result = inputTrackingService.start(payload, selectedSource ?? undefined)
    if (result.success) {
      console.info('[auto-zoom][main] Input tracking started', {
        sessionId: payload.sessionId,
      })
    } else {
      console.warn('[auto-zoom][main] Input tracking failed to start', {
        sessionId: payload.sessionId,
        message: result.message,
      })
    }
    return result
  })

  ipcMain.handle('stop-input-tracking', () => {
    const telemetry = inputTrackingService.stop()
    if (telemetry) {
      console.info('[auto-zoom][main] Input tracking stopped with telemetry', {
        sessionId: telemetry.sessionId,
        totalEvents: telemetry.stats.totalEvents,
        mouseDownCount: telemetry.stats.mouseDownCount,
        keyDownCount: telemetry.stats.keyDownCount,
        wheelCount: telemetry.stats.wheelCount,
      })
      return { success: true, telemetry }
    }
    console.warn('[auto-zoom][main] stop-input-tracking called with no active tracking session')
    return { success: false, message: 'No active input tracking session' }
  })

  ipcMain.handle('open-source-selector', () => {
    const sourceSelectorWin = getSourceSelectorWindow()
    if (sourceSelectorWin) {
      sourceSelectorWin.focus()
      return
    }
    createSourceSelectorWindow()
  })

  ipcMain.handle('open-camera-preview-window', (_, deviceId?: string) => {
    const current = getCameraPreviewWindow()
    if (current) {
      current.close()
    }
    const win = createCameraPreviewWindow(deviceId)
    win.focus()
    return { success: true }
  })

  ipcMain.handle('close-camera-preview-window', () => {
    closeCameraPreviewWindow()
    return { success: true }
  })

  ipcMain.handle('switch-to-editor', () => {
    closeHudPopoverWindows()
    const mainWin = getMainWindow()
    if (mainWin) {
      mainWin.close()
    }
    createEditorWindow()
  })

  ipcMain.handle('open-editor-now', () => {
    closeHudPopoverWindows()
    const mainWin = getMainWindow()
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.minimize()
    }
    openEditorWindowNow()
    return { success: true }
  })



  ipcMain.handle('store-recorded-video', async (_, videoData: ArrayBuffer, fileName: string) => {
    try {
      const videoPath = path.join(RECORDINGS_DIR, fileName)
      await fs.writeFile(videoPath, Buffer.from(videoData))
      currentVideoPath = videoPath;
      currentRecordingSession = null;
      return {
        success: true,
        path: videoPath,
        message: 'Video stored successfully'
      }
    } catch (error) {
      console.error('Failed to store video:', error)
      return {
        success: false,
        message: 'Failed to store video',
        error: String(error)
      }
    }
  })

  ipcMain.handle('start-new-recording-session', async (event, payload?: {
    replaceCurrentTake?: boolean
    session?: {
      screenVideoPath?: string
      cameraVideoPath?: string
      inputTelemetryPath?: string
    }
  }) => {
    const replaceCurrentTake = Boolean(payload?.replaceCurrentTake)
    if (!replaceCurrentTake) {
      recordingFinalizationState = { status: 'idle' }
      closeHudPopoverWindows()
      openHudOverlayWindowNow()
      return { success: true, keptCurrentTake: true }
    }

    if (payload?.session) {
      await deleteFileIfExists(payload.session.screenVideoPath)
      await deleteFileIfExists(payload.session.cameraVideoPath)
      await deleteFileIfExists(payload.session.inputTelemetryPath)
    }

    currentRecordingSession = null
    currentVideoPath = null
    recordingFinalizationState = { status: 'idle' }
    const callerWindow = BrowserWindow.fromWebContents(event.sender)
    if (callerWindow && !callerWindow.isDestroyed()) {
      callerWindow.close()
    }
    closeHudPopoverWindows()
    createHudOverlayWindow()
    return { success: true, keptCurrentTake: false }
  })

  ipcMain.handle('get-hud-settings', () => {
    return { success: true, settings: hudSettings }
  })

  ipcMain.handle('request-media-access', async (_, kind: 'camera' | 'microphone') => {
    if (process.platform !== 'darwin') {
      return { success: true, granted: true }
    }
    if (kind !== 'camera' && kind !== 'microphone') {
      return { success: false, granted: false, message: 'Unsupported media access type' }
    }
    try {
      const status = systemPreferences.getMediaAccessStatus(kind)
      if (status === 'granted') {
        return { success: true, granted: true }
      }
      const granted = await systemPreferences.askForMediaAccess(kind)
      if (!granted) {
        const pane = kind === 'camera' ? 'Privacy_Camera' : 'Privacy_Microphone'
        shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`).catch(() => {})
      }
      return { success: true, granted }
    } catch (error) {
      return { success: false, granted: false, message: String(error) }
    }
  })

  ipcMain.handle('request-startup-permissions', async () => {
    if (process.platform !== 'darwin') {
      return {
        success: true,
        permissions: { accessibility: 'granted' },
      }
    }

    let accessibility: 'granted' | 'denied' = 'denied'
    try {
      const trusted = systemPreferences.isTrustedAccessibilityClient(false)
      if (trusted) {
        accessibility = 'granted'
      } else {
        const prompted = systemPreferences.isTrustedAccessibilityClient(true)
        accessibility = prompted ? 'granted' : 'denied'
      }
    } catch {
      accessibility = 'denied'
    }

    return {
      success: true,
      permissions: { accessibility },
    }
  })

  ipcMain.handle('preload-hud-popover-windows', () => {
    const mainWin = getMainWindow()
    if (!mainWin || mainWin.isDestroyed()) {
      return { success: false, message: 'HUD window unavailable' }
    }

    const mainBounds = mainWin.getBounds()
    const baseAnchor = { x: Math.max(16, Math.floor(mainBounds.width / 2) - 10), y: Math.max(16, Math.floor(mainBounds.height / 2) - 10), width: 20, height: 20 }

    ;(['recording', 'media'] as const).forEach((kind) => {
      const existing = getPopoverWindow(kind)
      if (existing && !existing.isDestroyed()) {
        return
      }
      const bounds = computePopoverBounds(mainBounds, kind, baseAnchor, 'top')
      createHudPopoverWindow(kind, bounds)
    })

    return { success: true }
  })

  ipcMain.handle('update-hud-settings', (_, partial: Partial<HudSettings>) => {
    if (typeof partial.micEnabled === 'boolean') hudSettings.micEnabled = partial.micEnabled
    if (typeof partial.selectedMicDeviceId === 'string') hudSettings.selectedMicDeviceId = partial.selectedMicDeviceId
    if (partial.micProcessingMode === 'raw' || partial.micProcessingMode === 'cleaned') hudSettings.micProcessingMode = partial.micProcessingMode
    if (typeof partial.cameraEnabled === 'boolean') hudSettings.cameraEnabled = partial.cameraEnabled
    if (typeof partial.cameraPreviewEnabled === 'boolean') hudSettings.cameraPreviewEnabled = partial.cameraPreviewEnabled
    if (typeof partial.selectedCameraDeviceId === 'string') hudSettings.selectedCameraDeviceId = partial.selectedCameraDeviceId
    if (partial.recordingPreset === 'performance' || partial.recordingPreset === 'balanced' || partial.recordingPreset === 'quality') {
      hudSettings.recordingPreset = partial.recordingPreset
    }
    if (partial.recordingFps === 30 || partial.recordingFps === 60) hudSettings.recordingFps = partial.recordingFps
    if (typeof partial.customCursorEnabled === 'boolean') {
      hudSettings.customCursorEnabled = partial.customCursorEnabled
      if (partial.customCursorEnabled) {
        hudSettings.useLegacyRecorder = false
      }
    }
    if (typeof partial.useLegacyRecorder === 'boolean') {
      hudSettings.useLegacyRecorder = partial.useLegacyRecorder
      if (partial.useLegacyRecorder) {
        hudSettings.customCursorEnabled = false
      }
    }
    if (partial.recordingEncoder === 'h264_libx264' || partial.recordingEncoder === 'h264_nvenc' || partial.recordingEncoder === 'hevc_nvenc' || partial.recordingEncoder === 'h264_amf') {
      if (partial.recordingEncoder !== hudSettings.recordingEncoder) {
        recordingEncoderManuallySet = true
      }
      hudSettings.recordingEncoder = partial.recordingEncoder
    }
    broadcastHudSettings()
    return { success: true, settings: hudSettings }
  })

  ipcMain.handle('set-hud-encoder-options', (_, options: Array<{ encoder: string; label: string; hardware: string }>) => {
    if (!Array.isArray(options)) {
      return { success: false, message: 'Invalid encoder options payload' }
    }
    const normalized = options.filter((option): option is HudSettings['encoderOptions'][number] => (
      Boolean(option)
      && typeof option === 'object'
      && (option.encoder === 'h264_libx264' || option.encoder === 'h264_nvenc' || option.encoder === 'hevc_nvenc' || option.encoder === 'h264_amf')
      && typeof option.label === 'string'
      && (option.hardware === 'cpu' || option.hardware === 'nvidia' || option.hardware === 'amd')
    ))
    if (!normalized.some((option) => option.encoder === 'h264_libx264')) {
      normalized.unshift({ encoder: 'h264_libx264', label: 'x264 (CPU)', hardware: 'cpu' })
    }
    hudSettings.encoderOptions = normalized
    if (!hudSettings.encoderOptions.some((option) => option.encoder === hudSettings.recordingEncoder)) {
      hudSettings.recordingEncoder = hudSettings.encoderOptions[0]?.encoder ?? 'h264_libx264'
      recordingEncoderManuallySet = false
    } else if (!recordingEncoderManuallySet && hudSettings.recordingEncoder === 'h264_libx264') {
      const hardwareDefault = pickPreferredHardwareEncoder(hudSettings.encoderOptions)
      if (hardwareDefault) {
        hudSettings.recordingEncoder = hardwareDefault
      }
    }
    broadcastHudSettings()
    return { success: true, settings: hudSettings }
  })

  ipcMain.handle('native-capture-encoder-options', async () => {
    const packagedFfmpeg = resolvePackagedFfmpegPath()
    const ffmpegPath = fsSync.existsSync(packagedFfmpeg) ? packagedFfmpeg : undefined
    const result = await nativeCaptureService.getEncoderOptions(ffmpegPath)
    return result
  })

  ipcMain.handle('native-capture-start', async (_, payload: NativeCaptureStartPayload) => {
    const packagedFfmpeg = resolvePackagedFfmpegPath()
    const platform = process.platform
    const sourceDisplayId = payload.source?.displayId
      || (typeof selectedSource?.display_id === 'string' ? selectedSource.display_id : undefined)
    const captureRegion = platform === 'win32' && payload.source?.type === 'screen'
      ? resolveCaptureRegionForDisplay(sourceDisplayId)
      : undefined
    const sourceRegion = payload.source?.type === 'screen'
      ? resolveCaptureRegionForDisplay(sourceDisplayId)
      : undefined
    const normalizedVideo = platform === 'darwin' && sourceRegion
      ? {
          ...payload.video,
          width: toEven(sourceRegion.width),
          height: toEven(sourceRegion.height),
        }
      : payload.video
    const normalizedPayload: NativeCaptureStartPayload = {
      ...payload,
      outputPath: path.isAbsolute(payload.outputPath)
        ? payload.outputPath
        : path.join(RECORDINGS_DIR, payload.outputPath),
      video: normalizedVideo,
      ffmpegPath: payload.ffmpegPath || (fsSync.existsSync(packagedFfmpeg) ? packagedFfmpeg : undefined),
      captureRegion: platform === 'win32' ? (payload.captureRegion || captureRegion) : undefined,
    }
    return await nativeCaptureService.start(normalizedPayload)
  })

  ipcMain.handle('native-capture-stop', async (_, payload: NativeCaptureStopPayload) => {
    return await nativeCaptureService.stop(payload)
  })

  ipcMain.handle('native-capture-status', (_, sessionId?: string) => {
    return { success: true, ...nativeCaptureService.getStatus(sessionId) }
  })

  ipcMain.handle('open-hud-popover-window', (_, payload: {
    kind: HudPopoverKind
    anchorRect: { x: number; y: number; width: number; height: number }
    side: HudPopoverSide
  }) => {
    if (payload.kind !== 'recording' && payload.kind !== 'media') {
      return { success: false, message: 'Invalid popover kind' }
    }
    return openHudPopoverWindow(payload.kind, payload.anchorRect, payload.side)
  })

  ipcMain.handle('toggle-hud-popover-window', (_, payload: {
    kind: HudPopoverKind
    anchorRect: { x: number; y: number; width: number; height: number }
    side: HudPopoverSide
  }) => {
    if (payload.kind !== 'recording' && payload.kind !== 'media') {
      return { success: false, message: 'Invalid popover kind' }
    }
    const existing = getPopoverWindow(payload.kind)
    if (existing && !existing.isDestroyed() && existing.isVisible()) {
      existing.hide()
      return { success: true, opened: false as const }
    }
    const result = openHudPopoverWindow(payload.kind, payload.anchorRect, payload.side)
    return { ...result, opened: true as const }
  })

  ipcMain.handle('close-hud-popover-window', (_, kind?: HudPopoverKind) => {
    if (!kind) {
      [recordingPopoverWindow, mediaPopoverWindow].forEach((win) => {
        if (win && !win.isDestroyed()) {
          win.hide()
        }
      })
      return { success: true }
    }
    const win = getPopoverWindow(kind)
    if (win && !win.isDestroyed()) {
      win.hide()
    }
    return { success: true }
  })

  ipcMain.handle('close-current-hud-popover-window', (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow || senderWindow.isDestroyed()) {
      return { success: false }
    }

    if (senderWindow === recordingPopoverWindow) {
      senderWindow.hide()
      return { success: true }
    }
    if (senderWindow === mediaPopoverWindow) {
      senderWindow.hide()
      return { success: true }
    }

    senderWindow.hide()
    return { success: true }
  })

  ipcMain.handle('set-hud-overlay-width', (_, width: number) => {
    const mainWin = getMainWindow()
    if (!mainWin || mainWin.isDestroyed()) {
      return { success: false }
    }

    const clampedWidth = Math.max(500, Math.min(1400, Math.round(width)))
    const bounds = mainWin.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const centerX = bounds.x + (bounds.width / 2)
    const maxX = workArea.x + workArea.width - clampedWidth
    const idealX = Math.round(centerX - (clampedWidth / 2))
    const x = Math.max(workArea.x, Math.min(idealX, maxX))
    const maxY = workArea.y + workArea.height - bounds.height
    const y = Math.max(workArea.y, Math.min(bounds.y, maxY))

    mainWin.setBounds({
      x,
      y,
      width: clampedWidth,
      height: bounds.height,
    }, false)
    return { success: true }
  })

  ipcMain.handle('get-hud-overlay-popover-side', () => {
    const mainWin = getMainWindow()
    if (!mainWin || mainWin.isDestroyed()) {
      return { success: false as const }
    }

    const bounds = mainWin.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const hudCenterY = bounds.y + (bounds.height / 2)
    const screenCenterY = workArea.y + (workArea.height / 2)
    const side = hudCenterY >= screenCenterY ? 'top' : 'bottom'

    return { success: true as const, side }
  })

  ipcMain.handle('set-hud-overlay-height', (_, height: number, anchor: 'top' | 'bottom' = 'bottom') => {
    const mainWin = getMainWindow()
    if (!mainWin || mainWin.isDestroyed()) {
      return { success: false }
    }

    const clampedHeight = Math.max(100, Math.min(720, Math.round(height)))
    const bounds = mainWin.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const maxX = workArea.x + workArea.width - bounds.width
    const maxY = workArea.y + workArea.height - clampedHeight
    const x = Math.max(workArea.x, Math.min(bounds.x, maxX))
    const idealY = anchor === 'top' ? bounds.y : bounds.y + bounds.height - clampedHeight
    const y = Math.max(workArea.y, Math.min(idealY, maxY))

    mainWin.setBounds({
      x,
      y,
      width: bounds.width,
      height: clampedHeight,
    }, false)
    return { success: true }
  })

  ipcMain.handle('store-recording-session', async (_, payload: {
    screenVideoData: ArrayBuffer
    screenFileName: string
    cameraVideoData?: ArrayBuffer
    cameraFileName?: string
    inputTelemetry?: InputTelemetryFileV1
    inputTelemetryFileName?: string
    session: Record<string, unknown>
  }) => {
    try {
      console.info('[auto-zoom][main] store-recording-session requested', {
        sessionId: typeof payload.session.id === 'string' ? payload.session.id : undefined,
        screenFileName: payload.screenFileName,
        hasCameraVideo: Boolean(payload.cameraVideoData && payload.cameraFileName),
        hasTelemetry: Boolean(payload.inputTelemetry),
      })
      const screenVideoPath = path.join(RECORDINGS_DIR, payload.screenFileName)
      await fs.writeFile(screenVideoPath, Buffer.from(payload.screenVideoData))

      let cameraVideoPath: string | undefined
      if (payload.cameraVideoData && payload.cameraFileName) {
        cameraVideoPath = path.join(RECORDINGS_DIR, payload.cameraFileName)
        await fs.writeFile(cameraVideoPath, Buffer.from(payload.cameraVideoData))
      }

      let inputTelemetryPath: string | undefined
      let inputTelemetry: InputTelemetryFileV1 | undefined
      if (payload.inputTelemetry) {
        const telemetryFileName = payload.inputTelemetryFileName || `${path.parse(payload.screenFileName).name}.telemetry.json`
        inputTelemetryPath = path.join(RECORDINGS_DIR, telemetryFileName)
        await fs.writeFile(inputTelemetryPath, JSON.stringify(payload.inputTelemetry), 'utf-8')
        inputTelemetry = payload.inputTelemetry
        console.info('[auto-zoom][main] Telemetry sidecar saved', {
          inputTelemetryPath,
          sessionId: payload.inputTelemetry.sessionId,
          totalEvents: payload.inputTelemetry.stats.totalEvents,
        })
      } else {
        console.warn('[auto-zoom][main] Recording session stored without telemetry payload', {
          sessionId: typeof payload.session.id === 'string' ? payload.session.id : undefined,
        })
      }

      const session = {
        ...payload.session,
        screenVideoPath,
        ...(cameraVideoPath ? { cameraVideoPath } : {}),
        ...(inputTelemetryPath ? { inputTelemetryPath } : {}),
        ...(inputTelemetry ? { inputTelemetry } : {}),
      }

      currentRecordingSession = session
      currentVideoPath = screenVideoPath
      recordingFinalizationState = {
        status: 'ready',
        sessionId: typeof payload.session.id === 'string' ? payload.session.id : undefined,
        progressPhase: 'done',
      }
      broadcastRecordingSessionReady()
      console.info('[auto-zoom][main] Recording session stored in memory', {
        sessionId: typeof payload.session.id === 'string' ? payload.session.id : undefined,
        screenVideoPath,
        inputTelemetryPath,
      })

      return {
        success: true,
        session,
        message: 'Recording session stored successfully',
      }
    } catch (error) {
      console.error('[auto-zoom][main] Failed to store recording session', error)
      recordingFinalizationState = {
        status: 'error',
        sessionId: typeof payload.session?.id === 'string' ? payload.session.id : undefined,
        message: 'Failed to store recording session',
      }
      return {
        success: false,
        message: 'Failed to store recording session',
        error: String(error),
      }
    }
  })

  ipcMain.handle('store-native-recording-session', async (_, payload: {
    screenVideoPath: string
    micAudioData?: ArrayBuffer
    micAudioFileName?: string
    cameraVideoData?: ArrayBuffer
    cameraFileName?: string
    inputTelemetry?: InputTelemetryFileV1
    inputTelemetryFileName?: string
    session: Record<string, unknown>
  }) => {
    try {
      console.info('[native-capture][main] store-native-recording-session requested', {
        screenVideoPath: payload.screenVideoPath,
        hasMicAudioData: Boolean(payload.micAudioData),
        hasCameraVideoData: Boolean(payload.cameraVideoData),
        hasInputTelemetry: Boolean(payload.inputTelemetry),
        sessionId: typeof payload.session?.id === 'string' ? payload.session.id : undefined,
      })
      let finalScreenVideoPath = payload.screenVideoPath
      if (!payload.screenVideoPath.startsWith(RECORDINGS_DIR)) {
        const targetName = `${path.parse(payload.screenVideoPath).name}.mp4`
        finalScreenVideoPath = await getUniqueFilePath(RECORDINGS_DIR, targetName)
        await fs.copyFile(payload.screenVideoPath, finalScreenVideoPath)
      }

      let micCaptured = typeof (payload.session as { micCaptured?: unknown }).micCaptured === 'boolean'
        ? Boolean((payload.session as { micCaptured?: unknown }).micCaptured)
        : false
      const micStartOffsetMs = typeof (payload.session as { micStartOffsetMs?: unknown }).micStartOffsetMs === 'number'
        ? Number((payload.session as { micStartOffsetMs?: unknown }).micStartOffsetMs)
        : 0
      let micAudioPath: string | undefined
      if (payload.micAudioData && payload.micAudioFileName) {
        micAudioPath = path.join(RECORDINGS_DIR, payload.micAudioFileName)
        await fs.writeFile(micAudioPath, Buffer.from(payload.micAudioData))
        const muxResult = await muxAudioIntoVideo(finalScreenVideoPath, micAudioPath, micStartOffsetMs)
        if (muxResult.success) {
          micCaptured = true
        } else {
          console.warn('[native-capture][main] Failed to mux microphone audio into native capture', {
            screenVideoPath: finalScreenVideoPath,
            micAudioPath,
            message: muxResult.message,
          })
        }
      }

      let cameraVideoPath: string | undefined
      if (payload.cameraVideoData && payload.cameraFileName) {
        cameraVideoPath = path.join(RECORDINGS_DIR, payload.cameraFileName)
        await fs.writeFile(cameraVideoPath, Buffer.from(payload.cameraVideoData))
      }

      let inputTelemetryPath: string | undefined
      let inputTelemetry: InputTelemetryFileV1 | undefined
      if (payload.inputTelemetry) {
        const capturedSourceBounds = toRectBounds((payload.session as { capturedSourceBounds?: unknown }).capturedSourceBounds)
        const normalizedTelemetry = (
          payload.inputTelemetry.sourceKind === 'window'
          && capturedSourceBounds
        )
          ? normalizeWindowTelemetryForBounds(payload.inputTelemetry, capturedSourceBounds)
          : payload.inputTelemetry
        const telemetryFileName = payload.inputTelemetryFileName || `${path.parse(finalScreenVideoPath).name}.telemetry.json`
        inputTelemetryPath = path.join(RECORDINGS_DIR, telemetryFileName)
        await fs.writeFile(inputTelemetryPath, JSON.stringify(normalizedTelemetry), 'utf-8')
        inputTelemetry = normalizedTelemetry
      }

      const normalizedSession = {
        ...payload.session,
        micCaptured,
      }

      const session = {
        ...normalizedSession,
        screenVideoPath: finalScreenVideoPath,
        ...(cameraVideoPath ? { cameraVideoPath } : {}),
        ...(inputTelemetryPath ? { inputTelemetryPath } : {}),
        ...(inputTelemetry ? { inputTelemetry } : {}),
      }

      currentRecordingSession = session
      currentVideoPath = finalScreenVideoPath
      await deleteFileIfExists(micAudioPath)
      recordingFinalizationState = {
        status: 'ready',
        sessionId: typeof payload.session.id === 'string' ? payload.session.id : undefined,
        progressPhase: 'done',
      }
      broadcastRecordingSessionReady()
      console.info('[native-capture][main] Native recording session stored in memory', {
        sessionId: typeof payload.session.id === 'string' ? payload.session.id : undefined,
        screenVideoPath: finalScreenVideoPath,
        cameraVideoPath,
        inputTelemetryPath,
      })

      return {
        success: true,
        session,
        message: 'Native recording session stored successfully',
      }
    } catch (error) {
      console.error('[native-capture][main] Failed to store native recording session', error)
      recordingFinalizationState = {
        status: 'error',
        sessionId: typeof payload.session?.id === 'string' ? payload.session.id : undefined,
        message: 'Failed to store native recording session',
      }
      return {
        success: false,
        message: 'Failed to store native recording session',
        error: String(error),
      }
    }
  })



  ipcMain.handle('get-recorded-video-path', async () => {
    try {
      const files = await fs.readdir(RECORDINGS_DIR)
      const videoFiles = files.filter(file => file.endsWith('.webm'))
      
      if (videoFiles.length === 0) {
        return { success: false, message: 'No recorded video found' }
      }
      
      const latestVideo = videoFiles.sort().reverse()[0]
      const videoPath = path.join(RECORDINGS_DIR, latestVideo)
      
      return { success: true, path: videoPath }
    } catch (error) {
      console.error('Failed to get video path:', error)
      return { success: false, message: 'Failed to get video path', error: String(error) }
    }
  })

  ipcMain.handle('set-recording-state', (_, recording: boolean) => {
    if (recording) {
      closeHudPopoverWindows()
    }
    const source = selectedSource || { name: 'Screen' }
    if (onRecordingStateChange) {
      onRecordingStateChange(recording, source.name ?? 'Screen')
    }
  })


  ipcMain.handle('open-external-url', async (_, url: string) => {
    try {
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      console.error('Failed to open URL:', error)
      return { success: false, error: String(error) }
    }
  })

  // Return base path for assets so renderer can resolve file:// paths in production
  ipcMain.handle('get-asset-base-path', () => {
    try {
      if (app.isPackaged) {
        return path.join(process.resourcesPath, 'assets')
      }
      return path.join(app.getAppPath(), 'public', 'assets')
    } catch (err) {
      console.error('Failed to resolve asset base path:', err)
      return null
    }
  })

  ipcMain.handle('save-exported-video', async (_, videoData: ArrayBuffer, fileName: string) => {
    try {
      // Determine file type from extension
      const isGif = fileName.toLowerCase().endsWith('.gif');
      const filters = isGif 
        ? [{ name: 'GIF Image', extensions: ['gif'] }]
        : [{ name: 'MP4 Video', extensions: ['mp4'] }];

      const result = await dialog.showSaveDialog({
        title: isGif ? 'Save Exported GIF' : 'Save Exported Video',
        defaultPath: path.join(app.getPath('downloads'), fileName),
        filters,
        properties: ['createDirectory', 'showOverwriteConfirmation']
      });

      if (result.canceled || !result.filePath) {
        return {
          success: false,
          cancelled: true,
          message: 'Export cancelled'
        };
      }

      await fs.writeFile(result.filePath, Buffer.from(videoData));

      return {
        success: true,
        path: result.filePath,
        message: 'Video exported successfully'
      };
    } catch (error) {
      console.error('Failed to save exported video:', error)
      return {
        success: false,
        message: 'Failed to save exported video',
        error: String(error)
      }
    }
  })

  ipcMain.handle('get-default-export-directory', async () => {
    try {
      await ensureDirectoryExists(DEFAULT_EXPORTS_DIR)
      return { success: true, path: DEFAULT_EXPORTS_DIR }
    } catch (error) {
      console.error('Failed to resolve default export directory:', error)
      return { success: false, message: 'Failed to resolve default export directory', error: String(error) }
    }
  })

  ipcMain.handle('choose-export-directory', async (_, currentPath?: string) => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Choose Export Folder',
        defaultPath: currentPath || DEFAULT_EXPORTS_DIR,
        properties: ['openDirectory', 'createDirectory'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true, message: 'Folder selection cancelled' }
      }

      const selectedPath = result.filePaths[0]
      await ensureDirectoryExists(selectedPath)
      return { success: true, path: selectedPath }
    } catch (error) {
      console.error('Failed to choose export directory:', error)
      return { success: false, message: 'Failed to choose export directory', error: String(error) }
    }
  })

  ipcMain.handle('save-exported-video-to-directory', async (_, videoData: ArrayBuffer, fileName: string, directoryPath: string) => {
    try {
      await ensureDirectoryExists(directoryPath)
      const targetPath = await getUniqueFilePath(directoryPath, fileName)
      await fs.writeFile(targetPath, Buffer.from(videoData))
      return {
        success: true,
        path: targetPath,
        message: 'Video exported successfully',
      }
    } catch (error) {
      console.error('Failed to save exported video to directory:', error)
      return {
        success: false,
        message: 'Failed to save exported video',
        error: String(error),
      }
    }
  })

  ipcMain.handle('open-directory', async (_, directoryPath: string) => {
    try {
      await ensureDirectoryExists(directoryPath)
      const errorMessage = await shell.openPath(directoryPath)
      if (errorMessage) {
        return { success: false, message: errorMessage }
      }
      return { success: true }
    } catch (error) {
      console.error('Failed to open directory:', error)
      return { success: false, message: 'Failed to open directory', error: String(error) }
    }
  })

  ipcMain.handle('open-video-file-picker', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Video File',
        defaultPath: RECORDINGS_DIR,
        filters: [
          { name: 'Video Files', extensions: ['webm', 'mp4', 'mov', 'avi', 'mkv'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }

      return {
        success: true,
        path: result.filePaths[0]
      };
    } catch (error) {
      console.error('Failed to open file picker:', error);
      return {
        success: false,
        message: 'Failed to open file picker',
        error: String(error)
      };
    }
  });

  ipcMain.handle('set-current-video-path', async (_, videoPath: string) => {
    currentVideoPath = videoPath;
    const loadedTelemetry = await loadTelemetryForVideo(videoPath)
    currentRecordingSession = loadedTelemetry
      ? {
          id: `session-${Date.now()}`,
          startedAtMs: Date.now(),
          screenVideoPath: videoPath,
          micEnabled: false,
          micCaptured: false,
          cameraEnabled: false,
          cameraCaptured: false,
          screenDurationMs: 0,
          inputTelemetryPath: loadedTelemetry.path,
          inputTelemetry: loadedTelemetry.telemetry,
        }
      : null;
    console.info('[auto-zoom][main] set-current-video-path complete', {
      videoPath,
      hasTelemetry: Boolean(loadedTelemetry),
      telemetryPath: loadedTelemetry?.path,
      generatedSessionId: currentRecordingSession?.id,
    })
    return { success: true };
  });

  ipcMain.handle('get-current-video-path', () => {
    return currentVideoPath ? { success: true, path: currentVideoPath } : { success: false };
  });

  ipcMain.handle('clear-current-video-path', () => {
    currentVideoPath = null;
    currentRecordingSession = null;
    recordingFinalizationState = { status: 'idle' }
    return { success: true };
  });

  ipcMain.handle('set-current-recording-session', (_, session: Record<string, unknown>) => {
    currentRecordingSession = session;
    currentVideoPath = typeof session.screenVideoPath === 'string' ? session.screenVideoPath : null;
    recordingFinalizationState = {
      status: 'ready',
      sessionId: typeof session.id === 'string' ? session.id : undefined,
      progressPhase: 'done',
    }
    broadcastRecordingSessionReady()
    console.info('[auto-zoom][main] set-current-recording-session', {
      sessionId: typeof session.id === 'string' ? session.id : undefined,
      hasTelemetry: Boolean(session.inputTelemetry),
      telemetryPath: typeof session.inputTelemetryPath === 'string' ? session.inputTelemetryPath : undefined,
    })
    return { success: true };
  });

  ipcMain.handle('get-current-recording-session', () => {
    console.info('[auto-zoom][main] get-current-recording-session', {
      hasSession: Boolean(currentRecordingSession),
      sessionId: typeof currentRecordingSession?.id === 'string' ? currentRecordingSession.id : undefined,
      hasTelemetry: Boolean(currentRecordingSession?.inputTelemetry),
    })
    return currentRecordingSession
      ? { success: true, session: currentRecordingSession }
      : { success: false };
  });

  ipcMain.handle('set-recording-finalization-state', (_, partial: Partial<RecordingFinalizationState>) => {
    recordingFinalizationState = {
      ...recordingFinalizationState,
      ...partial,
    }
    return { success: true, state: recordingFinalizationState }
  })

  ipcMain.handle('get-recording-finalization-state', () => {
    return { success: true, ...recordingFinalizationState }
  })

  ipcMain.handle('get-platform', () => {
    return process.platform;
  });
}
