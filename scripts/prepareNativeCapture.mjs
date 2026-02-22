import { existsSync, mkdirSync, statSync, copyFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const sidecarDir = path.join(root, "native-capture-sidecar");
const sourceMain = path.join(sidecarDir, "src", "main.rs");
const strictMode = process.argv.includes("--strict");
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

mkdirSync(binDir, { recursive: true });

if (shouldBuildSidecar(targetSidecar, sourceMain)) {
  const cargo = spawnSync("cargo", ["build", "--manifest-path", path.join("native-capture-sidecar", "Cargo.toml"), "--release"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });

  if (cargo.status !== 0) {
    const message = `[native-capture] Sidecar build failed for ${platform}.`;
    if (strictMode) {
      console.error(`${message} Failing because --strict is enabled.`);
      process.exit(1);
    }
    console.warn(`${message} App will fall back to legacy recorder.`);
    process.exit(0);
  }
}

if (existsSync(targetSidecar)) {
  copyFileSync(targetSidecar, binSidecar);
  ensureExecutableIfNeeded(binSidecar, platform);
}

const bundled = resolveBundledFfmpegPath();
if (bundled && existsSync(bundled)) {
  copyFileSync(bundled, binFfmpeg);
  ensureExecutableIfNeeded(binFfmpeg, platform);
  console.info(`[native-capture] Using bundled ffmpeg from @ffmpeg-installer/ffmpeg: ${bundled}`);
}

if (!existsSync(binFfmpeg)) {
  const command = platform === "win32" ? "where" : "which";
  const probe = spawnSync(command, ["ffmpeg"], { cwd: root, encoding: "utf8", shell: true });
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
  const message = platform === "win32"
    ? "[native-capture] ffmpeg.exe not available from @ffmpeg-installer/ffmpeg or PATH."
    : "[native-capture] ffmpeg not available from @ffmpeg-installer/ffmpeg or PATH.";

  if (strictMode) {
    console.error(`${message} Failing because --strict is enabled.`);
    process.exit(1);
  }

  console.warn(`${message} Native capture may fall back to legacy.`);
}

function shouldBuildSidecar(targetExe, sourceFile) {
  if (!existsSync(targetExe)) return true;
  if (!existsSync(sourceFile)) return false;
  try {
    const sourceTime = statSync(sourceFile).mtimeMs;
    const targetTime = statSync(targetExe).mtimeMs;
    return sourceTime > targetTime;
  } catch {
    return true;
  }
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
    const installer = require("@ffmpeg-installer/ffmpeg");
    return typeof installer?.path === "string" ? installer.path : null;
  } catch {
    return null;
  }
}
