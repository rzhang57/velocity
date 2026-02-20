import { ipcMain, desktopCapturer, BrowserWindow, shell, app, dialog, screen } from 'electron'

import fs from 'node:fs/promises'
import path from 'node:path'
import { RECORDINGS_DIR } from '../main'
import { InputTrackingService } from '../services/inputTrackingService'
import type { InputTelemetryFileV1 } from '@/types/inputTelemetry'

let selectedSource: any = null
let currentVideoPath: string | null = null
let currentRecordingSession: any = null
const inputTrackingService = new InputTrackingService()

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
  createHudOverlayWindow: () => void,
  createSourceSelectorWindow: () => BrowserWindow,
  createCameraPreviewWindow: (deviceId?: string) => BrowserWindow,
  closeCameraPreviewWindow: () => void,
  getMainWindow: () => BrowserWindow | null,
  getSourceSelectorWindow: () => BrowserWindow | null,
  getCameraPreviewWindow: () => BrowserWindow | null,
  onRecordingStateChange?: (recording: boolean, sourceName: string) => void
) {
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
    const result = inputTrackingService.start(payload, selectedSource)
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
    const mainWin = getMainWindow()
    if (mainWin) {
      mainWin.close()
    }
    createEditorWindow()
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

  ipcMain.handle('start-new-recording-session', async (_, payload?: {
    replaceCurrentTake?: boolean
    session?: {
      screenVideoPath?: string
      cameraVideoPath?: string
      inputTelemetryPath?: string
    }
  }) => {
    const replaceCurrentTake = Boolean(payload?.replaceCurrentTake)
    if (replaceCurrentTake && payload?.session) {
      await deleteFileIfExists(payload.session.screenVideoPath)
      await deleteFileIfExists(payload.session.cameraVideoPath)
      await deleteFileIfExists(payload.session.inputTelemetryPath)
    }

    currentRecordingSession = null
    currentVideoPath = null
    createHudOverlayWindow()
    return { success: true }
  })

  ipcMain.handle('set-hud-overlay-width', (_, width: number) => {
    const mainWin = getMainWindow()
    if (!mainWin || mainWin.isDestroyed()) {
      return { success: false }
    }

    const clampedWidth = Math.max(500, Math.min(1100, Math.round(width)))
    const bounds = mainWin.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const x = Math.floor(workArea.x + (workArea.width - clampedWidth) / 2)
    const y = Math.floor(workArea.y + workArea.height - bounds.height - 5)

    mainWin.setBounds({
      x,
      y,
      width: clampedWidth,
      height: bounds.height,
    }, true)
    return { success: true }
  })

  ipcMain.handle('set-hud-overlay-height', (_, height: number) => {
    const mainWin = getMainWindow()
    if (!mainWin || mainWin.isDestroyed()) {
      return { success: false }
    }

    const clampedHeight = Math.max(100, Math.min(420, Math.round(height)))
    const bounds = mainWin.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const workArea = display.workArea
    const x = Math.floor(workArea.x + (workArea.width - bounds.width) / 2)
    const y = Math.floor(workArea.y + workArea.height - clampedHeight - 5)

    mainWin.setBounds({
      x,
      y,
      width: bounds.width,
      height: clampedHeight,
    }, true)
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
      return {
        success: false,
        message: 'Failed to store recording session',
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
    const source = selectedSource || { name: 'Screen' }
    if (onRecordingStateChange) {
      onRecordingStateChange(recording, source.name)
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
    return { success: true };
  });

  ipcMain.handle('set-current-recording-session', (_, session: Record<string, unknown>) => {
    currentRecordingSession = session;
    currentVideoPath = typeof session.screenVideoPath === 'string' ? session.screenVideoPath : null;
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

  ipcMain.handle('get-platform', () => {
    return process.platform;
  });
}
