import { ipcMain, screen, BrowserWindow, desktopCapturer, shell, app, dialog, nativeImage, Tray, Menu } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL$1 = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST$1 = path.join(APP_ROOT, "dist");
let hudOverlayWindow = null;
let cameraPreviewWindow = null;
ipcMain.on("hud-overlay-hide", () => {
  if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
    hudOverlayWindow.minimize();
  }
  if (cameraPreviewWindow && !cameraPreviewWindow.isDestroyed()) {
    cameraPreviewWindow.minimize();
  }
});
function createHudOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;
  const windowWidth = 500;
  const windowHeight = 100;
  const x = Math.floor(workArea.x + (workArea.width - windowWidth) / 2);
  const y = Math.floor(workArea.y + workArea.height - windowHeight - 5);
  const win = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 500,
    maxWidth: 1100,
    minHeight: 100,
    maxHeight: 100,
    x,
    y,
    frame: false,
    thickFrame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });
  win.setContentProtection(true);
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  hudOverlayWindow = win;
  win.on("closed", () => {
    if (hudOverlayWindow === win) {
      hudOverlayWindow = null;
    }
  });
  win.on("minimize", () => {
    if (cameraPreviewWindow && !cameraPreviewWindow.isDestroyed()) {
      cameraPreviewWindow.minimize();
    }
  });
  if (VITE_DEV_SERVER_URL$1) {
    win.loadURL(VITE_DEV_SERVER_URL$1 + "?windowType=hud-overlay");
  } else {
    win.loadFile(path.join(RENDERER_DIST$1, "index.html"), {
      query: { windowType: "hud-overlay" }
    });
  }
  return win;
}
function createEditorWindow() {
  const isMac = process.platform === "darwin";
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    ...isMac && {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 12, y: 12 }
    },
    transparent: false,
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    title: "OpenScreen",
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      backgroundThrottling: false
    }
  });
  win.maximize();
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL$1) {
    win.loadURL(VITE_DEV_SERVER_URL$1 + "?windowType=editor");
  } else {
    win.loadFile(path.join(RENDERER_DIST$1, "index.html"), {
      query: { windowType: "editor" }
    });
  }
  return win;
}
function createSourceSelectorWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
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
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  win.setContentProtection(true);
  if (VITE_DEV_SERVER_URL$1) {
    win.loadURL(VITE_DEV_SERVER_URL$1 + "?windowType=source-selector");
  } else {
    win.loadFile(path.join(RENDERER_DIST$1, "index.html"), {
      query: { windowType: "source-selector" }
    });
  }
  return win;
}
function createCameraPreviewWindow(deviceId) {
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
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });
  win.setContentProtection(true);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAspectRatio(16 / 9);
  const query = { windowType: "camera-preview", ...deviceId ? { deviceId } : {} };
  if (VITE_DEV_SERVER_URL$1) {
    const url = new URL(VITE_DEV_SERVER_URL$1);
    url.searchParams.set("windowType", "camera-preview");
    if (deviceId) {
      url.searchParams.set("deviceId", deviceId);
    }
    win.loadURL(url.toString());
  } else {
    win.loadFile(path.join(RENDERER_DIST$1, "index.html"), { query });
  }
  cameraPreviewWindow = win;
  win.on("closed", () => {
    if (cameraPreviewWindow === win) {
      cameraPreviewWindow = null;
    }
  });
  return win;
}
function closeCameraPreviewWindow() {
  if (cameraPreviewWindow && !cameraPreviewWindow.isDestroyed()) {
    cameraPreviewWindow.close();
  }
  cameraPreviewWindow = null;
}
function getCameraPreviewWindow() {
  return cameraPreviewWindow && !cameraPreviewWindow.isDestroyed() ? cameraPreviewWindow : null;
}
let selectedSource = null;
let currentVideoPath = null;
let currentRecordingSession = null;
function registerIpcHandlers(createEditorWindow2, createSourceSelectorWindow2, createCameraPreviewWindow2, closeCameraPreviewWindow2, getMainWindow, getSourceSelectorWindow, getCameraPreviewWindow2, onRecordingStateChange) {
  ipcMain.handle("get-sources", async (_, opts) => {
    const sources = await desktopCapturer.getSources(opts);
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      display_id: source.display_id,
      thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
      appIcon: source.appIcon ? source.appIcon.toDataURL() : null
    }));
  });
  ipcMain.handle("select-source", (_, source) => {
    selectedSource = source;
    const sourceSelectorWin = getSourceSelectorWindow();
    if (sourceSelectorWin) {
      sourceSelectorWin.close();
    }
    return selectedSource;
  });
  ipcMain.handle("get-selected-source", () => {
    return selectedSource;
  });
  ipcMain.handle("open-source-selector", () => {
    const sourceSelectorWin = getSourceSelectorWindow();
    if (sourceSelectorWin) {
      sourceSelectorWin.focus();
      return;
    }
    createSourceSelectorWindow2();
  });
  ipcMain.handle("open-camera-preview-window", (_, deviceId) => {
    const current = getCameraPreviewWindow2();
    if (current) {
      current.close();
    }
    const win = createCameraPreviewWindow2(deviceId);
    win.focus();
    return { success: true };
  });
  ipcMain.handle("close-camera-preview-window", () => {
    closeCameraPreviewWindow2();
    return { success: true };
  });
  ipcMain.handle("switch-to-editor", () => {
    const mainWin = getMainWindow();
    if (mainWin) {
      mainWin.close();
    }
    createEditorWindow2();
  });
  ipcMain.handle("store-recorded-video", async (_, videoData, fileName) => {
    try {
      const videoPath = path.join(RECORDINGS_DIR, fileName);
      await fs.writeFile(videoPath, Buffer.from(videoData));
      currentVideoPath = videoPath;
      currentRecordingSession = null;
      return {
        success: true,
        path: videoPath,
        message: "Video stored successfully"
      };
    } catch (error) {
      console.error("Failed to store video:", error);
      return {
        success: false,
        message: "Failed to store video",
        error: String(error)
      };
    }
  });
  ipcMain.handle("set-hud-overlay-width", (_, width) => {
    const mainWin = getMainWindow();
    if (!mainWin || mainWin.isDestroyed()) {
      return { success: false };
    }
    const clampedWidth = Math.max(500, Math.min(1100, Math.round(width)));
    const bounds = mainWin.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const workArea = display.workArea;
    const x = Math.floor(workArea.x + (workArea.width - clampedWidth) / 2);
    const y = Math.floor(workArea.y + workArea.height - bounds.height - 5);
    mainWin.setBounds({
      x,
      y,
      width: clampedWidth,
      height: bounds.height
    }, true);
    return { success: true };
  });
  ipcMain.handle("store-recording-session", async (_, payload) => {
    try {
      const screenVideoPath = path.join(RECORDINGS_DIR, payload.screenFileName);
      await fs.writeFile(screenVideoPath, Buffer.from(payload.screenVideoData));
      let cameraVideoPath;
      if (payload.cameraVideoData && payload.cameraFileName) {
        cameraVideoPath = path.join(RECORDINGS_DIR, payload.cameraFileName);
        await fs.writeFile(cameraVideoPath, Buffer.from(payload.cameraVideoData));
      }
      const session = {
        ...payload.session,
        screenVideoPath,
        ...cameraVideoPath ? { cameraVideoPath } : {}
      };
      currentRecordingSession = session;
      currentVideoPath = screenVideoPath;
      return {
        success: true,
        session,
        message: "Recording session stored successfully"
      };
    } catch (error) {
      console.error("Failed to store recording session:", error);
      return {
        success: false,
        message: "Failed to store recording session",
        error: String(error)
      };
    }
  });
  ipcMain.handle("get-recorded-video-path", async () => {
    try {
      const files = await fs.readdir(RECORDINGS_DIR);
      const videoFiles = files.filter((file) => file.endsWith(".webm"));
      if (videoFiles.length === 0) {
        return { success: false, message: "No recorded video found" };
      }
      const latestVideo = videoFiles.sort().reverse()[0];
      const videoPath = path.join(RECORDINGS_DIR, latestVideo);
      return { success: true, path: videoPath };
    } catch (error) {
      console.error("Failed to get video path:", error);
      return { success: false, message: "Failed to get video path", error: String(error) };
    }
  });
  ipcMain.handle("set-recording-state", (_, recording) => {
    const source = selectedSource || { name: "Screen" };
    if (onRecordingStateChange) {
      onRecordingStateChange(recording, source.name);
    }
  });
  ipcMain.handle("open-external-url", async (_, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error("Failed to open URL:", error);
      return { success: false, error: String(error) };
    }
  });
  ipcMain.handle("get-asset-base-path", () => {
    try {
      if (app.isPackaged) {
        return path.join(process.resourcesPath, "assets");
      }
      return path.join(app.getAppPath(), "public", "assets");
    } catch (err) {
      console.error("Failed to resolve asset base path:", err);
      return null;
    }
  });
  ipcMain.handle("save-exported-video", async (_, videoData, fileName) => {
    try {
      const isGif = fileName.toLowerCase().endsWith(".gif");
      const filters = isGif ? [{ name: "GIF Image", extensions: ["gif"] }] : [{ name: "MP4 Video", extensions: ["mp4"] }];
      const result = await dialog.showSaveDialog({
        title: isGif ? "Save Exported GIF" : "Save Exported Video",
        defaultPath: path.join(app.getPath("downloads"), fileName),
        filters,
        properties: ["createDirectory", "showOverwriteConfirmation"]
      });
      if (result.canceled || !result.filePath) {
        return {
          success: false,
          cancelled: true,
          message: "Export cancelled"
        };
      }
      await fs.writeFile(result.filePath, Buffer.from(videoData));
      return {
        success: true,
        path: result.filePath,
        message: "Video exported successfully"
      };
    } catch (error) {
      console.error("Failed to save exported video:", error);
      return {
        success: false,
        message: "Failed to save exported video",
        error: String(error)
      };
    }
  });
  ipcMain.handle("open-video-file-picker", async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: "Select Video File",
        defaultPath: RECORDINGS_DIR,
        filters: [
          { name: "Video Files", extensions: ["webm", "mp4", "mov", "avi", "mkv"] },
          { name: "All Files", extensions: ["*"] }
        ],
        properties: ["openFile"]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }
      return {
        success: true,
        path: result.filePaths[0]
      };
    } catch (error) {
      console.error("Failed to open file picker:", error);
      return {
        success: false,
        message: "Failed to open file picker",
        error: String(error)
      };
    }
  });
  ipcMain.handle("set-current-video-path", (_, path2) => {
    currentVideoPath = path2;
    currentRecordingSession = null;
    return { success: true };
  });
  ipcMain.handle("get-current-video-path", () => {
    return currentVideoPath ? { success: true, path: currentVideoPath } : { success: false };
  });
  ipcMain.handle("clear-current-video-path", () => {
    currentVideoPath = null;
    currentRecordingSession = null;
    return { success: true };
  });
  ipcMain.handle("set-current-recording-session", (_, session) => {
    currentRecordingSession = session;
    currentVideoPath = typeof session.screenVideoPath === "string" ? session.screenVideoPath : null;
    return { success: true };
  });
  ipcMain.handle("get-current-recording-session", () => {
    return currentRecordingSession ? { success: true, session: currentRecordingSession } : { success: false };
  });
  ipcMain.handle("get-platform", () => {
    return process.platform;
  });
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECORDINGS_DIR = path.join(app.getPath("userData"), "recordings");
async function ensureRecordingsDir() {
  try {
    await fs.mkdir(RECORDINGS_DIR, { recursive: true });
    console.log("RECORDINGS_DIR:", RECORDINGS_DIR);
    console.log("User Data Path:", app.getPath("userData"));
  } catch (error) {
    console.error("Failed to create recordings directory:", error);
  }
}
process.env.APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let mainWindow = null;
let sourceSelectorWindow = null;
let tray = null;
let selectedSourceName = "";
const defaultTrayIcon = getTrayIcon("openscreen.png");
const recordingTrayIcon = getTrayIcon("rec-button.png");
function createWindow() {
  mainWindow = createHudOverlayWindow();
}
function createTray() {
  tray = new Tray(defaultTrayIcon);
  if (process.platform === "win32") {
    tray.on("double-click", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow();
      }
    });
  }
}
function getTrayIcon(filename) {
  return nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC || RENDERER_DIST, filename)).resize({
    width: 24,
    height: 24,
    quality: "best"
  });
}
function updateTrayMenu(recording = false) {
  if (!tray) return;
  const trayIcon = recording ? recordingTrayIcon : defaultTrayIcon;
  const trayToolTip = recording ? `Recording: ${selectedSourceName}` : "OpenScreen";
  const menuTemplate = recording ? [
    {
      label: "Stop Recording",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("stop-recording-from-tray");
        }
      }
    }
  ] : [
    {
      label: "Open",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.isMinimized() && mainWindow.restore();
        } else {
          createWindow();
        }
      }
    },
    {
      label: "Quit",
      click: () => {
        app.quit();
      }
    }
  ];
  tray.setImage(trayIcon);
  tray.setToolTip(trayToolTip);
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}
function createEditorWindowWrapper() {
  if (mainWindow) {
    mainWindow.close();
    mainWindow = null;
  }
  closeCameraPreviewWindow();
  mainWindow = createEditorWindow();
}
function createSourceSelectorWindowWrapper() {
  sourceSelectorWindow = createSourceSelectorWindow();
  sourceSelectorWindow.on("closed", () => {
    sourceSelectorWindow = null;
  });
  return sourceSelectorWindow;
}
app.on("window-all-closed", () => {
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.whenReady().then(async () => {
  const { ipcMain: ipcMain2 } = await import("electron");
  ipcMain2.on("hud-overlay-close", () => {
    app.quit();
  });
  createTray();
  updateTrayMenu();
  await ensureRecordingsDir();
  registerIpcHandlers(
    createEditorWindowWrapper,
    createSourceSelectorWindowWrapper,
    createCameraPreviewWindow,
    closeCameraPreviewWindow,
    () => mainWindow,
    () => sourceSelectorWindow,
    () => getCameraPreviewWindow(),
    (recording, sourceName) => {
      selectedSourceName = sourceName;
      if (!tray) createTray();
      updateTrayMenu(recording);
      if (!recording) {
        if (mainWindow) mainWindow.restore();
      }
    }
  );
  createWindow();
});
export {
  MAIN_DIST,
  RECORDINGS_DIR,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
