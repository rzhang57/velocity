/**
 * Re-signs the Electron.app binary in node_modules with the app's entitlements.
 * This allows macOS to show the privacy permission prompts (camera, microphone)
 * when running in dev mode via `npm run dev`.
 *
 * Without this, the dev Electron binary has no entitlements for camera/mic,
 * so macOS won't recognize it as an app that can request those permissions.
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "darwin") {
  process.exit(0);
}

const electronAppPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "electron",
  "dist",
  "Electron.app"
);

if (!fs.existsSync(electronAppPath)) {
  console.log("Electron.app not found, skipping dev signing");
  process.exit(0);
}

const entitlementsPath = path.join(__dirname, "..", "build", "entitlements.mac.plist");
if (!fs.existsSync(entitlementsPath)) {
  console.error("Entitlements file not found at", entitlementsPath);
  process.exit(1);
}

const CAMERA_USAGE = "Velocity needs camera access for camera preview and camera recording.";
const MICROPHONE_USAGE = "Velocity needs microphone access for voice recording.";
const SCREEN_RECORDING_USAGE = "Velocity needs screen recording access to capture your screen.";

// Patch Info.plist files with usage descriptions
const plistTargets = [
  path.join(electronAppPath, "Contents", "Info.plist"),
  path.join(electronAppPath, "Contents", "Frameworks", "Electron Helper.app", "Contents", "Info.plist"),
  path.join(electronAppPath, "Contents", "Frameworks", "Electron Helper (Renderer).app", "Contents", "Info.plist"),
  path.join(electronAppPath, "Contents", "Frameworks", "Electron Helper (GPU).app", "Contents", "Info.plist"),
  path.join(electronAppPath, "Contents", "Frameworks", "Electron Helper (Plugin).app", "Contents", "Info.plist"),
];

function upsertPlistKey(plistPath, key, value) {
  const escaped = value.replace(/"/g, '\\"');
  try {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} "${escaped}"`, plistPath], { stdio: "ignore" });
  } catch {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string "${escaped}"`, plistPath], { stdio: "ignore" });
  }
}

for (const plistPath of plistTargets) {
  if (!fs.existsSync(plistPath)) continue;
  upsertPlistKey(plistPath, "NSCameraUsageDescription", CAMERA_USAGE);
  upsertPlistKey(plistPath, "NSMicrophoneUsageDescription", MICROPHONE_USAGE);
  upsertPlistKey(plistPath, "NSScreenCaptureDescription", SCREEN_RECORDING_USAGE);
}

// Sign helper apps first (inside-out signing order)
const inheritEntitlements = path.join(__dirname, "..", "build", "entitlements.mac.inherit.plist");
const frameworksPath = path.join(electronAppPath, "Contents", "Frameworks");

const helpers = [
  "Electron Helper.app",
  "Electron Helper (Renderer).app",
  "Electron Helper (GPU).app",
  "Electron Helper (Plugin).app",
];

for (const helper of helpers) {
  const helperPath = path.join(frameworksPath, helper);
  if (!fs.existsSync(helperPath)) continue;
  try {
    execFileSync("codesign", [
      "--force", "--deep", "--sign", "-",
      "--entitlements", inheritEntitlements,
      helperPath,
    ], { stdio: "inherit" });
  } catch (err) {
    console.warn(`Warning: Failed to sign ${helper}:`, err.message);
  }
}

// Sign the main Electron.app with full entitlements
try {
  execFileSync("codesign", [
    "--force", "--deep", "--sign", "-",
    "--entitlements", entitlementsPath,
    electronAppPath,
  ], { stdio: "inherit" });
  console.log("Signed dev Electron.app with entitlements for camera/microphone/screen recording");
} catch (err) {
  console.error("Failed to sign Electron.app:", err.message);
  process.exit(1);
}
