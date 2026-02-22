var Fe = Object.defineProperty;
var _e = (i, t, o) => t in i ? Fe(i, t, { enumerable: !0, configurable: !0, writable: !0, value: o }) : i[t] = o;
var T = (i, t, o) => _e(i, typeof t != "symbol" ? t + "" : t, o);
import { ipcMain as f, screen as V, BrowserWindow as U, app as I, desktopCapturer as xe, shell as pe, dialog as ie, nativeImage as Ce, session as Ae, Tray as Re, Menu as Ne } from "electron";
import { fileURLToPath as de } from "node:url";
import m from "node:path";
import F from "node:fs/promises";
import K from "node:fs";
import { spawnSync as Ve, spawn as Pe } from "node:child_process";
import { createRequire as je } from "node:module";
const ee = m.dirname(de(import.meta.url)), We = m.join(ee, ".."), $ = process.env.VITE_DEV_SERVER_URL, re = m.join(We, "dist");
let G = null, k = null;
f.on("hud-overlay-hide", () => {
  G && !G.isDestroyed() && G.minimize(), k && !k.isDestroyed() && k.minimize();
});
function De() {
  const i = V.getPrimaryDisplay(), { workArea: t } = i, o = 500, c = 120, d = Math.floor(t.x + (t.width - o) / 2), a = Math.floor(t.y + t.height - c - 5), h = new U({
    width: o,
    height: c,
    minWidth: 500,
    maxWidth: 1400,
    minHeight: 100,
    maxHeight: 720,
    x: d,
    y: a,
    frame: !1,
    thickFrame: !1,
    transparent: !0,
    backgroundColor: "#00000000",
    show: !1,
    resizable: !1,
    alwaysOnTop: !0,
    skipTaskbar: !0,
    hasShadow: !1,
    webPreferences: {
      preload: m.join(ee, "preload.mjs"),
      nodeIntegration: !1,
      contextIsolation: !0,
      backgroundThrottling: !1
    }
  });
  return h.setContentProtection(!0), h.webContents.on("did-finish-load", () => {
    h == null || h.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), G = h, h.on("closed", () => {
    G === h && (G = null);
  }), h.on("minimize", () => {
    k && !k.isDestroyed() && k.minimize();
  }), $ ? h.loadURL($ + "?windowType=hud-overlay") : h.loadFile(m.join(re, "index.html"), {
    query: { windowType: "hud-overlay" }
  }), h.once("ready-to-show", () => {
    h.isDestroyed() || h.showInactive();
  }), h;
}
function Oe() {
  const i = process.platform === "darwin", t = new U({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    ...i && {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 12, y: 12 }
    },
    transparent: !1,
    resizable: !0,
    alwaysOnTop: !1,
    skipTaskbar: !1,
    title: "velocity",
    backgroundColor: "#000000",
    show: !1,
    webPreferences: {
      preload: m.join(ee, "preload.mjs"),
      nodeIntegration: !1,
      contextIsolation: !0,
      webSecurity: !1,
      backgroundThrottling: !1
    }
  });
  return t.maximize(), t.webContents.on("did-finish-load", () => {
    t == null || t.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), $ ? t.loadURL($ + "?windowType=editor") : t.loadFile(m.join(re, "index.html"), {
    query: { windowType: "editor" }
  }), t.once("ready-to-show", () => {
    t.isDestroyed() || t.show();
  }), t;
}
function ze() {
  const { width: i, height: t } = V.getPrimaryDisplay().workAreaSize, o = new U({
    width: 620,
    height: 420,
    minHeight: 350,
    maxHeight: 500,
    x: Math.round((i - 620) / 2),
    y: Math.round((t - 420) / 2),
    frame: !1,
    thickFrame: !1,
    resizable: !1,
    alwaysOnTop: !0,
    transparent: !0,
    backgroundColor: "#00000000",
    show: !1,
    webPreferences: {
      preload: m.join(ee, "preload.mjs"),
      nodeIntegration: !1,
      contextIsolation: !0
    }
  });
  return o.setContentProtection(!0), $ ? o.loadURL($ + "?windowType=source-selector") : o.loadFile(m.join(re, "index.html"), {
    query: { windowType: "source-selector" }
  }), o.once("ready-to-show", () => {
    o.isDestroyed() || o.show();
  }), o;
}
function Be(i) {
  if (k && !k.isDestroyed())
    return k.focus(), k;
  const t = V.getPrimaryDisplay(), { workArea: o } = t, c = 320, d = 200, a = Math.floor(o.x + o.width - c - 24), h = Math.floor(o.y + o.height - d - 140), w = new U({
    width: c,
    height: d,
    minWidth: 220,
    minHeight: 140,
    x: a,
    y: h,
    frame: !1,
    thickFrame: !1,
    transparent: !0,
    resizable: !0,
    alwaysOnTop: !0,
    skipTaskbar: !0,
    hasShadow: !1,
    backgroundColor: "#00000000",
    show: !1,
    webPreferences: {
      preload: m.join(ee, "preload.mjs"),
      nodeIntegration: !1,
      contextIsolation: !0,
      backgroundThrottling: !1
    }
  });
  w.setContentProtection(!0), w.setVisibleOnAllWorkspaces(!0, { visibleOnFullScreen: !0 }), w.setAspectRatio(16 / 9);
  const l = { windowType: "camera-preview", ...i ? { deviceId: i } : {} };
  if ($) {
    const y = new URL($);
    y.searchParams.set("windowType", "camera-preview"), i && y.searchParams.set("deviceId", i), w.loadURL(y.toString());
  } else
    w.loadFile(m.join(re, "index.html"), { query: l });
  return k = w, w.once("ready-to-show", () => {
    w.isDestroyed() || w.showInactive();
  }), w.on("closed", () => {
    k === w && (k = null);
  }), w;
}
function le() {
  k && !k.isDestroyed() && k.close(), k = null;
}
function Le() {
  return k && !k.isDestroyed() ? k : null;
}
class Ue {
  constructor() {
    T(this, "hook", null);
    T(this, "handlers", []);
  }
  start(t) {
    const o = je(import.meta.url);
    let c;
    try {
      c = o("uiohook-napi");
    } catch {
      return { success: !1, message: "uiohook-napi is not installed" };
    }
    const d = (c == null ? void 0 : c.uIOhook) ?? (c == null ? void 0 : c.default) ?? c;
    if (!d || typeof d.on != "function" || typeof d.start != "function" || typeof d.stop != "function")
      return { success: !1, message: "uiohook-napi loaded, but API shape is unsupported" };
    this.hook = d, this.handlers = [
      { name: "mousedown", cb: (a) => t.onMouseDown(a) },
      { name: "mouseup", cb: (a) => t.onMouseUp(a) },
      { name: "mousemove", cb: (a) => t.onMouseMove(a) },
      { name: "wheel", cb: (a) => t.onWheel(a) },
      { name: "keydown", cb: (a) => t.onKeyDown(a) }
    ];
    try {
      for (const a of this.handlers)
        this.hook.on(a.name, a.cb);
      return this.hook.start(), { success: !0 };
    } catch (a) {
      return this.stop(), { success: !1, message: `Failed to start native hook: ${String(a)}` };
    }
  }
  stop() {
    var t, o;
    if (this.hook)
      try {
        for (const c of this.handlers)
          typeof ((t = this.hook) == null ? void 0 : t.off) == "function" ? this.hook.off(c.name, c.cb) : typeof ((o = this.hook) == null ? void 0 : o.removeListener) == "function" && this.hook.removeListener(c.name, c.cb);
        this.hook.stop(), typeof this.hook.removeAllListeners == "function" && this.hook.removeAllListeners();
      } catch {
      } finally {
        this.handlers = [], this.hook = null;
      }
  }
}
function te() {
  return {
    totalEvents: 0,
    mouseDownCount: 0,
    mouseUpCount: 0,
    mouseMoveCount: 0,
    wheelCount: 0,
    keyDownCount: 0
  };
}
function $e(i, t) {
  switch (i.totalEvents += 1, t.type) {
    case "mouseDown":
      i.mouseDownCount += 1;
      break;
    case "mouseUp":
      i.mouseUpCount += 1;
      break;
    case "mouseMoveSampled":
      i.mouseMoveCount += 1;
      break;
    case "wheel":
      i.wheelCount += 1;
      break;
    case "keyDownCategory":
      i.keyDownCount += 1;
      break;
  }
}
function He(i) {
  return i ? i.startsWith("screen:") ? "screen" : i.startsWith("window:") ? "window" : "unknown" : "unknown";
}
function qe(i, t) {
  if (i !== "screen")
    return;
  const d = V.getAllDisplays().find((j) => String(j.id) === t) ?? V.getPrimaryDisplay(), { x: a, y: h, width: w, height: l } = d.bounds, y = (j) => {
    const O = V.dipToScreenPoint;
    return typeof O == "function" ? O(j) : j;
  }, P = y({ x: a, y: h }), A = y({ x: a + w, y: h + l }), z = Math.max(1, A.x - P.x), W = Math.max(1, A.y - P.y);
  return {
    x: P.x,
    y: P.y,
    width: z,
    height: W
  };
}
function Xe(i) {
  if (i.ctrlKey || i.altKey || i.metaKey) return "shortcut";
  const t = i.keycode ?? i.rawcode ?? -1;
  return t === 14 || t === 8 ? "backspace" : t === 15 || t === 9 ? "tab" : t === 28 || t === 13 ? "enter" : [29, 42, 54, 56, 3613, 3675].includes(t) ? "modifier" : t >= 2 && t <= 13 || t >= 16 && t <= 27 || t >= 30 && t <= 53 ? "printable" : "other";
}
function ae(i, t) {
  return t === "mouseDown" || t === "mouseUp" ? i.button === 2 ? "default" : "pointer" : t === "wheel" ? Math.abs(Number(i.deltaX ?? 0)) + Math.abs(Number(i.deltaY ?? 0)) > 0 ? "default" : "pointer" : "default";
}
class Ye {
  constructor() {
    T(this, "provider", new Ue());
    T(this, "events", []);
    T(this, "stats", te());
    T(this, "currentSession", null);
    T(this, "lastMoveTs", 0);
    T(this, "lastMoveX", -1);
    T(this, "lastMoveY", -1);
    T(this, "cursorPollInterval", null);
    T(this, "lastCursorPollEmitTs", 0);
  }
  start(t, o) {
    this.stop();
    const c = t.sourceId ?? (o == null ? void 0 : o.id), d = t.sourceDisplayId ?? (o == null ? void 0 : o.display_id), a = He(c), h = qe(a, d);
    this.currentSession = {
      sessionId: t.sessionId,
      startedAtMs: t.startedAtMs,
      sourceKind: a,
      sourceId: c,
      sourceDisplayId: d,
      sourceBounds: h
    }, this.events = [], this.stats = te(), this.lastMoveTs = 0, this.lastMoveX = -1, this.lastMoveY = -1, this.lastCursorPollEmitTs = 0;
    const w = this.provider.start({
      onMouseDown: (l) => {
        this.pushEvent({
          type: "mouseDown",
          ts: Date.now(),
          x: Number(l.x ?? 0),
          y: Number(l.y ?? 0),
          button: Number(l.button ?? 0),
          cursorType: ae(l, "mouseDown")
        });
      },
      onMouseUp: (l) => {
        this.pushEvent({
          type: "mouseUp",
          ts: Date.now(),
          x: Number(l.x ?? 0),
          y: Number(l.y ?? 0),
          button: Number(l.button ?? 0),
          cursorType: ae(l, "mouseUp")
        });
      },
      onMouseMove: (l) => {
        const y = Date.now(), P = Number(l.x ?? 0), A = Number(l.y ?? 0), z = 33, W = 4, j = P - this.lastMoveX, O = A - this.lastMoveY, q = j * j + O * O;
        y - this.lastMoveTs < z && q < W * W || (this.lastMoveTs = y, this.lastMoveX = P, this.lastMoveY = A, this.pushEvent({
          type: "mouseMoveSampled",
          ts: y,
          x: P,
          y: A,
          cursorType: "default"
        }));
      },
      onWheel: (l) => {
        const y = Number(l.deltaY ?? l.amount ?? l.rotation ?? 0), P = Number(l.deltaX ?? 0);
        this.pushEvent({
          type: "wheel",
          ts: Date.now(),
          x: Number(l.x ?? 0),
          y: Number(l.y ?? 0),
          deltaX: P,
          deltaY: y,
          cursorType: ae({ deltaX: P, deltaY: y }, "wheel")
        });
      },
      onKeyDown: (l) => {
        this.pushEvent({
          type: "keyDownCategory",
          ts: Date.now(),
          category: Xe(l)
        });
      }
    });
    return w.success ? (this.startCursorPolling(), w) : (this.currentSession = null, this.events = [], this.stats = te(), w);
  }
  stop() {
    if (this.stopCursorPolling(), this.provider.stop(), !this.currentSession)
      return null;
    const t = {
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
    return this.currentSession = null, this.events = [], this.stats = te(), this.lastMoveTs = 0, this.lastMoveX = -1, this.lastMoveY = -1, this.lastCursorPollEmitTs = 0, t;
  }
  pushEvent(t) {
    this.events.push(t), $e(this.stats, t);
  }
  startCursorPolling() {
    this.stopCursorPolling();
    const t = 33, o = 1, c = 200;
    this.cursorPollInterval = setInterval(() => {
      if (!this.currentSession) return;
      const a = Date.now(), h = V.getCursorScreenPoint(), w = V.dipToScreenPoint, l = typeof w == "function" ? w(h) : h, y = Number(l.x ?? 0), P = Number(l.y ?? 0), A = y - this.lastMoveX, z = P - this.lastMoveY, W = A * A + z * z, j = a - this.lastMoveTs, O = a - this.lastCursorPollEmitTs;
      W < o * o && O < c || j < t && W < o * o || (this.lastMoveTs = a, this.lastMoveX = y, this.lastMoveY = P, this.lastCursorPollEmitTs = a, this.pushEvent({
        type: "mouseMoveSampled",
        ts: a,
        x: y,
        y: P,
        cursorType: "default"
      }));
    }, 16);
  }
  stopCursorPolling() {
    this.cursorPollInterval && (clearInterval(this.cursorPollInterval), this.cursorPollInterval = null);
  }
}
class Ke {
  constructor() {
    T(this, "process", null);
    T(this, "buffer", "");
    T(this, "pending", /* @__PURE__ */ new Map());
    T(this, "status", "idle");
    T(this, "statusMessage", "");
    T(this, "currentSessionId", null);
    T(this, "startedAtMs", null);
    T(this, "sequence", 0);
  }
  async start(t) {
    if (this.status === "recording" || this.status === "starting")
      return { success: !1, message: "Native capture already in progress" };
    const o = await this.ensureProcess();
    if (!o.success)
      return o;
    this.status = "starting", this.statusMessage = "", this.currentSessionId = t.sessionId, this.startedAtMs = Date.now();
    try {
      const c = await this.sendRequest({
        id: this.nextId("start"),
        cmd: "start_capture",
        payload: t
      }, 1e4);
      return c.ok ? (this.status = "recording", this.statusMessage = "", { success: !0 }) : (this.status = "error", this.statusMessage = c.error || "Failed to start native capture", { success: !1, message: this.statusMessage });
    } catch (c) {
      return this.status = "error", this.statusMessage = c instanceof Error ? c.message : "Failed to start native capture", { success: !1, message: this.statusMessage };
    }
  }
  async stop(t) {
    var o, c, d, a, h, w;
    if (this.status !== "recording" && this.status !== "starting")
      return { success: !1, message: "Native capture is not active" };
    if (!this.process)
      return this.status = "idle", { success: !1, message: "Native capture process not available" };
    this.status = "stopping";
    try {
      const l = await this.sendRequest({
        id: this.nextId("stop"),
        cmd: "stop_capture",
        payload: t
      }, 12e4);
      if (!l.ok)
        return this.status = "error", this.statusMessage = l.error || "Failed to stop native capture", { success: !1, message: this.statusMessage };
      const y = typeof ((o = l.payload) == null ? void 0 : o.outputPath) == "string" ? l.payload.outputPath : "";
      if (!y)
        return this.status = "error", this.statusMessage = "Native capture did not return output path", { success: !1, message: this.statusMessage };
      const P = K.existsSync(y) ? K.statSync(y) : void 0, A = {
        outputPath: y,
        durationMs: Q((c = l.payload) == null ? void 0 : c.durationMs),
        width: Q((d = l.payload) == null ? void 0 : d.width),
        height: Q((a = l.payload) == null ? void 0 : a.height),
        fpsActual: Q((h = l.payload) == null ? void 0 : h.fpsActual),
        bytes: Q((w = l.payload) == null ? void 0 : w.bytes) ?? (P == null ? void 0 : P.size)
      };
      return this.status = "idle", this.statusMessage = "", this.currentSessionId = null, this.startedAtMs = null, { success: !0, result: A };
    } catch (l) {
      return this.status = "error", this.statusMessage = l instanceof Error ? l.message : "Failed to stop native capture", { success: !1, message: this.statusMessage };
    }
  }
  async getEncoderOptions(t) {
    var d;
    const o = this.getEncoderOptionsFromFfmpeg(t), c = await this.ensureProcess();
    if (!c.success)
      return {
        success: o.success,
        options: o.options,
        message: c.message || o.message
      };
    try {
      const a = await this.sendRequest({
        id: this.nextId("get-encoder-options"),
        cmd: "get_encoder_options",
        payload: {
          platform: process.platform,
          ...t ? { ffmpegPath: t } : {}
        }
      }, 5e3);
      if (!a.ok)
        return o.options.length > 1 ? {
          success: !0,
          options: o.options,
          message: a.error || o.message || "Sidecar encoder options unavailable, used FFmpeg probe fallback"
        } : {
          success: !1,
          options: o.options,
          message: a.error || "Failed to fetch encoder options"
        };
      const w = (Array.isArray((d = a.payload) == null ? void 0 : d.options) ? a.payload.options : []).filter((l) => !!l && typeof l == "object" && typeof l.codec == "string" && typeof l.label == "string" && typeof l.hardware == "string").map((l) => ({
        encoder: l.codec,
        label: l.label,
        hardware: l.hardware
      }));
      return w.some((l) => l.encoder === "h264_libx264") || w.unshift({ encoder: "h264_libx264", label: "x264 (CPU)", hardware: "cpu" }), { success: !0, options: w };
    } catch (a) {
      return o.options.length > 1 ? {
        success: !0,
        options: o.options,
        message: a instanceof Error ? a.message : o.message
      } : {
        success: !1,
        options: o.options,
        message: a instanceof Error ? a.message : "Failed to fetch encoder options"
      };
    }
  }
  getEncoderOptionsFromFfmpeg(t) {
    const o = [
      { encoder: "h264_libx264", label: "x264 (CPU)", hardware: "cpu" }
    ], c = t || (process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"), d = Ve(c, ["-hide_banner", "-encoders"], {
      encoding: "utf8",
      windowsHide: !0,
      timeout: 4e3
    }), a = `${d.stdout || ""}
${d.stderr || ""}`;
    return d.error || !a.trim() ? {
      success: !1,
      options: o,
      message: d.error instanceof Error ? d.error.message : "Unable to probe FFmpeg encoders"
    } : (a.includes("h264_nvenc") && o.push({ encoder: "h264_nvenc", label: "NVIDIA H264 (GPU)", hardware: "nvidia" }), a.includes("h264_amf") && o.push({ encoder: "h264_amf", label: "AMD H264", hardware: "amd" }), { success: !0, options: o });
  }
  getStatus(t) {
    return {
      status: this.status,
      message: this.statusMessage || void 0,
      sessionId: t || this.currentSessionId || void 0,
      startedAtMs: this.startedAtMs || void 0
    };
  }
  dispose() {
    for (const [, t] of this.pending.entries())
      clearTimeout(t.timeout), t.reject(new Error("Native capture service disposed"));
    this.pending.clear(), this.process && !this.process.killed && this.process.kill(), this.process = null, this.buffer = "", this.status = "idle", this.statusMessage = "", this.currentSessionId = null, this.startedAtMs = null;
  }
  async ensureProcess() {
    if (this.process && !this.process.killed)
      return { success: !0 };
    const t = Ge();
    if (!t)
      return { success: !1, message: "Native capture sidecar not found. Build sidecar binaries first." };
    const o = Pe(t, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: !0
    });
    this.process = o, this.buffer = "", o.stdout.setEncoding("utf8"), o.stdout.on("data", (c) => {
      this.consumeStdout(c);
    }), o.stderr.setEncoding("utf8"), o.stderr.on("data", (c) => {
      const d = c.trim();
      d && console.info("[native-capture][sidecar][stderr]", d);
    }), o.on("exit", (c, d) => {
      const a = `Native capture sidecar exited (code=${c ?? "null"}, signal=${d ?? "null"})`;
      for (const [, h] of this.pending.entries())
        clearTimeout(h.timeout), h.reject(new Error(a));
      this.pending.clear(), this.process = null, this.status !== "idle" && (this.status = "error", this.statusMessage = a);
    });
    try {
      const c = await this.sendRequest({
        id: this.nextId("init"),
        cmd: "init",
        payload: { platform: process.platform }
      }, 5e3);
      return c.ok ? { success: !0 } : (this.status = "error", this.statusMessage = c.error || "Native capture sidecar init failed", { success: !1, message: this.statusMessage });
    } catch (c) {
      return this.status = "error", this.statusMessage = c instanceof Error ? c.message : "Native capture init failed", { success: !1, message: this.statusMessage };
    }
  }
  consumeStdout(t) {
    this.buffer += t;
    const o = this.buffer.split(/\r?\n/);
    this.buffer = o.pop() ?? "";
    for (const c of o) {
      const d = c.trim();
      if (!d) continue;
      let a;
      try {
        a = JSON.parse(d);
      } catch {
        continue;
      }
      if (a.id) {
        const h = this.pending.get(a.id);
        if (h) {
          clearTimeout(h.timeout), this.pending.delete(a.id), h.resolve(a);
          continue;
        }
      }
      a.event === "capture_error" && (this.status = "error", this.statusMessage = a.error || "Native capture sidecar reported error");
    }
  }
  async sendRequest(t, o) {
    if (!this.process || this.process.killed)
      throw new Error("Native capture process is not running");
    const c = Date.now();
    console.info("[native-capture][main] -> sidecar", { cmd: t.cmd, id: t.id, timeoutMs: o });
    const d = `${JSON.stringify(t)}
`, a = new Promise((w, l) => {
      const y = setTimeout(() => {
        this.pending.delete(t.id), l(new Error(`Native capture request timed out (${t.cmd})`));
      }, o);
      this.pending.set(t.id, { resolve: w, reject: l, timeout: y });
    });
    this.process.stdin.write(d);
    const h = await a;
    return console.info("[native-capture][main] <- sidecar", {
      cmd: t.cmd,
      id: t.id,
      ok: h.ok,
      elapsedMs: Date.now() - c,
      error: h.error
    }), h;
  }
  nextId(t) {
    return this.sequence += 1, `${t}-${Date.now()}-${this.sequence}`;
  }
}
function Ge() {
  const i = process.platform === "win32" ? "native-capture-sidecar.exe" : "native-capture-sidecar", t = I.isPackaged ? [
    m.join(process.resourcesPath, "native-capture", process.platform, i),
    m.join(process.resourcesPath, "native-capture", i)
  ] : [
    m.join(I.getAppPath(), "native-capture-sidecar", "bin", process.platform, i),
    m.join(I.getAppPath(), "native-capture-sidecar", "target", "debug", i),
    m.join(I.getAppPath(), "native-capture-sidecar", "target", "release", i)
  ];
  for (const o of t)
    if (K.existsSync(o))
      return o;
  return null;
}
function Q(i) {
  return typeof i == "number" && Number.isFinite(i) ? i : void 0;
}
const Je = m.dirname(de(import.meta.url));
let M = null, B = null, S = null;
const ge = new Ye(), se = new Ke(), ce = m.join(I.getPath("documents"), "velocity exports"), x = {
  micEnabled: !0,
  selectedMicDeviceId: "",
  micProcessingMode: "cleaned",
  cameraEnabled: !1,
  cameraPreviewEnabled: !0,
  selectedCameraDeviceId: "",
  recordingPreset: "quality",
  recordingFps: 60,
  customCursorEnabled: !0,
  useLegacyRecorder: !1,
  recordingEncoder: "h264_libx264",
  encoderOptions: [
    { encoder: "h264_libx264", label: "x264 (CPU)", hardware: "cpu" }
  ]
};
function we(i) {
  if (!i) return;
  const o = V.getAllDisplays().find((h) => String(h.id) === i);
  if (!o) return;
  const c = (h) => {
    const w = V.dipToScreenPoint;
    return typeof w == "function" ? w(h) : h;
  }, d = c({ x: o.bounds.x, y: o.bounds.y }), a = c({
    x: o.bounds.x + o.bounds.width,
    y: o.bounds.y + o.bounds.height
  });
  return {
    x: d.x,
    y: d.y,
    width: Math.max(1, a.x - d.x),
    height: Math.max(1, a.y - d.y)
  };
}
function ye(i) {
  const t = Math.round(i);
  return Math.max(2, t - t % 2);
}
function Qe(i, t) {
  const o = Math.max(1, i.width * i.height), c = Math.max(1, t.width * t.height), d = Math.min(1, Math.sqrt(o / c));
  return {
    width: ye(t.width * d),
    height: ye(t.height * d)
  };
}
function Ze() {
  return !M || typeof M != "object" ? null : {
    id: typeof M.id == "string" ? M.id : void 0,
    display_id: typeof M.display_id == "string" ? M.display_id : void 0
  };
}
let X = null, Y = null;
const Z = {};
function et(i) {
  const t = m.parse(i);
  return m.join(t.dir, `${t.name}.telemetry.json`);
}
async function tt(i) {
  var o;
  const t = et(i);
  try {
    const c = await F.readFile(t, "utf-8"), d = JSON.parse(c);
    if (d && d.version === 1 && Array.isArray(d.events))
      return console.info("[auto-zoom][main] Telemetry sidecar loaded", {
        telemetryPath: t,
        sessionId: d.sessionId,
        totalEvents: ((o = d.stats) == null ? void 0 : o.totalEvents) ?? 0
      }), { path: t, telemetry: d };
    console.warn("[auto-zoom][main] Telemetry sidecar was present but invalid format", {
      telemetryPath: t
    });
  } catch {
    console.info("[auto-zoom][main] No telemetry sidecar found for video", {
      videoPath: i,
      telemetryPath: t
    });
  }
  return null;
}
function st(i, t, o, c, d, a, h, w, l) {
  const y = (s) => s === "recording" ? X : Y, P = (s, e) => {
    if (s === "recording") {
      X = e, e || delete Z.recording;
      return;
    }
    Y = e, e || delete Z.media;
  }, A = () => {
    const s = [X, Y];
    for (const e of s)
      e && !e.isDestroyed() && e.close();
    X = null, Y = null, delete Z.recording, delete Z.media;
  }, z = (s, e, r, n) => {
    const u = e === "recording" ? { width: 420, height: 560 } : { width: 360, height: 290 }, p = 8, g = {
      x: s.x + r.x,
      y: s.y + r.y,
      width: r.width,
      height: r.height
    }, D = V.getDisplayMatching(s).workArea, C = g.x + Math.round((g.width - u.width) / 2), N = D.x + D.width - u.width, _ = Math.max(D.x, Math.min(C, N)), E = n === "top" ? g.y - u.height - p : g.y + g.height + p, ke = D.y + D.height - u.height, Ee = Math.max(D.y, Math.min(E, ke));
    return { x: _, y: Ee, width: u.width, height: u.height };
  }, W = () => {
    U.getAllWindows().forEach((s) => {
      s.isDestroyed() || s.webContents.send("hud-settings-updated", x);
    });
  }, j = (s, e) => {
    const r = new U({
      width: e.width,
      height: e.height,
      resizable: !1,
      frame: !1,
      transparent: !0,
      show: !1,
      hasShadow: !1,
      alwaysOnTop: !0,
      skipTaskbar: !0,
      x: e.x,
      y: e.y,
      webPreferences: {
        preload: m.join(Je, "preload.mjs"),
        nodeIntegration: !1,
        contextIsolation: !0,
        backgroundThrottling: !1
      }
    });
    if (r.on("closed", () => {
      P(s, null);
    }), ue) {
      const n = new URL(ue);
      n.searchParams.set("windowType", "hud-popover"), n.searchParams.set("kind", s), r.loadURL(n.toString());
    } else
      r.loadFile(m.join(me, "index.html"), {
        query: { windowType: "hud-popover", kind: s }
      });
    return P(s, r), r;
  }, O = (s, e, r) => {
    const n = a();
    if (!n || n.isDestroyed())
      return { success: !1, message: "HUD window unavailable" };
    Z[s] = { anchorRect: e, side: r };
    const u = z(n.getBounds(), s, e, r), p = y(s);
    if (p && !p.isDestroyed()) {
      p.setBounds(u, !1);
      const v = () => {
        p.isDestroyed() || (p.isVisible() || p.show(), p.webContents.send("hud-settings-updated", x));
      };
      return p.webContents.isLoadingMainFrame() ? p.webContents.once("did-finish-load", v) : v(), { success: !0 };
    }
    const g = j(s, u);
    return g.webContents.once("did-finish-load", () => {
      g.isDestroyed() || (g.webContents.send("hud-settings-updated", x), g.show());
    }), { success: !0 };
  }, q = async (s) => {
    await F.mkdir(s, { recursive: !0 });
  }, ne = () => I.isPackaged ? m.join(process.resourcesPath, "native-capture", process.platform, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg") : m.join(I.getAppPath(), "native-capture-sidecar", "bin", process.platform, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"), Se = async (s, e, r = 0) => {
    const n = ne();
    if (!K.existsSync(n))
      return { success: !1, message: "ffmpeg executable not found for native audio muxing" };
    const u = m.parse(s), p = m.join(u.dir, `${u.name}.with-audio${u.ext || ".mp4"}`), g = [
      "-y",
      "-i",
      s
    ], v = Math.abs(r) / 1e3;
    r > 0 && v > 1e-3 ? g.push("-itsoffset", v.toFixed(3)) : r < 0 && v > 1e-3 && g.push("-ss", v.toFixed(3)), g.push(
      "-i",
      e,
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
      p
    );
    const D = await new Promise((C) => {
      const N = Pe(n, g, { windowsHide: !0, stdio: ["ignore", "pipe", "pipe"] });
      let _ = "";
      N.stderr.setEncoding("utf8"), N.stderr.on("data", (E) => {
        _.length < 4e3 && (_ += String(E));
      }), N.on("error", (E) => {
        C({ success: !1, message: `ffmpeg failed to start: ${String(E)}` });
      }), N.on("close", (E) => {
        if (E === 0) {
          C({ success: !0 });
          return;
        }
        C({
          success: !1,
          message: `ffmpeg mux failed with exit code ${String(E)}${_ ? `: ${_.trim()}` : ""}`
        });
      });
    });
    if (!D.success)
      return await J(p), { success: !1, message: D.message };
    try {
      await F.unlink(s);
    } catch {
    }
    return await F.rename(p, s), { success: !0, outputPath: s };
  }, fe = async (s, e) => {
    const r = m.parse(e);
    let n = m.join(s, e), u = 1;
    for (; ; )
      try {
        await F.access(n), n = m.join(s, `${r.name} (${u})${r.ext}`), u += 1;
      } catch {
        return n;
      }
  }, J = async (s) => {
    if (s)
      try {
        await F.unlink(s), console.info("[editor][main] Deleted recording asset", { filePath: s });
      } catch {
        console.warn("[editor][main] Could not delete recording asset (ignored)", { filePath: s });
      }
  };
  f.handle("get-sources", async (s, e) => (await xe.getSources(e)).map((n) => ({
    id: n.id,
    name: n.name,
    display_id: n.display_id,
    thumbnail: n.thumbnail ? n.thumbnail.toDataURL() : null,
    appIcon: n.appIcon ? n.appIcon.toDataURL() : null
  }))), f.handle("select-source", (s, e) => {
    M = e;
    const r = h();
    return r && r.close(), M;
  }), f.handle("get-selected-source", () => M), f.handle("start-input-tracking", (s, e) => {
    console.info("[auto-zoom][main] start-input-tracking requested", {
      sessionId: e.sessionId,
      sourceId: e.sourceId,
      sourceDisplayId: e.sourceDisplayId,
      selectedSourceId: M == null ? void 0 : M.id,
      selectedSourceDisplayId: M == null ? void 0 : M.display_id
    });
    const r = ge.start(e, M ?? void 0);
    return r.success ? console.info("[auto-zoom][main] Input tracking started", {
      sessionId: e.sessionId
    }) : console.warn("[auto-zoom][main] Input tracking failed to start", {
      sessionId: e.sessionId,
      message: r.message
    }), r;
  }), f.handle("stop-input-tracking", () => {
    const s = ge.stop();
    return s ? (console.info("[auto-zoom][main] Input tracking stopped with telemetry", {
      sessionId: s.sessionId,
      totalEvents: s.stats.totalEvents,
      mouseDownCount: s.stats.mouseDownCount,
      keyDownCount: s.stats.keyDownCount,
      wheelCount: s.stats.wheelCount
    }), { success: !0, telemetry: s }) : (console.warn("[auto-zoom][main] stop-input-tracking called with no active tracking session"), { success: !1, message: "No active input tracking session" });
  }), f.handle("open-source-selector", () => {
    const s = h();
    if (s) {
      s.focus();
      return;
    }
    o();
  }), f.handle("open-camera-preview-window", (s, e) => {
    const r = w();
    return r && r.close(), c(e).focus(), { success: !0 };
  }), f.handle("close-camera-preview-window", () => (d(), { success: !0 })), f.handle("switch-to-editor", () => {
    A();
    const s = a();
    s && s.close(), i();
  }), f.handle("store-recorded-video", async (s, e, r) => {
    try {
      const n = m.join(R, r);
      return await F.writeFile(n, Buffer.from(e)), B = n, S = null, {
        success: !0,
        path: n,
        message: "Video stored successfully"
      };
    } catch (n) {
      return console.error("Failed to store video:", n), {
        success: !1,
        message: "Failed to store video",
        error: String(n)
      };
    }
  }), f.handle("start-new-recording-session", async (s, e) => (!!(e != null && e.replaceCurrentTake) && (e != null && e.session) && (await J(e.session.screenVideoPath), await J(e.session.cameraVideoPath), await J(e.session.inputTelemetryPath)), S = null, B = null, A(), t(), { success: !0 })), f.handle("get-hud-settings", () => ({ success: !0, settings: x })), f.handle("preload-hud-popover-windows", () => {
    const s = a();
    if (!s || s.isDestroyed())
      return { success: !1, message: "HUD window unavailable" };
    const e = s.getBounds(), r = { x: Math.max(16, Math.floor(e.width / 2) - 10), y: Math.max(16, Math.floor(e.height / 2) - 10), width: 20, height: 20 };
    return ["recording", "media"].forEach((n) => {
      const u = y(n);
      if (u && !u.isDestroyed())
        return;
      const p = z(e, n, r, "top");
      j(n, p);
    }), { success: !0 };
  }), f.handle("update-hud-settings", (s, e) => (typeof e.micEnabled == "boolean" && (x.micEnabled = e.micEnabled), typeof e.selectedMicDeviceId == "string" && (x.selectedMicDeviceId = e.selectedMicDeviceId), (e.micProcessingMode === "raw" || e.micProcessingMode === "cleaned") && (x.micProcessingMode = e.micProcessingMode), typeof e.cameraEnabled == "boolean" && (x.cameraEnabled = e.cameraEnabled), typeof e.cameraPreviewEnabled == "boolean" && (x.cameraPreviewEnabled = e.cameraPreviewEnabled), typeof e.selectedCameraDeviceId == "string" && (x.selectedCameraDeviceId = e.selectedCameraDeviceId), (e.recordingPreset === "performance" || e.recordingPreset === "balanced" || e.recordingPreset === "quality") && (x.recordingPreset = e.recordingPreset), (e.recordingFps === 60 || e.recordingFps === 120) && (x.recordingFps = e.recordingFps), typeof e.customCursorEnabled == "boolean" && (x.customCursorEnabled = e.customCursorEnabled, e.customCursorEnabled && (x.useLegacyRecorder = !1)), typeof e.useLegacyRecorder == "boolean" && (x.useLegacyRecorder = e.useLegacyRecorder, e.useLegacyRecorder && (x.customCursorEnabled = !1)), (e.recordingEncoder === "h264_libx264" || e.recordingEncoder === "h264_nvenc" || e.recordingEncoder === "hevc_nvenc" || e.recordingEncoder === "h264_amf") && (x.recordingEncoder = e.recordingEncoder), W(), { success: !0, settings: x })), f.handle("set-hud-encoder-options", (s, e) => {
    var n;
    if (!Array.isArray(e))
      return { success: !1, message: "Invalid encoder options payload" };
    const r = e.filter((u) => !!u && typeof u == "object" && (u.encoder === "h264_libx264" || u.encoder === "h264_nvenc" || u.encoder === "hevc_nvenc" || u.encoder === "h264_amf") && typeof u.label == "string" && (u.hardware === "cpu" || u.hardware === "nvidia" || u.hardware === "amd"));
    return r.some((u) => u.encoder === "h264_libx264") || r.unshift({ encoder: "h264_libx264", label: "x264 (CPU)", hardware: "cpu" }), x.encoderOptions = r, x.encoderOptions.some((u) => u.encoder === x.recordingEncoder) || (x.recordingEncoder = ((n = x.encoderOptions[0]) == null ? void 0 : n.encoder) ?? "h264_libx264"), W(), { success: !0, settings: x };
  }), f.handle("native-capture-encoder-options", async () => {
    const s = ne(), e = K.existsSync(s) ? s : void 0;
    return await se.getEncoderOptions(e);
  }), f.handle("native-capture-start", async (s, e) => {
    var C, N, _;
    const r = ne(), n = process.platform, u = ((C = e.source) == null ? void 0 : C.displayId) || (typeof (M == null ? void 0 : M.display_id) == "string" ? M.display_id : void 0), p = n === "win32" && ((N = e.source) == null ? void 0 : N.type) === "screen" ? we(u) : void 0, g = ((_ = e.source) == null ? void 0 : _.type) === "screen" ? we(u) : void 0, v = n === "darwin" && g ? {
      ...e.video,
      ...Qe(
        {
          width: e.video.width,
          height: e.video.height
        },
        {
          width: g.width,
          height: g.height
        }
      )
    } : e.video, D = {
      ...e,
      outputPath: m.isAbsolute(e.outputPath) ? e.outputPath : m.join(R, e.outputPath),
      video: v,
      ffmpegPath: e.ffmpegPath || (K.existsSync(r) ? r : void 0),
      captureRegion: n === "win32" ? e.captureRegion || p : void 0
    };
    return await se.start(D);
  }), f.handle("native-capture-stop", async (s, e) => await se.stop(e)), f.handle("native-capture-status", (s, e) => ({ success: !0, ...se.getStatus(e) })), f.handle("open-hud-popover-window", (s, e) => e.kind !== "recording" && e.kind !== "media" ? { success: !1, message: "Invalid popover kind" } : O(e.kind, e.anchorRect, e.side)), f.handle("toggle-hud-popover-window", (s, e) => {
    if (e.kind !== "recording" && e.kind !== "media")
      return { success: !1, message: "Invalid popover kind" };
    const r = y(e.kind);
    return r && !r.isDestroyed() && r.isVisible() ? (r.hide(), { success: !0, opened: !1 }) : { ...O(e.kind, e.anchorRect, e.side), opened: !0 };
  }), f.handle("close-hud-popover-window", (s, e) => {
    if (!e)
      return [X, Y].forEach((n) => {
        n && !n.isDestroyed() && n.hide();
      }), { success: !0 };
    const r = y(e);
    return r && !r.isDestroyed() && r.hide(), { success: !0 };
  }), f.handle("close-current-hud-popover-window", (s) => {
    const e = U.fromWebContents(s.sender);
    return !e || e.isDestroyed() ? { success: !1 } : e === X ? (e.hide(), { success: !0 }) : e === Y ? (e.hide(), { success: !0 }) : (e.hide(), { success: !0 });
  }), f.handle("set-hud-overlay-width", (s, e) => {
    const r = a();
    if (!r || r.isDestroyed())
      return { success: !1 };
    const n = Math.max(500, Math.min(1400, Math.round(e))), u = r.getBounds(), g = V.getDisplayMatching(u).workArea, v = u.x + u.width / 2, D = g.x + g.width - n, C = Math.round(v - n / 2), N = Math.max(g.x, Math.min(C, D)), _ = g.y + g.height - u.height, E = Math.max(g.y, Math.min(u.y, _));
    return r.setBounds({
      x: N,
      y: E,
      width: n,
      height: u.height
    }, !1), { success: !0 };
  }), f.handle("get-hud-overlay-popover-side", () => {
    const s = a();
    if (!s || s.isDestroyed())
      return { success: !1 };
    const e = s.getBounds(), n = V.getDisplayMatching(e).workArea, u = e.y + e.height / 2, p = n.y + n.height / 2;
    return { success: !0, side: u >= p ? "top" : "bottom" };
  }), f.handle("set-hud-overlay-height", (s, e, r = "bottom") => {
    const n = a();
    if (!n || n.isDestroyed())
      return { success: !1 };
    const u = Math.max(100, Math.min(720, Math.round(e))), p = n.getBounds(), v = V.getDisplayMatching(p).workArea, D = v.x + v.width - p.width, C = v.y + v.height - u, N = Math.max(v.x, Math.min(p.x, D)), _ = r === "top" ? p.y : p.y + p.height - u, E = Math.max(v.y, Math.min(_, C));
    return n.setBounds({
      x: N,
      y: E,
      width: p.width,
      height: u
    }, !1), { success: !0 };
  }), f.handle("store-recording-session", async (s, e) => {
    try {
      console.info("[auto-zoom][main] store-recording-session requested", {
        sessionId: typeof e.session.id == "string" ? e.session.id : void 0,
        screenFileName: e.screenFileName,
        hasCameraVideo: !!(e.cameraVideoData && e.cameraFileName),
        hasTelemetry: !!e.inputTelemetry
      });
      const r = m.join(R, e.screenFileName);
      await F.writeFile(r, Buffer.from(e.screenVideoData));
      let n;
      e.cameraVideoData && e.cameraFileName && (n = m.join(R, e.cameraFileName), await F.writeFile(n, Buffer.from(e.cameraVideoData)));
      let u, p;
      if (e.inputTelemetry) {
        const v = e.inputTelemetryFileName || `${m.parse(e.screenFileName).name}.telemetry.json`;
        u = m.join(R, v), await F.writeFile(u, JSON.stringify(e.inputTelemetry), "utf-8"), p = e.inputTelemetry, console.info("[auto-zoom][main] Telemetry sidecar saved", {
          inputTelemetryPath: u,
          sessionId: e.inputTelemetry.sessionId,
          totalEvents: e.inputTelemetry.stats.totalEvents
        });
      } else
        console.warn("[auto-zoom][main] Recording session stored without telemetry payload", {
          sessionId: typeof e.session.id == "string" ? e.session.id : void 0
        });
      const g = {
        ...e.session,
        screenVideoPath: r,
        ...n ? { cameraVideoPath: n } : {},
        ...u ? { inputTelemetryPath: u } : {},
        ...p ? { inputTelemetry: p } : {}
      };
      return S = g, B = r, console.info("[auto-zoom][main] Recording session stored in memory", {
        sessionId: typeof e.session.id == "string" ? e.session.id : void 0,
        screenVideoPath: r,
        inputTelemetryPath: u
      }), {
        success: !0,
        session: g,
        message: "Recording session stored successfully"
      };
    } catch (r) {
      return console.error("[auto-zoom][main] Failed to store recording session", r), {
        success: !1,
        message: "Failed to store recording session",
        error: String(r)
      };
    }
  }), f.handle("store-native-recording-session", async (s, e) => {
    var r;
    try {
      console.info("[native-capture][main] store-native-recording-session requested", {
        screenVideoPath: e.screenVideoPath,
        hasMicAudioData: !!e.micAudioData,
        hasCameraVideoData: !!e.cameraVideoData,
        hasInputTelemetry: !!e.inputTelemetry,
        sessionId: typeof ((r = e.session) == null ? void 0 : r.id) == "string" ? e.session.id : void 0
      });
      let n = e.screenVideoPath;
      if (!e.screenVideoPath.startsWith(R)) {
        const E = `${m.parse(e.screenVideoPath).name}.mp4`;
        n = await fe(R, E), await F.copyFile(e.screenVideoPath, n);
      }
      let u = typeof e.session.micCaptured == "boolean" ? !!e.session.micCaptured : !1;
      const p = typeof e.session.micStartOffsetMs == "number" ? Number(e.session.micStartOffsetMs) : 0;
      let g;
      if (e.micAudioData && e.micAudioFileName) {
        g = m.join(R, e.micAudioFileName), await F.writeFile(g, Buffer.from(e.micAudioData));
        const E = await Se(n, g, p);
        E.success ? u = !0 : console.warn("[native-capture][main] Failed to mux microphone audio into native capture", {
          screenVideoPath: n,
          micAudioPath: g,
          message: E.message
        });
      }
      let v;
      e.cameraVideoData && e.cameraFileName && (v = m.join(R, e.cameraFileName), await F.writeFile(v, Buffer.from(e.cameraVideoData)));
      let D, C;
      if (e.inputTelemetry) {
        const E = e.inputTelemetryFileName || `${m.parse(n).name}.telemetry.json`;
        D = m.join(R, E), await F.writeFile(D, JSON.stringify(e.inputTelemetry), "utf-8"), C = e.inputTelemetry;
      }
      const _ = {
        ...{
          ...e.session,
          micCaptured: u
        },
        screenVideoPath: n,
        ...v ? { cameraVideoPath: v } : {},
        ...D ? { inputTelemetryPath: D } : {},
        ...C ? { inputTelemetry: C } : {}
      };
      return S = _, B = n, await J(g), console.info("[native-capture][main] Native recording session stored in memory", {
        sessionId: typeof _.id == "string" ? _.id : void 0,
        screenVideoPath: n,
        cameraVideoPath: v,
        inputTelemetryPath: D
      }), {
        success: !0,
        session: _,
        message: "Native recording session stored successfully"
      };
    } catch (n) {
      return console.error("[native-capture][main] Failed to store native recording session", n), {
        success: !1,
        message: "Failed to store native recording session",
        error: String(n)
      };
    }
  }), f.handle("get-recorded-video-path", async () => {
    try {
      const e = (await F.readdir(R)).filter((u) => u.endsWith(".webm"));
      if (e.length === 0)
        return { success: !1, message: "No recorded video found" };
      const r = e.sort().reverse()[0];
      return { success: !0, path: m.join(R, r) };
    } catch (s) {
      return console.error("Failed to get video path:", s), { success: !1, message: "Failed to get video path", error: String(s) };
    }
  }), f.handle("set-recording-state", (s, e) => {
    e && A(), l && l(e, (M || { name: "Screen" }).name ?? "Screen");
  }), f.handle("open-external-url", async (s, e) => {
    try {
      return await pe.openExternal(e), { success: !0 };
    } catch (r) {
      return console.error("Failed to open URL:", r), { success: !1, error: String(r) };
    }
  }), f.handle("get-asset-base-path", () => {
    try {
      return I.isPackaged ? m.join(process.resourcesPath, "assets") : m.join(I.getAppPath(), "public", "assets");
    } catch (s) {
      return console.error("Failed to resolve asset base path:", s), null;
    }
  }), f.handle("save-exported-video", async (s, e, r) => {
    try {
      const n = r.toLowerCase().endsWith(".gif"), u = n ? [{ name: "GIF Image", extensions: ["gif"] }] : [{ name: "MP4 Video", extensions: ["mp4"] }], p = await ie.showSaveDialog({
        title: n ? "Save Exported GIF" : "Save Exported Video",
        defaultPath: m.join(I.getPath("downloads"), r),
        filters: u,
        properties: ["createDirectory", "showOverwriteConfirmation"]
      });
      return p.canceled || !p.filePath ? {
        success: !1,
        cancelled: !0,
        message: "Export cancelled"
      } : (await F.writeFile(p.filePath, Buffer.from(e)), {
        success: !0,
        path: p.filePath,
        message: "Video exported successfully"
      });
    } catch (n) {
      return console.error("Failed to save exported video:", n), {
        success: !1,
        message: "Failed to save exported video",
        error: String(n)
      };
    }
  }), f.handle("get-default-export-directory", async () => {
    try {
      return await q(ce), { success: !0, path: ce };
    } catch (s) {
      return console.error("Failed to resolve default export directory:", s), { success: !1, message: "Failed to resolve default export directory", error: String(s) };
    }
  }), f.handle("choose-export-directory", async (s, e) => {
    try {
      const r = await ie.showOpenDialog({
        title: "Choose Export Folder",
        defaultPath: e || ce,
        properties: ["openDirectory", "createDirectory"]
      });
      if (r.canceled || r.filePaths.length === 0)
        return { success: !1, cancelled: !0, message: "Folder selection cancelled" };
      const n = r.filePaths[0];
      return await q(n), { success: !0, path: n };
    } catch (r) {
      return console.error("Failed to choose export directory:", r), { success: !1, message: "Failed to choose export directory", error: String(r) };
    }
  }), f.handle("save-exported-video-to-directory", async (s, e, r, n) => {
    try {
      await q(n);
      const u = await fe(n, r);
      return await F.writeFile(u, Buffer.from(e)), {
        success: !0,
        path: u,
        message: "Video exported successfully"
      };
    } catch (u) {
      return console.error("Failed to save exported video to directory:", u), {
        success: !1,
        message: "Failed to save exported video",
        error: String(u)
      };
    }
  }), f.handle("open-directory", async (s, e) => {
    try {
      await q(e);
      const r = await pe.openPath(e);
      return r ? { success: !1, message: r } : { success: !0 };
    } catch (r) {
      return console.error("Failed to open directory:", r), { success: !1, message: "Failed to open directory", error: String(r) };
    }
  }), f.handle("open-video-file-picker", async () => {
    try {
      const s = await ie.showOpenDialog({
        title: "Select Video File",
        defaultPath: R,
        filters: [
          { name: "Video Files", extensions: ["webm", "mp4", "mov", "avi", "mkv"] },
          { name: "All Files", extensions: ["*"] }
        ],
        properties: ["openFile"]
      });
      return s.canceled || s.filePaths.length === 0 ? { success: !1, cancelled: !0 } : {
        success: !0,
        path: s.filePaths[0]
      };
    } catch (s) {
      return console.error("Failed to open file picker:", s), {
        success: !1,
        message: "Failed to open file picker",
        error: String(s)
      };
    }
  }), f.handle("set-current-video-path", async (s, e) => {
    B = e;
    const r = await tt(e);
    return S = r ? {
      id: `session-${Date.now()}`,
      startedAtMs: Date.now(),
      screenVideoPath: e,
      micEnabled: !1,
      micCaptured: !1,
      cameraEnabled: !1,
      cameraCaptured: !1,
      screenDurationMs: 0,
      inputTelemetryPath: r.path,
      inputTelemetry: r.telemetry
    } : null, console.info("[auto-zoom][main] set-current-video-path complete", {
      videoPath: e,
      hasTelemetry: !!r,
      telemetryPath: r == null ? void 0 : r.path,
      generatedSessionId: S == null ? void 0 : S.id
    }), { success: !0 };
  }), f.handle("get-current-video-path", () => B ? { success: !0, path: B } : { success: !1 }), f.handle("clear-current-video-path", () => (B = null, S = null, { success: !0 })), f.handle("set-current-recording-session", (s, e) => (S = e, B = typeof e.screenVideoPath == "string" ? e.screenVideoPath : null, console.info("[auto-zoom][main] set-current-recording-session", {
    sessionId: typeof e.id == "string" ? e.id : void 0,
    hasTelemetry: !!e.inputTelemetry,
    telemetryPath: typeof e.inputTelemetryPath == "string" ? e.inputTelemetryPath : void 0
  }), { success: !0 })), f.handle("get-current-recording-session", () => (console.info("[auto-zoom][main] get-current-recording-session", {
    hasSession: !!S,
    sessionId: typeof (S == null ? void 0 : S.id) == "string" ? S.id : void 0,
    hasTelemetry: !!(S != null && S.inputTelemetry)
  }), S ? { success: !0, session: S } : { success: !1 })), f.handle("get-platform", () => process.platform);
}
const rt = m.dirname(de(import.meta.url)), R = m.join(I.getPath("userData"), "recordings"), he = m.join(I.getPath("temp"), "velocity-session-data");
I.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
I.commandLine.appendSwitch("disk-cache-dir", m.join(he, "Cache"));
I.setPath("sessionData", he);
async function ot() {
  try {
    await F.mkdir(R, { recursive: !0 }), console.log("RECORDINGS_DIR:", R), console.log("User Data Path:", I.getPath("userData"));
  } catch (i) {
    console.error("Failed to create recordings directory:", i);
  }
}
async function nt() {
  try {
    await F.mkdir(he, { recursive: !0 });
  } catch (i) {
    console.error("Failed to create session data directory:", i);
  }
}
process.env.APP_ROOT = m.join(rt, "..");
const ue = process.env.VITE_DEV_SERVER_URL, yt = m.join(process.env.APP_ROOT, "dist-electron"), me = m.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = ue ? m.join(process.env.APP_ROOT, "public") : me;
let b = null, L = null, H = null, Me = "";
const Ie = Te("velocity.png"), it = Te("rec-button.png");
function oe() {
  b = De();
}
function ve() {
  H = new Re(Ie), process.platform === "win32" && H.on("double-click", () => {
    b && !b.isDestroyed() ? (b.isMinimized() && b.restore(), b.show(), b.focus()) : oe();
  });
}
function Te(i) {
  return Ce.createFromPath(m.join(process.env.VITE_PUBLIC || me, i)).resize({
    width: 24,
    height: 24,
    quality: "best"
  });
}
function be(i = !1) {
  if (!H) return;
  const t = i ? it : Ie, o = i ? `Recording: ${Me}` : "velocity", c = i ? [
    {
      label: "Stop Recording",
      click: () => {
        b && !b.isDestroyed() && b.webContents.send("stop-recording-from-tray");
      }
    }
  ] : [
    {
      label: "Open",
      click: () => {
        b && !b.isDestroyed() ? b.isMinimized() && b.restore() : oe();
      }
    },
    {
      label: "Quit",
      click: () => {
        I.quit();
      }
    }
  ];
  H.setImage(t), H.setToolTip(o), H.setContextMenu(Ne.buildFromTemplate(c));
}
function at() {
  b && (b.close(), b = null), le(), b = Oe();
}
function ct() {
  b && (b.close(), b = null), le(), L && !L.isDestroyed() && L.close(), L = null, b = De();
}
function ut() {
  return L = ze(), L.on("closed", () => {
    L = null;
  }), L;
}
I.on("window-all-closed", () => {
});
I.on("activate", () => {
  U.getAllWindows().length === 0 && oe();
});
I.whenReady().then(async () => {
  await nt(), Ae.defaultSession.setDisplayMediaRequestHandler(async (t, o) => {
    try {
      const c = Ze(), d = await xe.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 0, height: 0 },
        fetchWindowIcons: !1
      });
      let a = c != null && c.id ? d.find((h) => h.id === c.id) : void 0;
      if (!a && (c != null && c.display_id) && (a = d.find((h) => h.display_id === c.display_id && h.id.startsWith("screen:"))), a || (a = d.find((h) => h.id.startsWith("screen:")) || d[0]), !a) {
        o({});
        return;
      }
      o({
        video: a
      });
    } catch (c) {
      console.error("Display media handler failed:", c), o({});
    }
  }, { useSystemPicker: !1 });
  const { ipcMain: i } = await import("electron");
  i.on("hud-overlay-close", () => {
    I.quit();
  }), ve(), be(), await ot(), st(
    at,
    ct,
    ut,
    Be,
    le,
    () => b,
    () => L,
    () => Le(),
    (t, o) => {
      Me = o, H || ve(), be(t), t || b && b.restore();
    }
  ), oe();
});
export {
  yt as MAIN_DIST,
  R as RECORDINGS_DIR,
  me as RENDERER_DIST,
  ue as VITE_DEV_SERVER_URL
};
