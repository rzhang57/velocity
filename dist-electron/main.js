var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { ipcMain, screen, BrowserWindow, app, desktopCapturer, shell, dialog, nativeImage, session, Tray, Menu } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs$1 from "node:fs/promises";
import fs from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
const __dirname$2 = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname$2, "..");
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
      preload: path.join(__dirname$2, "preload.mjs"),
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
    title: "velocity",
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname$2, "preload.mjs"),
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
      preload: path.join(__dirname$2, "preload.mjs"),
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
      preload: path.join(__dirname$2, "preload.mjs"),
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
      { name: "mousedown", cb: (e) => callbacks.onMouseDown(e) },
      { name: "mouseup", cb: (e) => callbacks.onMouseUp(e) },
      { name: "mousemove", cb: (e) => callbacks.onMouseMove(e) },
      { name: "wheel", cb: (e) => callbacks.onWheel(e) },
      { name: "keydown", cb: (e) => callbacks.onKeyDown(e) }
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
  const dipToScreen = (point) => {
    const maybeFn = screen.dipToScreenPoint;
    return typeof maybeFn === "function" ? maybeFn(point) : point;
  };
  const topLeft = dipToScreen({ x, y });
  const bottomRight = dipToScreen({ x: x + width, y: y + height });
  const physicalWidth = Math.max(1, bottomRight.x - topLeft.x);
  const physicalHeight = Math.max(1, bottomRight.y - topLeft.y);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: physicalWidth,
    height: physicalHeight
  };
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
function resolveCursorType(event, eventType) {
  if (eventType === "mouseDown" || eventType === "mouseUp") {
    return event.button === 2 ? "default" : "pointer";
  }
  if (eventType === "wheel") {
    return Math.abs(Number(event.deltaX ?? 0)) + Math.abs(Number(event.deltaY ?? 0)) > 0 ? "default" : "pointer";
  }
  return "default";
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
          button: Number(event.button ?? 0),
          cursorType: resolveCursorType(event, "mouseDown")
        });
      },
      onMouseUp: (event) => {
        this.pushEvent({
          type: "mouseUp",
          ts: Date.now(),
          x: Number(event.x ?? 0),
          y: Number(event.y ?? 0),
          button: Number(event.button ?? 0),
          cursorType: resolveCursorType(event, "mouseUp")
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
          y,
          cursorType: "default"
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
          deltaY,
          cursorType: resolveCursorType({ deltaX, deltaY }, "wheel")
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
class NativeCaptureService {
  constructor() {
    __publicField(this, "process", null);
    __publicField(this, "buffer", "");
    __publicField(this, "pending", /* @__PURE__ */ new Map());
    __publicField(this, "status", "idle");
    __publicField(this, "statusMessage", "");
    __publicField(this, "currentSessionId", null);
    __publicField(this, "startedAtMs", null);
    __publicField(this, "sequence", 0);
  }
  async start(payload) {
    if (this.status === "recording" || this.status === "starting") {
      return { success: false, message: "Native capture already in progress" };
    }
    const boot = await this.ensureProcess();
    if (!boot.success) {
      return boot;
    }
    this.status = "starting";
    this.statusMessage = "";
    this.currentSessionId = payload.sessionId;
    this.startedAtMs = Date.now();
    try {
      const response = await this.sendRequest({
        id: this.nextId("start"),
        cmd: "start_capture",
        payload
      }, 1e4);
      if (!response.ok) {
        this.status = "error";
        this.statusMessage = response.error || "Failed to start native capture";
        return { success: false, message: this.statusMessage };
      }
      this.status = "recording";
      this.statusMessage = "";
      return { success: true };
    } catch (error) {
      this.status = "error";
      this.statusMessage = error instanceof Error ? error.message : "Failed to start native capture";
      return { success: false, message: this.statusMessage };
    }
  }
  async stop(payload) {
    var _a, _b, _c, _d, _e, _f;
    if (this.status !== "recording" && this.status !== "starting") {
      return { success: false, message: "Native capture is not active" };
    }
    if (!this.process) {
      this.status = "idle";
      return { success: false, message: "Native capture process not available" };
    }
    this.status = "stopping";
    try {
      const response = await this.sendRequest({
        id: this.nextId("stop"),
        cmd: "stop_capture",
        payload
      }, 2e4);
      if (!response.ok) {
        this.status = "error";
        this.statusMessage = response.error || "Failed to stop native capture";
        return { success: false, message: this.statusMessage };
      }
      const outputPath = typeof ((_a = response.payload) == null ? void 0 : _a.outputPath) === "string" ? response.payload.outputPath : "";
      if (!outputPath) {
        this.status = "error";
        this.statusMessage = "Native capture did not return output path";
        return { success: false, message: this.statusMessage };
      }
      const stats = fs.existsSync(outputPath) ? fs.statSync(outputPath) : void 0;
      const result = {
        outputPath,
        durationMs: numberOrUndefined((_b = response.payload) == null ? void 0 : _b.durationMs),
        width: numberOrUndefined((_c = response.payload) == null ? void 0 : _c.width),
        height: numberOrUndefined((_d = response.payload) == null ? void 0 : _d.height),
        fpsActual: numberOrUndefined((_e = response.payload) == null ? void 0 : _e.fpsActual),
        bytes: numberOrUndefined((_f = response.payload) == null ? void 0 : _f.bytes) ?? (stats == null ? void 0 : stats.size)
      };
      this.status = "idle";
      this.statusMessage = "";
      this.currentSessionId = null;
      this.startedAtMs = null;
      return { success: true, result };
    } catch (error) {
      this.status = "error";
      this.statusMessage = error instanceof Error ? error.message : "Failed to stop native capture";
      return { success: false, message: this.statusMessage };
    }
  }
  async getEncoderOptions(ffmpegPath) {
    var _a;
    const ffmpegFallback = this.getEncoderOptionsFromFfmpeg(ffmpegPath);
    const boot = await this.ensureProcess();
    if (!boot.success) {
      return {
        success: ffmpegFallback.success,
        options: ffmpegFallback.options,
        message: boot.message || ffmpegFallback.message
      };
    }
    try {
      const response = await this.sendRequest({
        id: this.nextId("get-encoder-options"),
        cmd: "get_encoder_options",
        payload: {
          platform: process.platform,
          ...ffmpegPath ? { ffmpegPath } : {}
        }
      }, 5e3);
      if (!response.ok) {
        if (ffmpegFallback.options.length > 1) {
          return {
            success: true,
            options: ffmpegFallback.options,
            message: response.error || ffmpegFallback.message || "Sidecar encoder options unavailable, used FFmpeg probe fallback"
          };
        }
        return {
          success: false,
          options: ffmpegFallback.options,
          message: response.error || "Failed to fetch encoder options"
        };
      }
      const rawOptions = Array.isArray((_a = response.payload) == null ? void 0 : _a.options) ? response.payload.options : [];
      const options = rawOptions.filter((item) => Boolean(item) && typeof item === "object" && typeof item.codec === "string" && typeof item.label === "string" && typeof item.hardware === "string").map((item) => ({
        encoder: item.codec,
        label: item.label,
        hardware: item.hardware
      }));
      if (!options.some((option) => option.encoder === "h264_libx264")) {
        options.unshift({ encoder: "h264_libx264", label: "x264 (CPU)", hardware: "cpu" });
      }
      return { success: true, options };
    } catch (error) {
      if (ffmpegFallback.options.length > 1) {
        return {
          success: true,
          options: ffmpegFallback.options,
          message: error instanceof Error ? error.message : ffmpegFallback.message
        };
      }
      return {
        success: false,
        options: ffmpegFallback.options,
        message: error instanceof Error ? error.message : "Failed to fetch encoder options"
      };
    }
  }
  getEncoderOptionsFromFfmpeg(ffmpegPath) {
    const options = [
      { encoder: "h264_libx264", label: "x264 (CPU)", hardware: "cpu" }
    ];
    const probePath = ffmpegPath || (process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    const output = spawnSync(probePath, ["-hide_banner", "-encoders"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4e3
    });
    const text = `${output.stdout || ""}
${output.stderr || ""}`;
    if (output.error || !text.trim()) {
      return {
        success: false,
        options,
        message: output.error instanceof Error ? output.error.message : "Unable to probe FFmpeg encoders"
      };
    }
    if (text.includes("h264_nvenc")) {
      options.push({ encoder: "h264_nvenc", label: "NVIDIA H264 (GPU)", hardware: "nvidia" });
    }
    if (text.includes("h264_amf")) {
      options.push({ encoder: "h264_amf", label: "AMD H264", hardware: "amd" });
    }
    return { success: true, options };
  }
  getStatus(sessionId) {
    return {
      status: this.status,
      message: this.statusMessage || void 0,
      sessionId: sessionId || this.currentSessionId || void 0,
      startedAtMs: this.startedAtMs || void 0
    };
  }
  dispose() {
    for (const [, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Native capture service disposed"));
    }
    this.pending.clear();
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = null;
    this.buffer = "";
    this.status = "idle";
    this.statusMessage = "";
    this.currentSessionId = null;
    this.startedAtMs = null;
  }
  async ensureProcess() {
    if (this.process && !this.process.killed) {
      return { success: true };
    }
    const executable = resolveSidecarExecutablePath();
    if (!executable) {
      return { success: false, message: "Native capture sidecar not found. Build sidecar binaries first." };
    }
    const child = spawn(executable, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.process = child;
    this.buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      this.consumeStdout(chunk);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", () => {
    });
    child.on("exit", (code, signal) => {
      const message = `Native capture sidecar exited (code=${code ?? "null"}, signal=${signal ?? "null"})`;
      for (const [, pending] of this.pending.entries()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(message));
      }
      this.pending.clear();
      this.process = null;
      if (this.status !== "idle") {
        this.status = "error";
        this.statusMessage = message;
      }
    });
    try {
      const init = await this.sendRequest({
        id: this.nextId("init"),
        cmd: "init",
        payload: { platform: process.platform }
      }, 5e3);
      if (!init.ok) {
        this.status = "error";
        this.statusMessage = init.error || "Native capture sidecar init failed";
        return { success: false, message: this.statusMessage };
      }
      return { success: true };
    } catch (error) {
      this.status = "error";
      this.statusMessage = error instanceof Error ? error.message : "Native capture init failed";
      return { success: false, message: this.statusMessage };
    }
  }
  consumeStdout(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (parsed.id) {
        const pending = this.pending.get(parsed.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(parsed.id);
          pending.resolve(parsed);
          continue;
        }
      }
      if (parsed.event === "capture_error") {
        this.status = "error";
        this.statusMessage = parsed.error || "Native capture sidecar reported error";
      }
    }
  }
  async sendRequest(request, timeoutMs) {
    if (!this.process || this.process.killed) {
      throw new Error("Native capture process is not running");
    }
    const serialized = `${JSON.stringify(request)}
`;
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`Native capture request timed out (${request.cmd})`));
      }, timeoutMs);
      this.pending.set(request.id, { resolve, reject, timeout });
    });
    this.process.stdin.write(serialized);
    return await promise;
  }
  nextId(prefix) {
    this.sequence += 1;
    return `${prefix}-${Date.now()}-${this.sequence}`;
  }
}
function resolveSidecarExecutablePath() {
  const fileName = process.platform === "win32" ? "native-capture-sidecar.exe" : "native-capture-sidecar";
  const candidates = app.isPackaged ? [
    path.join(process.resourcesPath, "native-capture", process.platform, fileName),
    path.join(process.resourcesPath, "native-capture", fileName)
  ] : [
    path.join(app.getAppPath(), "native-capture-sidecar", "bin", process.platform, fileName),
    path.join(app.getAppPath(), "native-capture-sidecar", "target", "debug", fileName),
    path.join(app.getAppPath(), "native-capture-sidecar", "target", "release", fileName)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}
function numberOrUndefined(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : void 0;
}
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
let selectedSource = null;
let currentVideoPath = null;
let currentRecordingSession = null;
const inputTrackingService = new InputTrackingService();
const nativeCaptureService = new NativeCaptureService();
const DEFAULT_EXPORTS_DIR = path.join(app.getPath("documents"), "velocity exports");
const hudSettings = {
  micEnabled: true,
  selectedMicDeviceId: "",
  micProcessingMode: "cleaned",
  cameraEnabled: false,
  cameraPreviewEnabled: true,
  selectedCameraDeviceId: "",
  recordingPreset: "quality",
  recordingFps: 60,
  customCursorEnabled: true,
  useLegacyRecorder: false,
  recordingEncoder: "h264_libx264",
  encoderOptions: [
    { encoder: "h264_libx264", label: "x264 (CPU)", hardware: "cpu" }
  ]
};
function resolveCaptureRegionForDisplay(displayId) {
  if (!displayId) return void 0;
  const displays = screen.getAllDisplays();
  const display = displays.find((item) => String(item.id) === displayId);
  if (!display) return void 0;
  const dipToScreenPoint = (point) => {
    const maybe = screen.dipToScreenPoint;
    return typeof maybe === "function" ? maybe(point) : point;
  };
  const topLeft = dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y });
  const bottomRight = dipToScreenPoint({
    x: display.bounds.x + display.bounds.width,
    y: display.bounds.y + display.bounds.height
  });
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: Math.max(1, bottomRight.x - topLeft.x),
    height: Math.max(1, bottomRight.y - topLeft.y)
  };
}
function getSelectedSourceForDisplayMedia() {
  if (!selectedSource || typeof selectedSource !== "object") {
    return null;
  }
  return {
    id: typeof selectedSource.id === "string" ? selectedSource.id : void 0,
    display_id: typeof selectedSource.display_id === "string" ? selectedSource.display_id : void 0
  };
}
let recordingPopoverWindow = null;
let mediaPopoverWindow = null;
const popoverAnchors = {};
function getTelemetryFilePath(videoPath) {
  const parsed = path.parse(videoPath);
  return path.join(parsed.dir, `${parsed.name}.telemetry.json`);
}
async function loadTelemetryForVideo(videoPath) {
  var _a;
  const telemetryPath = getTelemetryFilePath(videoPath);
  try {
    const raw = await fs$1.readFile(telemetryPath, "utf-8");
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
  const getPopoverWindow = (kind) => kind === "recording" ? recordingPopoverWindow : mediaPopoverWindow;
  const setPopoverWindow = (kind, win) => {
    if (kind === "recording") {
      recordingPopoverWindow = win;
      if (!win) {
        delete popoverAnchors.recording;
      }
      return;
    }
    mediaPopoverWindow = win;
    if (!win) {
      delete popoverAnchors.media;
    }
  };
  const closeHudPopoverWindows = () => {
    const windows = [recordingPopoverWindow, mediaPopoverWindow];
    for (const win of windows) {
      if (win && !win.isDestroyed()) {
        win.close();
      }
    }
    recordingPopoverWindow = null;
    mediaPopoverWindow = null;
    delete popoverAnchors.recording;
    delete popoverAnchors.media;
  };
  const computePopoverBounds = (mainBounds, kind, anchorRect, side) => {
    const popoverSize = kind === "recording" ? { width: 420, height: 560 } : { width: 360, height: 290 };
    const margin = 8;
    const absoluteAnchor = {
      x: mainBounds.x + anchorRect.x,
      y: mainBounds.y + anchorRect.y,
      width: anchorRect.width,
      height: anchorRect.height
    };
    const display = screen.getDisplayMatching(mainBounds);
    const workArea = display.workArea;
    const centeredX = absoluteAnchor.x + Math.round((absoluteAnchor.width - popoverSize.width) / 2);
    const maxX = workArea.x + workArea.width - popoverSize.width;
    const x = Math.max(workArea.x, Math.min(centeredX, maxX));
    const preferredY = side === "top" ? absoluteAnchor.y - popoverSize.height - margin : absoluteAnchor.y + absoluteAnchor.height + margin;
    const maxY = workArea.y + workArea.height - popoverSize.height;
    const y = Math.max(workArea.y, Math.min(preferredY, maxY));
    return { x, y, width: popoverSize.width, height: popoverSize.height };
  };
  const broadcastHudSettings = () => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("hud-settings-updated", hudSettings);
      }
    });
  };
  const createHudPopoverWindow = (kind, bounds) => {
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
        preload: path.join(__dirname$1, "preload.mjs"),
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false
      }
    });
    popoverWindow.on("closed", () => {
      setPopoverWindow(kind, null);
    });
    if (VITE_DEV_SERVER_URL) {
      const url = new URL(VITE_DEV_SERVER_URL);
      url.searchParams.set("windowType", "hud-popover");
      url.searchParams.set("kind", kind);
      popoverWindow.loadURL(url.toString());
    } else {
      popoverWindow.loadFile(path.join(RENDERER_DIST, "index.html"), {
        query: { windowType: "hud-popover", kind }
      });
    }
    setPopoverWindow(kind, popoverWindow);
    return popoverWindow;
  };
  const openHudPopoverWindow = (kind, anchorRect, side) => {
    const mainWin = getMainWindow();
    if (!mainWin || mainWin.isDestroyed()) {
      return { success: false, message: "HUD window unavailable" };
    }
    popoverAnchors[kind] = { anchorRect, side };
    const bounds = computePopoverBounds(mainWin.getBounds(), kind, anchorRect, side);
    const existing = getPopoverWindow(kind);
    if (existing && !existing.isDestroyed()) {
      existing.setBounds(bounds, false);
      const showReady = () => {
        if (existing.isDestroyed()) return;
        if (!existing.isVisible()) {
          existing.show();
        }
        existing.webContents.send("hud-settings-updated", hudSettings);
      };
      if (existing.webContents.isLoadingMainFrame()) {
        existing.webContents.once("did-finish-load", showReady);
      } else {
        showReady();
      }
      return { success: true };
    }
    const popoverWindow = createHudPopoverWindow(kind, bounds);
    popoverWindow.webContents.once("did-finish-load", () => {
      if (!popoverWindow.isDestroyed()) {
        popoverWindow.webContents.send("hud-settings-updated", hudSettings);
        popoverWindow.show();
      }
    });
    return { success: true };
  };
  const ensureDirectoryExists = async (directoryPath) => {
    await fs$1.mkdir(directoryPath, { recursive: true });
  };
  const resolvePackagedFfmpegPath = () => app.isPackaged ? path.join(process.resourcesPath, "native-capture", process.platform, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg") : path.join(app.getAppPath(), "native-capture-sidecar", "bin", process.platform, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const muxAudioIntoVideo = async (videoPath, audioPath, audioOffsetMs = 0) => {
    const ffmpegPath = resolvePackagedFfmpegPath();
    if (!fs.existsSync(ffmpegPath)) {
      return { success: false, message: "ffmpeg executable not found for native audio muxing" };
    }
    const parsed = path.parse(videoPath);
    const tempOutputPath = path.join(parsed.dir, `${parsed.name}.with-audio${parsed.ext || ".mp4"}`);
    const ffmpegArgs = [
      "-y",
      "-i",
      videoPath
    ];
    const normalizedOffsetSeconds = Math.abs(audioOffsetMs) / 1e3;
    if (audioOffsetMs > 0 && normalizedOffsetSeconds > 1e-3) {
      ffmpegArgs.push("-itsoffset", normalizedOffsetSeconds.toFixed(3));
    } else if (audioOffsetMs < 0 && normalizedOffsetSeconds > 1e-3) {
      ffmpegArgs.push("-ss", normalizedOffsetSeconds.toFixed(3));
    }
    ffmpegArgs.push(
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      tempOutputPath
    );
    const muxResult = await new Promise((resolve) => {
      const child = spawn(ffmpegPath, ffmpegArgs, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        if (stderr.length < 4e3) {
          stderr += String(chunk);
        }
      });
      child.on("error", (error) => {
        resolve({ success: false, message: `ffmpeg failed to start: ${String(error)}` });
      });
      child.on("close", (code) => {
        if (code === 0) {
          resolve({ success: true });
          return;
        }
        resolve({
          success: false,
          message: `ffmpeg mux failed with exit code ${String(code)}${stderr ? `: ${stderr.trim()}` : ""}`
        });
      });
    });
    if (!muxResult.success) {
      await deleteFileIfExists(tempOutputPath);
      return { success: false, message: muxResult.message };
    }
    try {
      await fs$1.unlink(videoPath);
    } catch {
    }
    await fs$1.rename(tempOutputPath, videoPath);
    return { success: true, outputPath: videoPath };
  };
  const getUniqueFilePath = async (directoryPath, fileName) => {
    const parsed = path.parse(fileName);
    let candidate = path.join(directoryPath, fileName);
    let suffix = 1;
    for (; ; ) {
      try {
        await fs$1.access(candidate);
        candidate = path.join(directoryPath, `${parsed.name} (${suffix})${parsed.ext}`);
        suffix += 1;
      } catch {
        return candidate;
      }
    }
  };
  const deleteFileIfExists = async (filePath) => {
    if (!filePath) return;
    try {
      await fs$1.unlink(filePath);
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
    closeHudPopoverWindows();
    const mainWin = getMainWindow();
    if (mainWin) {
      mainWin.close();
    }
    createEditorWindow2();
  });
  ipcMain.handle("store-recorded-video", async (_, videoData, fileName) => {
    try {
      const videoPath = path.join(RECORDINGS_DIR, fileName);
      await fs$1.writeFile(videoPath, Buffer.from(videoData));
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
    closeHudPopoverWindows();
    createHudOverlayWindow2();
    return { success: true };
  });
  ipcMain.handle("get-hud-settings", () => {
    return { success: true, settings: hudSettings };
  });
  ipcMain.handle("preload-hud-popover-windows", () => {
    const mainWin = getMainWindow();
    if (!mainWin || mainWin.isDestroyed()) {
      return { success: false, message: "HUD window unavailable" };
    }
    const mainBounds = mainWin.getBounds();
    const baseAnchor = { x: Math.max(16, Math.floor(mainBounds.width / 2) - 10), y: Math.max(16, Math.floor(mainBounds.height / 2) - 10), width: 20, height: 20 };
    ["recording", "media"].forEach((kind) => {
      const existing = getPopoverWindow(kind);
      if (existing && !existing.isDestroyed()) {
        return;
      }
      const bounds = computePopoverBounds(mainBounds, kind, baseAnchor, "top");
      createHudPopoverWindow(kind, bounds);
    });
    return { success: true };
  });
  ipcMain.handle("update-hud-settings", (_, partial) => {
    if (typeof partial.micEnabled === "boolean") hudSettings.micEnabled = partial.micEnabled;
    if (typeof partial.selectedMicDeviceId === "string") hudSettings.selectedMicDeviceId = partial.selectedMicDeviceId;
    if (partial.micProcessingMode === "raw" || partial.micProcessingMode === "cleaned") hudSettings.micProcessingMode = partial.micProcessingMode;
    if (typeof partial.cameraEnabled === "boolean") hudSettings.cameraEnabled = partial.cameraEnabled;
    if (typeof partial.cameraPreviewEnabled === "boolean") hudSettings.cameraPreviewEnabled = partial.cameraPreviewEnabled;
    if (typeof partial.selectedCameraDeviceId === "string") hudSettings.selectedCameraDeviceId = partial.selectedCameraDeviceId;
    if (partial.recordingPreset === "performance" || partial.recordingPreset === "balanced" || partial.recordingPreset === "quality") {
      hudSettings.recordingPreset = partial.recordingPreset;
    }
    if (partial.recordingFps === 60 || partial.recordingFps === 120) hudSettings.recordingFps = partial.recordingFps;
    if (typeof partial.customCursorEnabled === "boolean") {
      hudSettings.customCursorEnabled = partial.customCursorEnabled;
      if (partial.customCursorEnabled) {
        hudSettings.useLegacyRecorder = false;
      }
    }
    if (typeof partial.useLegacyRecorder === "boolean") {
      hudSettings.useLegacyRecorder = partial.useLegacyRecorder;
      if (partial.useLegacyRecorder) {
        hudSettings.customCursorEnabled = false;
      }
    }
    if (partial.recordingEncoder === "h264_libx264" || partial.recordingEncoder === "h264_nvenc" || partial.recordingEncoder === "hevc_nvenc" || partial.recordingEncoder === "h264_amf") {
      hudSettings.recordingEncoder = partial.recordingEncoder;
    }
    broadcastHudSettings();
    return { success: true, settings: hudSettings };
  });
  ipcMain.handle("set-hud-encoder-options", (_, options) => {
    var _a;
    if (!Array.isArray(options)) {
      return { success: false, message: "Invalid encoder options payload" };
    }
    const normalized = options.filter((option) => Boolean(option) && typeof option === "object" && (option.encoder === "h264_libx264" || option.encoder === "h264_nvenc" || option.encoder === "hevc_nvenc" || option.encoder === "h264_amf") && typeof option.label === "string" && (option.hardware === "cpu" || option.hardware === "nvidia" || option.hardware === "amd"));
    if (!normalized.some((option) => option.encoder === "h264_libx264")) {
      normalized.unshift({ encoder: "h264_libx264", label: "x264 (CPU)", hardware: "cpu" });
    }
    hudSettings.encoderOptions = normalized;
    if (!hudSettings.encoderOptions.some((option) => option.encoder === hudSettings.recordingEncoder)) {
      hudSettings.recordingEncoder = ((_a = hudSettings.encoderOptions[0]) == null ? void 0 : _a.encoder) ?? "h264_libx264";
    }
    broadcastHudSettings();
    return { success: true, settings: hudSettings };
  });
  ipcMain.handle("native-capture-encoder-options", async () => {
    const packagedFfmpeg = resolvePackagedFfmpegPath();
    const ffmpegPath = fs.existsSync(packagedFfmpeg) ? packagedFfmpeg : void 0;
    const result = await nativeCaptureService.getEncoderOptions(ffmpegPath);
    return result;
  });
  ipcMain.handle("native-capture-start", async (_, payload) => {
    var _a, _b;
    const packagedFfmpeg = resolvePackagedFfmpegPath();
    const sourceDisplayId = ((_a = payload.source) == null ? void 0 : _a.displayId) || (typeof (selectedSource == null ? void 0 : selectedSource.display_id) === "string" ? selectedSource.display_id : void 0);
    const captureRegion = ((_b = payload.source) == null ? void 0 : _b.type) === "screen" ? resolveCaptureRegionForDisplay(sourceDisplayId) : void 0;
    const normalizedPayload = {
      ...payload,
      outputPath: path.isAbsolute(payload.outputPath) ? payload.outputPath : path.join(RECORDINGS_DIR, payload.outputPath),
      ffmpegPath: payload.ffmpegPath || (fs.existsSync(packagedFfmpeg) ? packagedFfmpeg : void 0),
      captureRegion: payload.captureRegion || captureRegion
    };
    return await nativeCaptureService.start(normalizedPayload);
  });
  ipcMain.handle("native-capture-stop", async (_, payload) => {
    return await nativeCaptureService.stop(payload);
  });
  ipcMain.handle("native-capture-status", (_, sessionId) => {
    return { success: true, ...nativeCaptureService.getStatus(sessionId) };
  });
  ipcMain.handle("open-hud-popover-window", (_, payload) => {
    if (payload.kind !== "recording" && payload.kind !== "media") {
      return { success: false, message: "Invalid popover kind" };
    }
    return openHudPopoverWindow(payload.kind, payload.anchorRect, payload.side);
  });
  ipcMain.handle("toggle-hud-popover-window", (_, payload) => {
    if (payload.kind !== "recording" && payload.kind !== "media") {
      return { success: false, message: "Invalid popover kind" };
    }
    const existing = getPopoverWindow(payload.kind);
    if (existing && !existing.isDestroyed() && existing.isVisible()) {
      existing.hide();
      return { success: true, opened: false };
    }
    const result = openHudPopoverWindow(payload.kind, payload.anchorRect, payload.side);
    return { ...result, opened: true };
  });
  ipcMain.handle("close-hud-popover-window", (_, kind) => {
    if (!kind) {
      [recordingPopoverWindow, mediaPopoverWindow].forEach((win2) => {
        if (win2 && !win2.isDestroyed()) {
          win2.hide();
        }
      });
      return { success: true };
    }
    const win = getPopoverWindow(kind);
    if (win && !win.isDestroyed()) {
      win.hide();
    }
    return { success: true };
  });
  ipcMain.handle("close-current-hud-popover-window", (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow || senderWindow.isDestroyed()) {
      return { success: false };
    }
    if (senderWindow === recordingPopoverWindow) {
      senderWindow.hide();
      return { success: true };
    }
    if (senderWindow === mediaPopoverWindow) {
      senderWindow.hide();
      return { success: true };
    }
    senderWindow.hide();
    return { success: true };
  });
  ipcMain.handle("set-hud-overlay-width", (_, width) => {
    const mainWin = getMainWindow();
    if (!mainWin || mainWin.isDestroyed()) {
      return { success: false };
    }
    const clampedWidth = Math.max(500, Math.min(1400, Math.round(width)));
    const bounds = mainWin.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const workArea = display.workArea;
    const centerX = bounds.x + bounds.width / 2;
    const maxX = workArea.x + workArea.width - clampedWidth;
    const idealX = Math.round(centerX - clampedWidth / 2);
    const x = Math.max(workArea.x, Math.min(idealX, maxX));
    const maxY = workArea.y + workArea.height - bounds.height;
    const y = Math.max(workArea.y, Math.min(bounds.y, maxY));
    mainWin.setBounds({
      x,
      y,
      width: clampedWidth,
      height: bounds.height
    }, false);
    return { success: true };
  });
  ipcMain.handle("get-hud-overlay-popover-side", () => {
    const mainWin = getMainWindow();
    if (!mainWin || mainWin.isDestroyed()) {
      return { success: false };
    }
    const bounds = mainWin.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const workArea = display.workArea;
    const hudCenterY = bounds.y + bounds.height / 2;
    const screenCenterY = workArea.y + workArea.height / 2;
    const side = hudCenterY >= screenCenterY ? "top" : "bottom";
    return { success: true, side };
  });
  ipcMain.handle("set-hud-overlay-height", (_, height, anchor = "bottom") => {
    const mainWin = getMainWindow();
    if (!mainWin || mainWin.isDestroyed()) {
      return { success: false };
    }
    const clampedHeight = Math.max(100, Math.min(720, Math.round(height)));
    const bounds = mainWin.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const workArea = display.workArea;
    const maxX = workArea.x + workArea.width - bounds.width;
    const maxY = workArea.y + workArea.height - clampedHeight;
    const x = Math.max(workArea.x, Math.min(bounds.x, maxX));
    const idealY = anchor === "top" ? bounds.y : bounds.y + bounds.height - clampedHeight;
    const y = Math.max(workArea.y, Math.min(idealY, maxY));
    mainWin.setBounds({
      x,
      y,
      width: bounds.width,
      height: clampedHeight
    }, false);
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
      await fs$1.writeFile(screenVideoPath, Buffer.from(payload.screenVideoData));
      let cameraVideoPath;
      if (payload.cameraVideoData && payload.cameraFileName) {
        cameraVideoPath = path.join(RECORDINGS_DIR, payload.cameraFileName);
        await fs$1.writeFile(cameraVideoPath, Buffer.from(payload.cameraVideoData));
      }
      let inputTelemetryPath;
      let inputTelemetry;
      if (payload.inputTelemetry) {
        const telemetryFileName = payload.inputTelemetryFileName || `${path.parse(payload.screenFileName).name}.telemetry.json`;
        inputTelemetryPath = path.join(RECORDINGS_DIR, telemetryFileName);
        await fs$1.writeFile(inputTelemetryPath, JSON.stringify(payload.inputTelemetry), "utf-8");
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
      const session2 = {
        ...payload.session,
        screenVideoPath,
        ...cameraVideoPath ? { cameraVideoPath } : {},
        ...inputTelemetryPath ? { inputTelemetryPath } : {},
        ...inputTelemetry ? { inputTelemetry } : {}
      };
      currentRecordingSession = session2;
      currentVideoPath = screenVideoPath;
      console.info("[auto-zoom][main] Recording session stored in memory", {
        sessionId: typeof payload.session.id === "string" ? payload.session.id : void 0,
        screenVideoPath,
        inputTelemetryPath
      });
      return {
        success: true,
        session: session2,
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
  ipcMain.handle("store-native-recording-session", async (_, payload) => {
    try {
      let finalScreenVideoPath = payload.screenVideoPath;
      if (!payload.screenVideoPath.startsWith(RECORDINGS_DIR)) {
        const targetName = `${path.parse(payload.screenVideoPath).name}.mp4`;
        finalScreenVideoPath = await getUniqueFilePath(RECORDINGS_DIR, targetName);
        await fs$1.copyFile(payload.screenVideoPath, finalScreenVideoPath);
      }
      let micCaptured = typeof payload.session.micCaptured === "boolean" ? Boolean(payload.session.micCaptured) : false;
      const micStartOffsetMs = typeof payload.session.micStartOffsetMs === "number" ? Number(payload.session.micStartOffsetMs) : 0;
      let micAudioPath;
      if (payload.micAudioData && payload.micAudioFileName) {
        micAudioPath = path.join(RECORDINGS_DIR, payload.micAudioFileName);
        await fs$1.writeFile(micAudioPath, Buffer.from(payload.micAudioData));
        const muxResult = await muxAudioIntoVideo(finalScreenVideoPath, micAudioPath, micStartOffsetMs);
        if (muxResult.success) {
          micCaptured = true;
        } else {
          console.warn("[native-capture][main] Failed to mux microphone audio into native capture", {
            screenVideoPath: finalScreenVideoPath,
            micAudioPath,
            message: muxResult.message
          });
        }
      }
      let cameraVideoPath;
      if (payload.cameraVideoData && payload.cameraFileName) {
        cameraVideoPath = path.join(RECORDINGS_DIR, payload.cameraFileName);
        await fs$1.writeFile(cameraVideoPath, Buffer.from(payload.cameraVideoData));
      }
      let inputTelemetryPath;
      let inputTelemetry;
      if (payload.inputTelemetry) {
        const telemetryFileName = payload.inputTelemetryFileName || `${path.parse(finalScreenVideoPath).name}.telemetry.json`;
        inputTelemetryPath = path.join(RECORDINGS_DIR, telemetryFileName);
        await fs$1.writeFile(inputTelemetryPath, JSON.stringify(payload.inputTelemetry), "utf-8");
        inputTelemetry = payload.inputTelemetry;
      }
      const normalizedSession = {
        ...payload.session,
        micCaptured
      };
      const session2 = {
        ...normalizedSession,
        screenVideoPath: finalScreenVideoPath,
        ...cameraVideoPath ? { cameraVideoPath } : {},
        ...inputTelemetryPath ? { inputTelemetryPath } : {},
        ...inputTelemetry ? { inputTelemetry } : {}
      };
      currentRecordingSession = session2;
      currentVideoPath = finalScreenVideoPath;
      await deleteFileIfExists(micAudioPath);
      return {
        success: true,
        session: session2,
        message: "Native recording session stored successfully"
      };
    } catch (error) {
      console.error("[native-capture][main] Failed to store native recording session", error);
      return {
        success: false,
        message: "Failed to store native recording session",
        error: String(error)
      };
    }
  });
  ipcMain.handle("get-recorded-video-path", async () => {
    try {
      const files = await fs$1.readdir(RECORDINGS_DIR);
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
    if (recording) {
      closeHudPopoverWindows();
    }
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
      await fs$1.writeFile(result.filePath, Buffer.from(videoData));
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
  ipcMain.handle("get-default-export-directory", async () => {
    try {
      await ensureDirectoryExists(DEFAULT_EXPORTS_DIR);
      return { success: true, path: DEFAULT_EXPORTS_DIR };
    } catch (error) {
      console.error("Failed to resolve default export directory:", error);
      return { success: false, message: "Failed to resolve default export directory", error: String(error) };
    }
  });
  ipcMain.handle("choose-export-directory", async (_, currentPath) => {
    try {
      const result = await dialog.showOpenDialog({
        title: "Choose Export Folder",
        defaultPath: currentPath || DEFAULT_EXPORTS_DIR,
        properties: ["openDirectory", "createDirectory"]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true, message: "Folder selection cancelled" };
      }
      const selectedPath = result.filePaths[0];
      await ensureDirectoryExists(selectedPath);
      return { success: true, path: selectedPath };
    } catch (error) {
      console.error("Failed to choose export directory:", error);
      return { success: false, message: "Failed to choose export directory", error: String(error) };
    }
  });
  ipcMain.handle("save-exported-video-to-directory", async (_, videoData, fileName, directoryPath) => {
    try {
      await ensureDirectoryExists(directoryPath);
      const targetPath = await getUniqueFilePath(directoryPath, fileName);
      await fs$1.writeFile(targetPath, Buffer.from(videoData));
      return {
        success: true,
        path: targetPath,
        message: "Video exported successfully"
      };
    } catch (error) {
      console.error("Failed to save exported video to directory:", error);
      return {
        success: false,
        message: "Failed to save exported video",
        error: String(error)
      };
    }
  });
  ipcMain.handle("open-directory", async (_, directoryPath) => {
    try {
      await ensureDirectoryExists(directoryPath);
      const errorMessage = await shell.openPath(directoryPath);
      if (errorMessage) {
        return { success: false, message: errorMessage };
      }
      return { success: true };
    } catch (error) {
      console.error("Failed to open directory:", error);
      return { success: false, message: "Failed to open directory", error: String(error) };
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
  ipcMain.handle("set-current-recording-session", (_, session2) => {
    currentRecordingSession = session2;
    currentVideoPath = typeof session2.screenVideoPath === "string" ? session2.screenVideoPath : null;
    console.info("[auto-zoom][main] set-current-recording-session", {
      sessionId: typeof session2.id === "string" ? session2.id : void 0,
      hasTelemetry: Boolean(session2.inputTelemetry),
      telemetryPath: typeof session2.inputTelemetryPath === "string" ? session2.inputTelemetryPath : void 0
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
const SESSION_DATA_DIR = path.join(app.getPath("temp"), "openscreen-session-data");
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disk-cache-dir", path.join(SESSION_DATA_DIR, "Cache"));
app.setPath("sessionData", SESSION_DATA_DIR);
async function ensureRecordingsDir() {
  try {
    await fs$1.mkdir(RECORDINGS_DIR, { recursive: true });
    console.log("RECORDINGS_DIR:", RECORDINGS_DIR);
    console.log("User Data Path:", app.getPath("userData"));
  } catch (error) {
    console.error("Failed to create recordings directory:", error);
  }
}
async function ensureSessionDataDir() {
  try {
    await fs$1.mkdir(SESSION_DATA_DIR, { recursive: true });
  } catch (error) {
    console.error("Failed to create session data directory:", error);
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
  const trayToolTip = recording ? `Recording: ${selectedSourceName}` : "velocity";
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
  await ensureSessionDataDir();
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const selected = getSelectedSourceForDisplayMedia();
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: false
      });
      let target = (selected == null ? void 0 : selected.id) ? sources.find((source) => source.id === selected.id) : void 0;
      if (!target && (selected == null ? void 0 : selected.display_id)) {
        target = sources.find((source) => source.display_id === selected.display_id && source.id.startsWith("screen:"));
      }
      if (!target) {
        target = sources.find((source) => source.id.startsWith("screen:")) || sources[0];
      }
      if (!target) {
        callback({});
        return;
      }
      callback({
        video: target
      });
    } catch (error) {
      console.error("Display media handler failed:", error);
      callback({});
    }
  }, { useSystemPicker: false });
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
