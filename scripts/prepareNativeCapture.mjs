import { existsSync, mkdirSync, statSync, copyFileSync, chmodSync, rmSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const sidecarDir = path.join(root, "native-capture-sidecar");
const strictMode = process.argv.includes("--strict");
const forceBuild = process.argv.includes("--force");
const platform = process.platform;

if (platform !== "win32" && platform !== "darwin") {
  process.exit(0);
}

const sidecarFileName = platform === "win32" ? "native-capture-sidecar.exe" : "native-capture-sidecar";
const ffmpegFileName = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
const targetSidecar = path.join(sidecarDir, "target", "release", sidecarFileName);
const binDir = path.join(sidecarDir, "bin", platform);
const binSidecar = path.join(binDir, sidecarFileName);
const binFfmpeg = path.join(binDir, ffmpegFileName);

const rustSourceDir = path.join(sidecarDir, "src");
const rustManifest = path.join(sidecarDir, "Cargo.toml");
const rustLock = path.join(sidecarDir, "Cargo.lock");
const macSwiftSource = path.join(sidecarDir, "macos", "NativeCaptureSidecar.swift");
const swiftModuleCache = path.join(root, ".cache", "swift-module-cache");

mkdirSync(path.dirname(targetSidecar), { recursive: true });
mkdirSync(binDir, { recursive: true });
mkdirSync(swiftModuleCache, { recursive: true });

if (platform === "win32") {
  if (shouldBuildSidecar(targetSidecar, [rustSourceDir, rustManifest, rustLock])) {
    const cargo = spawnSync("cargo", ["build", "--manifest-path", path.join("native-capture-sidecar", "Cargo.toml"), "--release"], {
      cwd: root,
      stdio: "inherit",
      shell: true,
    });

    if (cargo.status !== 0) {
      const message = "[native-capture] Windows sidecar build failed.";
      if (strictMode) {
        console.error(`${message} Failing because --strict is enabled.`);
        process.exit(1);
      }
      console.warn(`${message} App will fall back to legacy recorder.`);
      process.exit(0);
    }
  }
} else {
  if (shouldBuildSidecar(targetSidecar, [macSwiftSource])) {
    const swift = spawnSync("xcrun", [
      "swiftc",
      macSwiftSource,
      "-O",
      "-module-cache-path", swiftModuleCache,
      "-framework", "ScreenCaptureKit",
      "-framework", "AVFoundation",
      "-framework", "CoreMedia",
      "-framework", "CoreVideo",
      "-framework", "AppKit",
      "-framework", "ApplicationServices",
      "-o", targetSidecar,
    ], {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });

    if (swift.status !== 0) {
      const message = "[native-capture] macOS ScreenCaptureKit sidecar build failed.";
      if (strictMode) {
        console.error(`${message} Failing because --strict is enabled.`);
        process.exit(1);
      }
      console.warn(`${message} App will fall back to legacy recorder.`);
      process.exit(0);
    }
  }
}

if (existsSync(targetSidecar)) {
  copyFileSync(targetSidecar, binSidecar);
  ensureExecutableIfNeeded(binSidecar, platform);
}

if (platform === "win32") {
  const bundled = resolveBundledFfmpegPath();
  if (bundled && existsSync(bundled.path)) {
    copyFileSync(bundled.path, binFfmpeg);
    console.info(`[native-capture] Using bundled ffmpeg from ${bundled.source}: ${bundled.path}`);
  }

  if (!existsSync(binFfmpeg)) {
    const probe = spawnSync("where", ["ffmpeg"], { cwd: root, encoding: "utf8", shell: true });
    if (probe.status === 0 && probe.stdout) {
      const first = probe.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first && existsSync(first)) {
        copyFileSync(first, binFfmpeg);
        console.info(`[native-capture] Using ffmpeg from PATH: ${first}`);
      }
    }
  }

  if (!existsSync(binFfmpeg)) {
    const message = "[native-capture] ffmpeg.exe not available from bundled provider or PATH.";
    if (strictMode) {
      console.error(`${message} Failing because --strict is enabled.`);
      process.exit(1);
    }
    console.warn(`${message} Native capture may fall back to legacy.`);
  }
} else {
  const bundled = resolveBundledFfmpegPath();
  if (bundled && existsSync(bundled.path)) {
    copyFileSync(bundled.path, binFfmpeg);
    ensureExecutableIfNeeded(binFfmpeg, platform);
    console.info(`[native-capture] Using bundled ffmpeg from ${bundled.source}: ${bundled.path}`);
  }

  if (!existsSync(binFfmpeg)) {
    const probe = spawnSync("which", ["ffmpeg"], { cwd: root, encoding: "utf8", shell: false });
    if (probe.status === 0 && probe.stdout) {
      const first = probe.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first && existsSync(first)) {
        copyFileSync(first, binFfmpeg);
        ensureExecutableIfNeeded(binFfmpeg, platform);
        console.info(`[native-capture] Using ffmpeg from PATH: ${first}`);
      }
    }
  }

  if (!existsSync(binFfmpeg)) {
    const message = "[native-capture] ffmpeg not available from bundled provider or PATH on macOS.";
    if (strictMode) {
      console.error(`${message} Failing because --strict is enabled.`);
      process.exit(1);
    }
    console.warn(`${message} Native capture microphone muxing may be unavailable.`);
    rmSync(binFfmpeg, { force: true });
  }
}

function shouldBuildSidecar(targetExe, sourceEntries) {
  if (forceBuild) return true;
  const entries = Array.isArray(sourceEntries) ? sourceEntries : [sourceEntries];
  if (!entries.some((entry) => existsSync(entry))) return false;
  if (!existsSync(targetExe)) return true;
  try {
    const sourceTime = getLatestMtime(entries);
    const targetTime = statSync(targetExe).mtimeMs;
    return sourceTime > targetTime;
  } catch {
    return true;
  }
}

function getLatestMtime(entries) {
  let latest = 0;
  for (const entry of entries) {
    if (!existsSync(entry)) continue;
    const stats = statSync(entry);
    if (stats.isDirectory()) {
      for (const child of readdirSync(entry, { withFileTypes: true })) {
        const childPath = path.join(entry, child.name);
        const childMtime = getLatestMtime([childPath]);
        if (childMtime > latest) latest = childMtime;
      }
    } else if (stats.mtimeMs > latest) {
      latest = stats.mtimeMs;
    }
  }
  return latest;
}

function ensureExecutableIfNeeded(filePath, currentPlatform) {
  if (currentPlatform !== "darwin") return;
  try {
    chmodSync(filePath, 0o755);
  } catch {
    // Best effort; packaging may still preserve executable bit from source.
  }
}

function resolveBundledFfmpegPath() {
  try {
    const require = createRequire(import.meta.url);
    const staticPath = require("ffmpeg-static");
    if (typeof staticPath === "string" && staticPath.length > 0) {
      return { path: staticPath, source: "ffmpeg-static" };
    }
  } catch {
    // Try the legacy installer package as fallback.
  }
  try {
    const require = createRequire(import.meta.url);
    const installer = require("@ffmpeg-installer/ffmpeg");
    if (typeof installer?.path === "string" && installer.path.length > 0) {
      return { path: installer.path, source: "@ffmpeg-installer/ffmpeg" };
    }
  } catch {
    return null;
  }
  return null;
}
