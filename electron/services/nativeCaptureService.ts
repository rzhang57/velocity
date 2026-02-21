import { app } from "electron";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {
  NativeCaptureSessionResult,
  NativeCaptureStartPayload,
  NativeCaptureStatus,
  NativeCaptureStatusResult,
  NativeCaptureStopPayload,
} from "@/types/nativeCapture";

type SidecarRequest =
  | { id: string; cmd: "init"; payload: { platform: NodeJS.Platform } }
  | { id: string; cmd: "get_encoder_options"; payload: { platform: NodeJS.Platform; ffmpegPath?: string } }
  | { id: string; cmd: "start_capture"; payload: NativeCaptureStartPayload }
  | { id: string; cmd: "stop_capture"; payload: NativeCaptureStopPayload };

type SidecarResponse = {
  id?: string;
  event?: string;
  ok?: boolean;
  payload?: Record<string, unknown>;
  error?: string;
};

type Pending = {
  resolve: (value: SidecarResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class NativeCaptureService {
  private process: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private pending = new Map<string, Pending>();
  private status: NativeCaptureStatus = "idle";
  private statusMessage = "";
  private currentSessionId: string | null = null;
  private startedAtMs: number | null = null;
  private sequence = 0;

  async start(payload: NativeCaptureStartPayload): Promise<{ success: boolean; message?: string }> {
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
        payload,
      }, 10_000);
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

  async stop(payload: NativeCaptureStopPayload): Promise<{ success: boolean; result?: NativeCaptureSessionResult; message?: string }> {
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
        payload,
      }, 20_000);
      if (!response.ok) {
        this.status = "error";
        this.statusMessage = response.error || "Failed to stop native capture";
        return { success: false, message: this.statusMessage };
      }
      const outputPath = typeof response.payload?.outputPath === "string" ? response.payload.outputPath : "";
      if (!outputPath) {
        this.status = "error";
        this.statusMessage = "Native capture did not return output path";
        return { success: false, message: this.statusMessage };
      }
      const stats = fs.existsSync(outputPath) ? fs.statSync(outputPath) : undefined;
      const result: NativeCaptureSessionResult = {
        outputPath,
        durationMs: numberOrUndefined(response.payload?.durationMs),
        width: numberOrUndefined(response.payload?.width),
        height: numberOrUndefined(response.payload?.height),
        fpsActual: numberOrUndefined(response.payload?.fpsActual),
        bytes: numberOrUndefined(response.payload?.bytes) ?? stats?.size,
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

  async getEncoderOptions(ffmpegPath?: string): Promise<{ success: boolean; options: Array<{ encoder: string; label: string; hardware: string }>; message?: string }> {
    const ffmpegFallback = this.getEncoderOptionsFromFfmpeg(ffmpegPath);

    const boot = await this.ensureProcess();
    if (!boot.success) {
      return {
        success: ffmpegFallback.success,
        options: ffmpegFallback.options,
        message: boot.message || ffmpegFallback.message,
      };
    }

    try {
      const response = await this.sendRequest({
        id: this.nextId("get-encoder-options"),
        cmd: "get_encoder_options",
        payload: {
          platform: process.platform,
          ...(ffmpegPath ? { ffmpegPath } : {}),
        },
      }, 5_000);

      if (!response.ok) {
        if (ffmpegFallback.options.length > 1) {
          return {
            success: true,
            options: ffmpegFallback.options,
            message: response.error || ffmpegFallback.message || "Sidecar encoder options unavailable, used FFmpeg probe fallback",
          };
        }
        return {
          success: false,
          options: ffmpegFallback.options,
          message: response.error || "Failed to fetch encoder options",
        };
      }

      const rawOptions = Array.isArray(response.payload?.options) ? response.payload.options : [];
      const options = rawOptions
        .filter((item): item is { codec: string; label: string; hardware: string } => (
          Boolean(item)
          && typeof item === "object"
          && typeof (item as { codec?: unknown }).codec === "string"
          && typeof (item as { label?: unknown }).label === "string"
          && typeof (item as { hardware?: unknown }).hardware === "string"
        ))
        .map((item) => ({
          encoder: item.codec,
          label: item.label,
          hardware: item.hardware,
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
          message: error instanceof Error ? error.message : ffmpegFallback.message,
        };
      }
      return {
        success: false,
        options: ffmpegFallback.options,
        message: error instanceof Error ? error.message : "Failed to fetch encoder options",
      };
    }
  }

  private getEncoderOptionsFromFfmpeg(ffmpegPath?: string): { success: boolean; options: Array<{ encoder: string; label: string; hardware: string }>; message?: string } {
    const options: Array<{ encoder: string; label: string; hardware: string }> = [
      { encoder: "h264_libx264", label: "x264 (CPU)", hardware: "cpu" },
    ];

    const probePath = ffmpegPath || (process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    const output = spawnSync(probePath, ["-hide_banner", "-encoders"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4_000,
    });

    const text = `${output.stdout || ""}\n${output.stderr || ""}`;
    if (output.error || !text.trim()) {
      return {
        success: false,
        options,
        message: output.error instanceof Error ? output.error.message : "Unable to probe FFmpeg encoders",
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

  getStatus(sessionId?: string): NativeCaptureStatusResult {
    return {
      status: this.status,
      message: this.statusMessage || undefined,
      sessionId: sessionId || this.currentSessionId || undefined,
      startedAtMs: this.startedAtMs || undefined,
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

  private async ensureProcess(): Promise<{ success: boolean; message?: string }> {
    if (this.process && !this.process.killed) {
      return { success: true };
    }

    const executable = resolveSidecarExecutablePath();
    if (!executable) {
      return { success: false, message: "Native capture sidecar not found. Build sidecar binaries first." };
    }

    const child = spawn(executable, [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.process = child;
    this.buffer = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.consumeStdout(chunk);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", () => {});
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
        payload: { platform: process.platform },
      }, 5_000);
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

  private consumeStdout(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: SidecarResponse;
      try {
        parsed = JSON.parse(trimmed) as SidecarResponse;
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

  private async sendRequest(request: SidecarRequest, timeoutMs: number): Promise<SidecarResponse> {
    if (!this.process || this.process.killed) {
      throw new Error("Native capture process is not running");
    }
    const serialized = `${JSON.stringify(request)}\n`;
    const promise = new Promise<SidecarResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`Native capture request timed out (${request.cmd})`));
      }, timeoutMs);
      this.pending.set(request.id, { resolve, reject, timeout });
    });
    this.process.stdin.write(serialized);
    return await promise;
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${Date.now()}-${this.sequence}`;
  }
}

function resolveSidecarExecutablePath(): string | null {
  const fileName = process.platform === "win32"
    ? "native-capture-sidecar.exe"
    : "native-capture-sidecar";

  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "native-capture", process.platform, fileName),
        path.join(process.resourcesPath, "native-capture", fileName),
      ]
    : [
        path.join(app.getAppPath(), "native-capture-sidecar", "bin", process.platform, fileName),
        path.join(app.getAppPath(), "native-capture-sidecar", "target", "debug", fileName),
        path.join(app.getAppPath(), "native-capture-sidecar", "target", "release", fileName),
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
