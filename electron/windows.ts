import { BrowserWindow, screen } from 'electron'
import { ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const APP_ROOT = path.join(__dirname, '..')
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(APP_ROOT, 'dist')

let hudOverlayWindow: BrowserWindow | null = null;
let cameraPreviewWindow: BrowserWindow | null = null;

ipcMain.on('hud-overlay-hide', () => {
  if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
    hudOverlayWindow.minimize();
  }
  if (cameraPreviewWindow && !cameraPreviewWindow.isDestroyed()) {
    cameraPreviewWindow.minimize();
  }
});

export function createHudOverlayWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;


  const windowWidth = 500;
  const windowHeight = 120;

  const x = Math.floor(workArea.x + (workArea.width - windowWidth) / 2);
  const y = Math.floor(workArea.y + workArea.height - windowHeight - 5);

  const win = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 500,
    maxWidth: 1400,
    minHeight: 100,
    maxHeight: 720,
    x: x,
    y: y,
    frame: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  })
  win.setContentProtection(true);


  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  hudOverlayWindow = win;

  win.on('closed', () => {
    if (hudOverlayWindow === win) {
      hudOverlayWindow = null;
    }
  });

  win.on('minimize', () => {
    if (cameraPreviewWindow && !cameraPreviewWindow.isDestroyed()) {
      cameraPreviewWindow.minimize();
    }
  });


  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL + '?windowType=hud-overlay')
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'), { 
      query: { windowType: 'hud-overlay' } 
    })
  }

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.showInactive();
    }
  });

  return win
}

export function createEditorWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    ...(isMac && {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 12 },
    }),
    transparent: false,
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    title: 'velocity',
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      backgroundThrottling: false,
    },
  })

  // Maximize the window by default
  win.maximize();

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL + '?windowType=editor')
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'), { 
      query: { windowType: 'editor' } 
    })
  }

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.show();
    }
  });

  return win
}

export function createSourceSelectorWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  
  const win = new BrowserWindow({
    width: 620,
    height: 420,
    minHeight: 350,
    maxHeight: 500,
    x: Math.round((width - 620) / 2),
    y: Math.round((height - 420) / 2),
    frame: false,
    thickFrame: false,
    resizable: false,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  win.setContentProtection(true);

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL + '?windowType=source-selector')
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'), { 
      query: { windowType: 'source-selector' } 
    })
  }

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.show();
    }
  });

  return win
}

export function createCameraPreviewWindow(deviceId?: string): BrowserWindow {
  if (cameraPreviewWindow && !cameraPreviewWindow.isDestroyed()) {
    cameraPreviewWindow.focus();
    return cameraPreviewWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;

  const windowWidth = 320;
  const windowHeight = 200;
  const x = Math.floor(workArea.x + workArea.width - windowWidth - 24);
  const y = Math.floor(workArea.y + workArea.height - windowHeight - 140);

  const win = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 220,
    minHeight: 140,
    x,
    y,
    frame: false,
    thickFrame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  win.setContentProtection(true);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAspectRatio(16 / 9);

  const query = { windowType: 'camera-preview', ...(deviceId ? { deviceId } : {}) };
  if (VITE_DEV_SERVER_URL) {
    const url = new URL(VITE_DEV_SERVER_URL);
    url.searchParams.set('windowType', 'camera-preview');
    if (deviceId) {
      url.searchParams.set('deviceId', deviceId);
    }
    win.loadURL(url.toString());
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'), { query });
  }

  cameraPreviewWindow = win;
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.showInactive();
    }
  });
  win.on('closed', () => {
    if (cameraPreviewWindow === win) {
      cameraPreviewWindow = null;
    }
  });

  return win;
}

export function closeCameraPreviewWindow() {
  if (cameraPreviewWindow && !cameraPreviewWindow.isDestroyed()) {
    cameraPreviewWindow.close();
  }
  cameraPreviewWindow = null;
}

export function getCameraPreviewWindow(): BrowserWindow | null {
  return cameraPreviewWindow && !cameraPreviewWindow.isDestroyed() ? cameraPreviewWindow : null;
}
