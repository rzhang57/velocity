var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { ipcMain, screen, BrowserWindow, desktopCapturer, shell, app, dialog, nativeImage, Tray, Menu } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
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
class NativeHookProvider {
  constructor() {
    __publicField(this, "hook", null);
    __publicField(this, "handlers", []);
  }
  start(callbacks) {
    const require2 = createRequire(import.meta.url);
    let mod;
    try {
      mod = require2("uiohook-napi");
    } catch {
      return { success: false, message: "uiohook-napi is not installed" };
    }
    const hook = (mod == null ? void 0 : mod.uIOhook) ?? (mod == null ? void 0 : mod.default) ?? mod;
    if (!hook || typeof hook.on !== "function" || typeof hook.start !== "function" || typeof hook.stop !== "function") {
      return { success: false, message: "uiohook-napi loaded, but API shape is unsupported" };
    }
    this.hook = hook;
    this.handlers = [
      { name: "mousedown", cb: callbacks.onMouseDown },
      { name: "mouseup", cb: callbacks.onMouseUp },
      { name: "mousemove", cb: callbacks.onMouseMove },
      { name: "wheel", cb: callbacks.onWheel },
      { name: "keydown", cb: callbacks.onKeyDown }
    ];
    try {
      for (const handler of this.handlers) {
        this.hook.on(handler.name, handler.cb);
      }
      this.hook.start();
      return { success: true };
    } catch (error) {
      this.stop();
      return { success: false, message: `Failed to start native hook: ${String(error)}` };
    }
  }
  stop() {
    var _a, _b;
    if (!this.hook) {
      return;
    }
    try {
      for (const handler of this.handlers) {
        if (typeof ((_a = this.hook) == null ? void 0 : _a.off) === "function") {
          this.hook.off(handler.name, handler.cb);
        } else if (typeof ((_b = this.hook) == null ? void 0 : _b.removeListener) === "function") {
          this.hook.removeListener(handler.name, handler.cb);
        }
      }
      this.hook.stop();
      if (typeof this.hook.removeAllListeners === "function") {
        this.hook.removeAllListeners();
      }
    } catch {
    } finally {
      this.handlers = [];
      this.hook = null;
    }
  }
}
function createEmptyStats() {
  return {
    totalEvents: 0,
    mouseDownCount: 0,
    mouseUpCount: 0,
    mouseMoveCount: 0,
    wheelCount: 0,
    keyDownCount: 0
  };
}
function incrementStats(stats, event) {
  stats.totalEvents += 1;
  switch (event.type) {
    case "mouseDown":
      stats.mouseDownCount += 1;
      break;
    case "mouseUp":
      stats.mouseUpCount += 1;
      break;
    case "mouseMoveSampled":
      stats.mouseMoveCount += 1;
      break;
    case "wheel":
      stats.wheelCount += 1;
      break;
    case "keyDownCategory":
      stats.keyDownCount += 1;
      break;
  }
}
function detectSourceKind(sourceId) {
  if (!sourceId) return "unknown";
  if (sourceId.startsWith("screen:")) return "screen";
  if (sourceId.startsWith("window:")) return "window";
  return "unknown";
}
function resolveSourceBounds(sourceKind, sourceDisplayId) {
  if (sourceKind !== "screen") {
    return void 0;
  }
  const displays = screen.getAllDisplays();
  const byDisplayId = displays.find((display) => String(display.id) === sourceDisplayId);
  const targetDisplay = byDisplayId ?? screen.getPrimaryDisplay();
  const { x, y, width, height } = targetDisplay.bounds;
  return { x, y, width, height };
}
function categorizeKey(raw) {
  if (raw.ctrlKey || raw.altKey || raw.metaKey) return "shortcut";
  const keycode = raw.keycode ?? raw.rawcode ?? -1;
  if (keycode === 14 || keycode === 8) return "backspace";
  if (keycode === 15 || keycode === 9) return "tab";
  if (keycode === 28 || keycode === 13) return "enter";
  if ([29, 42, 54, 56, 3613, 3675].includes(keycode)) return "modifier";
  if (keycode >= 2 && keycode <= 13 || keycode >= 16 && keycode <= 27 || keycode >= 30 && keycode <= 53) {
    return "printable";
  }
  return "other";
}
class InputTrackingService {
  constructor() {
    __publicField(this, "provider", new NativeHookProvider());
    __publicField(this, "events", []);
    __publicField(this, "stats", createEmptyStats());
    __publicField(this, "currentSession", null);
    __publicField(this, "lastMoveTs", 0);
    __publicField(this, "lastMoveX", -1);
    __publicField(this, "lastMoveY", -1);
  }
  start(payload, selectedSource2) {
    this.stop();
    const sourceId = payload.sourceId ?? (selectedSource2 == null ? void 0 : selectedSource2.id);
    const sourceDisplayId = payload.sourceDisplayId ?? (selectedSource2 == null ? void 0 : selectedSource2.display_id);
    const sourceKind = detectSourceKind(sourceId);
    const sourceBounds = resolveSourceBounds(sourceKind, sourceDisplayId);
    this.currentSession = {
      sessionId: payload.sessionId,
      startedAtMs: payload.startedAtMs,
      sourceKind,
      sourceId,
      sourceDisplayId,
      sourceBounds
    };
    this.events = [];
    this.stats = createEmptyStats();
    this.lastMoveTs = 0;
    this.lastMoveX = -1;
    this.lastMoveY = -1;
    const startResult = this.provider.start({
      onMouseDown: (event) => {
        this.pushEvent({
          type: "mouseDown",
          ts: Date.now(),
          x: Number(event.x ?? 0),
          y: Number(event.y ?? 0),
          button: Number(event.button ?? 0)
        });
      },
      onMouseUp: (event) => {
        this.pushEvent({
          type: "mouseUp",
          ts: Date.now(),
          x: Number(event.x ?? 0),
          y: Number(event.y ?? 0),
          button: Number(event.button ?? 0)
        });
      },
      onMouseMove: (event) => {
        const now = Date.now();
        const x = Number(event.x ?? 0);
        const y = Number(event.y ?? 0);
        const minIntervalMs = 33;
        const minDeltaPx = 4;
        const dx = x - this.lastMoveX;
        const dy = y - this.lastMoveY;
        const distanceSq = dx * dx + dy * dy;
        if (now - this.lastMoveTs < minIntervalMs && distanceSq < minDeltaPx * minDeltaPx) {
          return;
        }
        this.lastMoveTs = now;
        this.lastMoveX = x;
        this.lastMoveY = y;
        this.pushEvent({
          type: "mouseMoveSampled",
          ts: now,
          x,
          y
        });
      },
      onWheel: (event) => {
        const deltaY = Number(event.deltaY ?? event.amount ?? event.rotation ?? 0);
        const deltaX = Number(event.deltaX ?? 0);
        this.pushEvent({
          type: "wheel",
          ts: Date.now(),
          x: Number(event.x ?? 0),
          y: Number(event.y ?? 0),
          deltaX,
          deltaY
        });
      },
      onKeyDown: (event) => {
        this.pushEvent({
          type: "keyDownCategory",
          ts: Date.now(),
          category: categorizeKey(event)
        });
      }
    });
    if (!startResult.success) {
      this.currentSession = null;
      this.events = [];
      this.stats = createEmptyStats();
      return startResult;
    }
    return startResult;
  }
  stop() {
    this.provider.stop();
    if (!this.currentSession) {
      return null;
    }
    const telemetry = {
      version: 1,
      sessionId: this.currentSession.sessionId,
      startedAtMs: this.currentSession.startedAtMs,
      sourceKind: this.currentSession.sourceKind,
      sourceId: this.currentSession.sourceId,
      sourceDisplayId: this.currentSession.sourceDisplayId,
      sourceBounds: this.currentSession.sourceBounds,
      events: this.events,
      stats: this.stats
    };
    this.currentSession = null;
    this.events = [];
    this.stats = createEmptyStats();
    return telemetry;
  }
  pushEvent(event) {
    this.events.push(event);
    incrementStats(this.stats, event);
  }
}
let selectedSource = null;
let currentVideoPath = null;
let currentRecordingSession = null;
const inputTrackingService = new InputTrackingService();
function getTelemetryFilePath(videoPath) {
  const parsed = path.parse(videoPath);
  return path.join(parsed.dir, `${parsed.name}.telemetry.json`);
}
async function loadTelemetryForVideo(videoPath) {
  var _a;
  const telemetryPath = getTelemetryFilePath(videoPath);
  try {
    const raw = await fs.readFile(telemetryPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.events)) {
      console.info("[auto-zoom][main] Telemetry sidecar loaded", {
        telemetryPath,
        sessionId: parsed.sessionId,
        totalEvents: ((_a = parsed.stats) == null ? void 0 : _a.totalEvents) ?? 0
      });
      return { path: telemetryPath, telemetry: parsed };
    }
    console.warn("[auto-zoom][main] Telemetry sidecar was present but invalid format", {
      telemetryPath
    });
  } catch {
    console.info("[auto-zoom][main] No telemetry sidecar found for video", {
      videoPath,
      telemetryPath
    });
  }
  return null;
}
function registerIpcHandlers(createEditorWindow2, createHudOverlayWindow2, createSourceSelectorWindow2, createCameraPreviewWindow2, closeCameraPreviewWindow2, getMainWindow, getSourceSelectorWindow, getCameraPreviewWindow2, onRecordingStateChange) {
  const deleteFileIfExists = async (filePath) => {
    if (!filePath) return;
    try {
      await fs.unlink(filePath);
      console.info("[editor][main] Deleted recording asset", { filePath });
    } catch {
      console.warn("[editor][main] Could not delete recording asset (ignored)", { filePath });
    }
  };
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
  ipcMain.handle("start-input-tracking", (_, payload) => {
    console.info("[auto-zoom][main] start-input-tracking requested", {
      sessionId: payload.sessionId,
      sourceId: payload.sourceId,
      sourceDisplayId: payload.sourceDisplayId,
      selectedSourceId: selectedSource == null ? void 0 : selectedSource.id,
      selectedSourceDisplayId: selectedSource == null ? void 0 : selectedSource.display_id
    });
    const result = inputTrackingService.start(payload, selectedSource);
    if (result.success) {
      console.info("[auto-zoom][main] Input tracking started", {
        sessionId: payload.sessionId
      });
    } else {
      console.warn("[auto-zoom][main] Input tracking failed to start", {
        sessionId: payload.sessionId,
        message: result.message
      });
    }
    return result;
  });
  ipcMain.handle("stop-input-tracking", () => {
    const telemetry = inputTrackingService.stop();
    if (telemetry) {
      console.info("[auto-zoom][main] Input tracking stopped with telemetry", {
        sessionId: telemetry.sessionId,
        totalEvents: telemetry.stats.totalEvents,
        mouseDownCount: telemetry.stats.mouseDownCount,
        keyDownCount: telemetry.stats.keyDownCount,
        wheelCount: telemetry.stats.wheelCount
      });
      return { success: true, telemetry };
    }
    console.warn("[auto-zoom][main] stop-input-tracking called with no active tracking session");
    return { success: false, message: "No active input tracking session" };
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
  ipcMain.handle("start-new-recording-session", async (_, payload) => {
    const replaceCurrentTake = Boolean(payload == null ? void 0 : payload.replaceCurrentTake);
    if (replaceCurrentTake && (payload == null ? void 0 : payload.session)) {
      await deleteFileIfExists(payload.session.screenVideoPath);
      await deleteFileIfExists(payload.session.cameraVideoPath);
      await deleteFileIfExists(payload.session.inputTelemetryPath);
    }
    currentRecordingSession = null;
    currentVideoPath = null;
    createHudOverlayWindow2();
    return { success: true };
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
      console.info("[auto-zoom][main] store-recording-session requested", {
        sessionId: typeof payload.session.id === "string" ? payload.session.id : void 0,
        screenFileName: payload.screenFileName,
        hasCameraVideo: Boolean(payload.cameraVideoData && payload.cameraFileName),
        hasTelemetry: Boolean(payload.inputTelemetry)
      });
      const screenVideoPath = path.join(RECORDINGS_DIR, payload.screenFileName);
      await fs.writeFile(screenVideoPath, Buffer.from(payload.screenVideoData));
      let cameraVideoPath;
      if (payload.cameraVideoData && payload.cameraFileName) {
        cameraVideoPath = path.join(RECORDINGS_DIR, payload.cameraFileName);
        await fs.writeFile(cameraVideoPath, Buffer.from(payload.cameraVideoData));
      }
      let inputTelemetryPath;
      let inputTelemetry;
      if (payload.inputTelemetry) {
        const telemetryFileName = payload.inputTelemetryFileName || `${path.parse(payload.screenFileName).name}.telemetry.json`;
        inputTelemetryPath = path.join(RECORDINGS_DIR, telemetryFileName);
        await fs.writeFile(inputTelemetryPath, JSON.stringify(payload.inputTelemetry), "utf-8");
        inputTelemetry = payload.inputTelemetry;
        console.info("[auto-zoom][main] Telemetry sidecar saved", {
          inputTelemetryPath,
          sessionId: payload.inputTelemetry.sessionId,
          totalEvents: payload.inputTelemetry.stats.totalEvents
        });
      } else {
        console.warn("[auto-zoom][main] Recording session stored without telemetry payload", {
          sessionId: typeof payload.session.id === "string" ? payload.session.id : void 0
        });
      }
      const session = {
        ...payload.session,
        screenVideoPath,
        ...cameraVideoPath ? { cameraVideoPath } : {},
        ...inputTelemetryPath ? { inputTelemetryPath } : {},
        ...inputTelemetry ? { inputTelemetry } : {}
      };
      currentRecordingSession = session;
      currentVideoPath = screenVideoPath;
      console.info("[auto-zoom][main] Recording session stored in memory", {
        sessionId: typeof payload.session.id === "string" ? payload.session.id : void 0,
        screenVideoPath,
        inputTelemetryPath
      });
      return {
        success: true,
        session,
        message: "Recording session stored successfully"
      };
    } catch (error) {
      console.error("[auto-zoom][main] Failed to store recording session", error);
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
  ipcMain.handle("set-current-video-path", async (_, videoPath) => {
    currentVideoPath = videoPath;
    const loadedTelemetry = await loadTelemetryForVideo(videoPath);
    currentRecordingSession = loadedTelemetry ? {
      id: `session-${Date.now()}`,
      startedAtMs: Date.now(),
      screenVideoPath: videoPath,
      micEnabled: false,
      micCaptured: false,
      cameraEnabled: false,
      cameraCaptured: false,
      screenDurationMs: 0,
      inputTelemetryPath: loadedTelemetry.path,
      inputTelemetry: loadedTelemetry.telemetry
    } : null;
    console.info("[auto-zoom][main] set-current-video-path complete", {
      videoPath,
      hasTelemetry: Boolean(loadedTelemetry),
      telemetryPath: loadedTelemetry == null ? void 0 : loadedTelemetry.path,
      generatedSessionId: currentRecordingSession == null ? void 0 : currentRecordingSession.id
    });
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
    console.info("[auto-zoom][main] set-current-recording-session", {
      sessionId: typeof session.id === "string" ? session.id : void 0,
      hasTelemetry: Boolean(session.inputTelemetry),
      telemetryPath: typeof session.inputTelemetryPath === "string" ? session.inputTelemetryPath : void 0
    });
    return { success: true };
  });
  ipcMain.handle("get-current-recording-session", () => {
    console.info("[auto-zoom][main] get-current-recording-session", {
      hasSession: Boolean(currentRecordingSession),
      sessionId: typeof (currentRecordingSession == null ? void 0 : currentRecordingSession.id) === "string" ? currentRecordingSession.id : void 0,
      hasTelemetry: Boolean(currentRecordingSession == null ? void 0 : currentRecordingSession.inputTelemetry)
    });
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
function createHudOverlayWindowWrapper() {
  if (mainWindow) {
    mainWindow.close();
    mainWindow = null;
  }
  closeCameraPreviewWindow();
  if (sourceSelectorWindow && !sourceSelectorWindow.isDestroyed()) {
    sourceSelectorWindow.close();
  }
  sourceSelectorWindow = null;
  mainWindow = createHudOverlayWindow();
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
    createHudOverlayWindowWrapper,
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
