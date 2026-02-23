const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const CAMERA_USAGE = "Velocity needs camera access for camera preview and camera recording.";
const MICROPHONE_USAGE = "Velocity needs microphone access for voice recording.";
const SCREEN_RECORDING_USAGE = "Velocity needs screen recording access to capture your screen.";

function setPlistKey(plistPath, key, value) {
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} "${value.replace(/"/g, '\\"')}"`, plistPath], {
    stdio: "ignore",
  });
}

function addPlistKey(plistPath, key, value) {
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string "${value.replace(/"/g, '\\"')}"`, plistPath], {
    stdio: "ignore",
  });
}

function upsertStringKey(plistPath, key, value) {
  try {
    setPlistKey(plistPath, key, value);
  } catch {
    addPlistKey(plistPath, key, value);
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const plistTargets = [
    path.join(appPath, "Contents", "Info.plist"),
    path.join(appPath, "Contents", "Frameworks", `${context.packager.appInfo.productFilename} Helper.app`, "Contents", "Info.plist"),
    path.join(appPath, "Contents", "Frameworks", `${context.packager.appInfo.productFilename} Helper (Renderer).app`, "Contents", "Info.plist"),
    path.join(appPath, "Contents", "Frameworks", `${context.packager.appInfo.productFilename} Helper (GPU).app`, "Contents", "Info.plist"),
    path.join(appPath, "Contents", "Frameworks", `${context.packager.appInfo.productFilename} Helper (Plugin).app`, "Contents", "Info.plist"),
  ];

  for (const plistPath of plistTargets) {
    if (!fs.existsSync(plistPath)) continue;
    upsertStringKey(plistPath, "NSCameraUsageDescription", CAMERA_USAGE);
    upsertStringKey(plistPath, "NSMicrophoneUsageDescription", MICROPHONE_USAGE);
    upsertStringKey(plistPath, "NSScreenCaptureDescription", SCREEN_RECORDING_USAGE);
  }

  // Sign the native-capture-sidecar with entitlements so it can request screen recording permission
  const sidecarPath = path.join(appPath, "Contents", "Resources", "native-capture", "darwin", "native-capture-sidecar");
  const entitlementsPath = path.join(__dirname, "..", "build", "entitlements.mac.plist");
  if (fs.existsSync(sidecarPath)) {
    try {
      execFileSync("codesign", ["--force", "--sign", "-", "--entitlements", entitlementsPath, sidecarPath]);
      console.log("Signed native-capture-sidecar with entitlements");
    } catch (err) {
      console.warn("Warning: Failed to sign native-capture-sidecar:", err.message);
    }
  }

  // Also sign ffmpeg if present
  const ffmpegPath = path.join(appPath, "Contents", "Resources", "native-capture", "darwin", "ffmpeg");
  if (fs.existsSync(ffmpegPath)) {
    try {
      execFileSync("codesign", ["--force", "--sign", "-", ffmpegPath]);
      console.log("Signed ffmpeg binary");
    } catch (err) {
      console.warn("Warning: Failed to sign ffmpeg:", err.message);
    }
  }
};
