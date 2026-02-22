"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  hudOverlayHide: () => {
    electron.ipcRenderer.send("hud-overlay-hide");
  },
  hudOverlayClose: () => {
    electron.ipcRenderer.send("hud-overlay-close");
  },
  getAssetBasePath: async () => {
    return await electron.ipcRenderer.invoke("get-asset-base-path");
  },
  getSources: async (opts) => {
    return await electron.ipcRenderer.invoke("get-sources", opts);
  },
  switchToEditor: () => {
    return electron.ipcRenderer.invoke("switch-to-editor");
  },
  startNewRecordingSession: (payload) => {
    return electron.ipcRenderer.invoke("start-new-recording-session", payload);
  },
  openSourceSelector: () => {
    return electron.ipcRenderer.invoke("open-source-selector");
  },
  openCameraPreviewWindow: (deviceId) => {
    return electron.ipcRenderer.invoke("open-camera-preview-window", deviceId);
  },
  closeCameraPreviewWindow: () => {
    return electron.ipcRenderer.invoke("close-camera-preview-window");
  },
  setHudOverlayWidth: (width) => {
    return electron.ipcRenderer.invoke("set-hud-overlay-width", width);
  },
  setHudOverlayHeight: (height, anchor) => {
    return electron.ipcRenderer.invoke("set-hud-overlay-height", height, anchor);
  },
  getHudOverlayPopoverSide: () => {
    return electron.ipcRenderer.invoke("get-hud-overlay-popover-side");
  },
  getHudSettings: () => {
    return electron.ipcRenderer.invoke("get-hud-settings");
  },
  setHudEncoderOptions: (options) => {
    return electron.ipcRenderer.invoke("set-hud-encoder-options", options);
  },
  preloadHudPopoverWindows: () => {
    return electron.ipcRenderer.invoke("preload-hud-popover-windows");
  },
  updateHudSettings: (partial) => {
    return electron.ipcRenderer.invoke("update-hud-settings", partial);
  },
  getNativeCaptureEncoderOptions: () => {
    return electron.ipcRenderer.invoke("native-capture-encoder-options");
  },
  openHudPopoverWindow: (payload) => {
    return electron.ipcRenderer.invoke("open-hud-popover-window", payload);
  },
  toggleHudPopoverWindow: (payload) => {
    return electron.ipcRenderer.invoke("toggle-hud-popover-window", payload);
  },
  closeHudPopoverWindow: (kind) => {
    return electron.ipcRenderer.invoke("close-hud-popover-window", kind);
  },
  closeCurrentHudPopoverWindow: () => {
    return electron.ipcRenderer.invoke("close-current-hud-popover-window");
  },
  onHudSettingsUpdated: (callback) => {
    const listener = (_event, settings) => callback(settings);
    electron.ipcRenderer.on("hud-settings-updated", listener);
    return () => electron.ipcRenderer.removeListener("hud-settings-updated", listener);
  },
  selectSource: (source) => {
    return electron.ipcRenderer.invoke("select-source", source);
  },
  getSelectedSource: () => {
    return electron.ipcRenderer.invoke("get-selected-source");
  },
  storeRecordedVideo: (videoData, fileName) => {
    return electron.ipcRenderer.invoke("store-recorded-video", videoData, fileName);
  },
  storeRecordingSession: (payload) => {
    return electron.ipcRenderer.invoke("store-recording-session", payload);
  },
  storeNativeRecordingSession: (payload) => {
    return electron.ipcRenderer.invoke("store-native-recording-session", payload);
  },
  startInputTracking: (payload) => {
    return electron.ipcRenderer.invoke("start-input-tracking", payload);
  },
  stopInputTracking: () => {
    return electron.ipcRenderer.invoke("stop-input-tracking");
  },
  nativeCaptureStart: (payload) => {
    return electron.ipcRenderer.invoke("native-capture-start", payload);
  },
  nativeCaptureStop: (payload) => {
    return electron.ipcRenderer.invoke("native-capture-stop", payload);
  },
  nativeCaptureStatus: (sessionId) => {
    return electron.ipcRenderer.invoke("native-capture-status", sessionId);
  },
  getRecordedVideoPath: () => {
    return electron.ipcRenderer.invoke("get-recorded-video-path");
  },
  setRecordingState: (recording) => {
    return electron.ipcRenderer.invoke("set-recording-state", recording);
  },
  onStopRecordingFromTray: (callback) => {
    const listener = () => callback();
    electron.ipcRenderer.on("stop-recording-from-tray", listener);
    return () => electron.ipcRenderer.removeListener("stop-recording-from-tray", listener);
  },
  openExternalUrl: (url) => {
    return electron.ipcRenderer.invoke("open-external-url", url);
  },
  saveExportedVideo: (videoData, fileName) => {
    return electron.ipcRenderer.invoke("save-exported-video", videoData, fileName);
  },
  getDefaultExportDirectory: () => {
    return electron.ipcRenderer.invoke("get-default-export-directory");
  },
  chooseExportDirectory: (currentPath) => {
    return electron.ipcRenderer.invoke("choose-export-directory", currentPath);
  },
  saveExportedVideoToDirectory: (videoData, fileName, directoryPath) => {
    return electron.ipcRenderer.invoke("save-exported-video-to-directory", videoData, fileName, directoryPath);
  },
  openDirectory: (directoryPath) => {
    return electron.ipcRenderer.invoke("open-directory", directoryPath);
  },
  openVideoFilePicker: () => {
    return electron.ipcRenderer.invoke("open-video-file-picker");
  },
  setCurrentVideoPath: (path) => {
    return electron.ipcRenderer.invoke("set-current-video-path", path);
  },
  getCurrentVideoPath: () => {
    return electron.ipcRenderer.invoke("get-current-video-path");
  },
  setCurrentRecordingSession: (session) => {
    return electron.ipcRenderer.invoke("set-current-recording-session", session);
  },
  getCurrentRecordingSession: () => {
    return electron.ipcRenderer.invoke("get-current-recording-session");
  },
  clearCurrentVideoPath: () => {
    return electron.ipcRenderer.invoke("clear-current-video-path");
  },
  getPlatform: () => {
    return electron.ipcRenderer.invoke("get-platform");
  }
});
