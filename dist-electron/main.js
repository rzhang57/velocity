import { BrowserWindow as E, screen as O, ipcMain as c, desktopCapturer as W, shell as V, app as d, nativeImage as L, Tray as U, Menu as A } from "electron";
import { fileURLToPath as S } from "node:url";
import t from "node:path";
import p from "node:fs/promises";
import { uIOhook as w } from "uiohook-napi";
const P = t.dirname(S(import.meta.url)), C = t.join(P, ".."), y = process.env.VITE_DEV_SERVER_URL, x = t.join(C, "dist");
function N() {
  const e = new E({
    width: 250,
    height: 80,
    minWidth: 250,
    maxWidth: 250,
    minHeight: 80,
    maxHeight: 80,
    frame: !1,
    transparent: !0,
    resizable: !1,
    alwaysOnTop: !0,
    skipTaskbar: !0,
    hasShadow: !1,
    webPreferences: {
      preload: t.join(P, "preload.mjs"),
      nodeIntegration: !1,
      contextIsolation: !0,
      backgroundThrottling: !1
    }
  });
  return e.webContents.on("did-finish-load", () => {
    e == null || e.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), y ? e.loadURL(y + "?windowType=hud-overlay") : e.loadFile(t.join(x, "index.html"), {
    query: { windowType: "hud-overlay" }
  }), e;
}
function H() {
  const e = new E({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: !0,
    transparent: !1,
    resizable: !0,
    alwaysOnTop: !1,
    skipTaskbar: !1,
    title: "",
    webPreferences: {
      preload: t.join(P, "preload.mjs"),
      nodeIntegration: !1,
      contextIsolation: !0,
      webSecurity: !1
    }
  });
  return e.maximize(), e.webContents.on("did-finish-load", () => {
    e == null || e.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), y ? e.loadURL(y + "?windowType=editor") : e.loadFile(t.join(x, "index.html"), {
    query: { windowType: "editor" }
  }), e;
}
function z() {
  const { width: e, height: n } = O.getPrimaryDisplay().workAreaSize, i = new E({
    width: 620,
    height: 420,
    minHeight: 350,
    maxHeight: 500,
    x: Math.round((e - 620) / 2),
    y: Math.round((n - 420) / 2),
    frame: !1,
    resizable: !1,
    alwaysOnTop: !0,
    transparent: !0,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: t.join(P, "preload.mjs"),
      nodeIntegration: !1,
      contextIsolation: !0
    }
  });
  return y ? i.loadURL(y + "?windowType=source-selector") : i.loadFile(t.join(x, "index.html"), {
    query: { windowType: "source-selector" }
  }), i;
}
let u = !1, b = !1, m = 0, f = [];
function q() {
  if (u)
    return { success: !1, message: "Already tracking" };
  if (u = !0, m = performance.now(), f = [], b)
    return { success: !0, message: "Mouse tracking resumed", startTime: m };
  $();
  try {
    return w.start(), b = !0, { success: !0, message: "Mouse tracking started", startTime: m };
  } catch (e) {
    return console.error("Failed to start mouse tracking:", e), u = !1, { success: !1, message: "Failed to start hook", error: e };
  }
}
function B() {
  if (!u)
    return { success: !1, message: "Not currently tracking" };
  u = !1;
  const e = performance.now() - m;
  return {
    success: !0,
    message: "Mouse tracking stopped",
    data: {
      startTime: m,
      events: f,
      duration: e
    }
  };
}
function $() {
  w.on("mousemove", (e) => {
    if (u) {
      const i = {
        type: "move",
        timestamp: performance.now() - m,
        x: e.x,
        y: e.y
      };
      f.push(i);
    }
  }), w.on("mousedown", (e) => {
    if (u) {
      const i = {
        type: "down",
        timestamp: performance.now() - m,
        x: e.x,
        y: e.y,
        button: e.button,
        clicks: e.clicks
      };
      f.push(i);
    }
  }), w.on("mouseup", (e) => {
    if (u) {
      const i = {
        type: "up",
        timestamp: performance.now() - m,
        x: e.x,
        y: e.y,
        button: e.button
      };
      f.push(i);
    }
  }), w.on("click", (e) => {
    if (u) {
      const i = {
        type: "click",
        timestamp: performance.now() - m,
        x: e.x,
        y: e.y,
        button: e.button,
        clicks: e.clicks
      };
      f.push(i);
    }
  });
}
function G() {
  return [...f];
}
function I() {
  if (b)
    try {
      w.stop(), b = !1, u = !1, f = [];
    } catch (e) {
      console.error("Error cleaning up mouse tracking:", e);
    }
}
let _ = null;
function J(e, n, i, v, T) {
  c.handle("get-sources", async (o, a) => (await W.getSources(a)).map((r) => ({
    id: r.id,
    name: r.name,
    display_id: r.display_id,
    thumbnail: r.thumbnail ? r.thumbnail.toDataURL() : null,
    appIcon: r.appIcon ? r.appIcon.toDataURL() : null
  }))), c.handle("select-source", (o, a) => {
    _ = a;
    const s = v();
    return s && s.close(), _;
  }), c.handle("get-selected-source", () => _), c.handle("open-source-selector", () => {
    const o = v();
    if (o) {
      o.focus();
      return;
    }
    n();
  }), c.handle("switch-to-editor", () => {
    const o = i();
    o && o.close(), e();
  }), c.handle("start-mouse-tracking", () => q()), c.handle("stop-mouse-tracking", () => B()), c.handle("store-recorded-video", async (o, a, s) => {
    try {
      const r = t.join(h, s);
      return await p.writeFile(r, Buffer.from(a)), {
        success: !0,
        path: r,
        message: "Video stored successfully"
      };
    } catch (r) {
      return console.error("Failed to store video:", r), {
        success: !1,
        message: "Failed to store video",
        error: String(r)
      };
    }
  }), c.handle("store-mouse-tracking-data", async (o, a) => {
    try {
      const s = G();
      if (s.length === 0)
        return { success: !1, message: "No tracking data to save" };
      const r = t.join(h, a);
      return await p.writeFile(r, JSON.stringify(s, null, 2), "utf-8"), {
        success: !0,
        path: r,
        eventCount: s.length,
        message: "Mouse tracking data stored successfully"
      };
    } catch (s) {
      return console.error("Failed to store mouse tracking data:", s), {
        success: !1,
        message: "Failed to store mouse tracking data",
        error: String(s)
      };
    }
  }), c.handle("get-recorded-video-path", async () => {
    try {
      const a = (await p.readdir(h)).filter((R) => R.endsWith(".webm"));
      if (a.length === 0)
        return { success: !1, message: "No recorded video found" };
      const s = a.sort().reverse()[0];
      return { success: !0, path: t.join(h, s) };
    } catch (o) {
      return console.error("Failed to get video path:", o), { success: !1, message: "Failed to get video path", error: String(o) };
    }
  }), c.handle("set-recording-state", (o, a) => {
    T && T(a, (_ || { name: "Screen" }).name);
  }), c.handle("open-external-url", async (o, a) => {
    try {
      return await V.openExternal(a), { success: !0 };
    } catch (s) {
      return console.error("Failed to open URL:", s), { success: !1, error: String(s) };
    }
  }), c.handle("get-asset-base-path", () => {
    try {
      return d.isPackaged ? t.join(process.resourcesPath, "assets") : t.join(d.getAppPath(), "public", "assets");
    } catch (o) {
      return console.error("Failed to resolve asset base path:", o), null;
    }
  }), c.handle("save-exported-video", async (o, a, s) => {
    try {
      const r = d.getPath("downloads"), R = t.join(r, s);
      return await p.writeFile(R, Buffer.from(a)), {
        success: !0,
        path: R,
        message: "Video exported successfully"
      };
    } catch (r) {
      return console.error("Failed to save exported video:", r), {
        success: !1,
        message: "Failed to save exported video",
        error: String(r)
      };
    }
  });
}
const K = t.dirname(S(import.meta.url)), h = t.join(d.getPath("userData"), "recordings");
async function Q() {
  try {
    const e = await p.readdir(h), n = Date.now(), i = 1 * 24 * 60 * 60 * 1e3;
    for (const v of e) {
      const T = t.join(h, v), o = await p.stat(T);
      n - o.mtimeMs > i && (await p.unlink(T), console.log(`Deleted old recording: ${v}`));
    }
  } catch (e) {
    console.error("Failed to cleanup old recordings:", e);
  }
}
async function X() {
  try {
    await p.mkdir(h, { recursive: !0 }), console.log("Recordings directory ready:", h);
  } catch (e) {
    console.error("Failed to create recordings directory:", e);
  }
}
process.env.APP_ROOT = t.join(K, "..");
const Y = process.env.VITE_DEV_SERVER_URL, ie = t.join(process.env.APP_ROOT, "dist-electron"), j = t.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = Y ? t.join(process.env.APP_ROOT, "public") : j;
let l = null, k = null, g = null, D = "";
function F() {
  l = N();
}
function Z() {
  const e = t.join(process.env.VITE_PUBLIC || j, "rec-button.png");
  let n = L.createFromPath(e);
  n = n.resize({ width: 24, height: 24, quality: "best" }), g = new U(n), M();
}
function M() {
  if (!g) return;
  const e = [
    {
      label: "Stop Recording",
      click: () => {
        l && !l.isDestroyed() && l.webContents.send("stop-recording-from-tray");
      }
    }
  ], n = A.buildFromTemplate(e);
  g.setContextMenu(n), g.setToolTip(`Recording: ${D}`);
}
function ee() {
  l && (l.close(), l = null), l = H();
}
function te() {
  return k = z(), k.on("closed", () => {
    k = null;
  }), k;
}
d.on("window-all-closed", () => {
  process.platform !== "darwin" && (I(), d.quit(), l = null);
});
d.on("activate", () => {
  E.getAllWindows().length === 0 && F();
});
d.on("before-quit", async (e) => {
  e.preventDefault(), I(), await Q(), d.exit(0);
});
d.whenReady().then(async () => {
  await X(), J(
    ee,
    te,
    () => l,
    () => k,
    (e, n) => {
      D = n, e ? (g || Z(), M(), l && l.minimize()) : (g && (g.destroy(), g = null), l && l.restore());
    }
  ), F();
});
export {
  ie as MAIN_DIST,
  h as RECORDINGS_DIR,
  j as RENDERER_DIST,
  Y as VITE_DEV_SERVER_URL
};
