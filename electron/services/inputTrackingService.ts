import { createRequire } from "node:module";
import { screen } from "electron";
import type {
  InputSourceBounds,
  InputSourceKind,
  InputTelemetryEvent,
  InputTelemetryFileV1,
  InputTelemetryStats,
  KeyCategory,
  StartInputTrackingPayload,
} from "@/types/inputTelemetry";

interface SelectedSourceLike {
  id?: string;
  display_id?: string;
}

interface HookCallbacks {
  onMouseDown: (event: { x?: number; y?: number; button?: number }) => void;
  onMouseUp: (event: { x?: number; y?: number; button?: number }) => void;
  onMouseMove: (event: { x?: number; y?: number }) => void;
  onWheel: (event: { x?: number; y?: number; amount?: number; rotation?: number; deltaX?: number; deltaY?: number }) => void;
  onKeyDown: (event: { keycode?: number; rawcode?: number; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }) => void;
}

interface NativeHookInstance {
  on: (eventName: string, cb: (event: any) => void) => void;
  off?: (eventName: string, cb: (event: any) => void) => void;
  removeListener?: (eventName: string, cb: (event: any) => void) => void;
  removeAllListeners?: (eventName?: string) => void;
  start: () => void;
  stop: () => void;
}

class NativeHookProvider {
  private hook: NativeHookInstance | null = null;
  private handlers: Array<{ name: string; cb: (event: any) => void }> = [];

  start(callbacks: HookCallbacks): { success: boolean; message?: string } {
    const require = createRequire(import.meta.url);
    let mod: any;
    try {
      mod = require("uiohook-napi");
    } catch {
      return { success: false, message: "uiohook-napi is not installed" };
    }

    const hook = (mod?.uIOhook ?? mod?.default ?? mod) as NativeHookInstance | undefined;
    if (!hook || typeof hook.on !== "function" || typeof hook.start !== "function" || typeof hook.stop !== "function") {
      return { success: false, message: "uiohook-napi loaded, but API shape is unsupported" };
    }

    this.hook = hook;
    this.handlers = [
      { name: "mousedown", cb: callbacks.onMouseDown },
      { name: "mouseup", cb: callbacks.onMouseUp },
      { name: "mousemove", cb: callbacks.onMouseMove },
      { name: "wheel", cb: callbacks.onWheel },
      { name: "keydown", cb: callbacks.onKeyDown },
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
    if (!this.hook) {
      return;
    }

    try {
      for (const handler of this.handlers) {
        if (typeof this.hook?.off === "function") {
          this.hook.off(handler.name, handler.cb);
        } else if (typeof this.hook?.removeListener === "function") {
          this.hook.removeListener(handler.name, handler.cb);
        }
      }
      this.hook.stop();
      if (typeof this.hook.removeAllListeners === "function") {
        this.hook.removeAllListeners();
      }
    } catch {
      // Best-effort cleanup.
    } finally {
      this.handlers = [];
      this.hook = null;
    }
  }
}

function createEmptyStats(): InputTelemetryStats {
  return {
    totalEvents: 0,
    mouseDownCount: 0,
    mouseUpCount: 0,
    mouseMoveCount: 0,
    wheelCount: 0,
    keyDownCount: 0,
  };
}

function incrementStats(stats: InputTelemetryStats, event: InputTelemetryEvent) {
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

function detectSourceKind(sourceId?: string): InputSourceKind {
  if (!sourceId) return "unknown";
  if (sourceId.startsWith("screen:")) return "screen";
  if (sourceId.startsWith("window:")) return "window";
  return "unknown";
}

function resolveSourceBounds(sourceKind: InputSourceKind, sourceDisplayId?: string): InputSourceBounds | undefined {
  if (sourceKind !== "screen") {
    return undefined;
  }

  const displays = screen.getAllDisplays();
  const byDisplayId = displays.find((display) => String(display.id) === sourceDisplayId);
  const targetDisplay = byDisplayId ?? screen.getPrimaryDisplay();
  const { x, y, width, height } = targetDisplay.bounds;
  return { x, y, width, height };
}

function categorizeKey(raw: { keycode?: number; rawcode?: number; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }): KeyCategory {
  if (raw.ctrlKey || raw.altKey || raw.metaKey) return "shortcut";

  const keycode = raw.keycode ?? raw.rawcode ?? -1;
  if (keycode === 14 || keycode === 8) return "backspace";
  if (keycode === 15 || keycode === 9) return "tab";
  if (keycode === 28 || keycode === 13) return "enter";
  if ([29, 42, 54, 56, 3613, 3675].includes(keycode)) return "modifier";

  if ((keycode >= 2 && keycode <= 13) || (keycode >= 16 && keycode <= 27) || (keycode >= 30 && keycode <= 53)) {
    return "printable";
  }

  return "other";
}

export class InputTrackingService {
  private provider = new NativeHookProvider();
  private events: InputTelemetryEvent[] = [];
  private stats: InputTelemetryStats = createEmptyStats();
  private currentSession: {
    sessionId: string;
    startedAtMs: number;
    sourceKind: InputSourceKind;
    sourceId?: string;
    sourceDisplayId?: string;
    sourceBounds?: InputSourceBounds;
  } | null = null;
  private lastMoveTs = 0;
  private lastMoveX = -1;
  private lastMoveY = -1;

  start(payload: StartInputTrackingPayload, selectedSource?: SelectedSourceLike): { success: boolean; message?: string } {
    this.stop();

    const sourceId = payload.sourceId ?? selectedSource?.id;
    const sourceDisplayId = payload.sourceDisplayId ?? selectedSource?.display_id;
    const sourceKind = detectSourceKind(sourceId);
    const sourceBounds = resolveSourceBounds(sourceKind, sourceDisplayId);

    this.currentSession = {
      sessionId: payload.sessionId,
      startedAtMs: payload.startedAtMs,
      sourceKind,
      sourceId,
      sourceDisplayId,
      sourceBounds,
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
        });
      },
      onMouseUp: (event) => {
        this.pushEvent({
          type: "mouseUp",
          ts: Date.now(),
          x: Number(event.x ?? 0),
          y: Number(event.y ?? 0),
          button: Number(event.button ?? 0),
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
        });
      },
      onKeyDown: (event) => {
        this.pushEvent({
          type: "keyDownCategory",
          ts: Date.now(),
          category: categorizeKey(event),
        });
      },
    });

    if (!startResult.success) {
      this.currentSession = null;
      this.events = [];
      this.stats = createEmptyStats();
      return startResult;
    }

    return startResult;
  }

  stop(): InputTelemetryFileV1 | null {
    this.provider.stop();
    if (!this.currentSession) {
      return null;
    }

    const telemetry: InputTelemetryFileV1 = {
      version: 1,
      sessionId: this.currentSession.sessionId,
      startedAtMs: this.currentSession.startedAtMs,
      sourceKind: this.currentSession.sourceKind,
      sourceId: this.currentSession.sourceId,
      sourceDisplayId: this.currentSession.sourceDisplayId,
      sourceBounds: this.currentSession.sourceBounds,
      events: this.events,
      stats: this.stats,
    };

    this.currentSession = null;
    this.events = [];
    this.stats = createEmptyStats();

    return telemetry;
  }

  private pushEvent(event: InputTelemetryEvent) {
    this.events.push(event);
    incrementStats(this.stats, event);
  }
}
