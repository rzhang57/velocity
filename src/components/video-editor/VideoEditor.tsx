import { useEffect, useState } from "react";
import VideoEditorMac from "./VideoEditorMac";
import VideoEditorWindows from "./VideoEditorWindows";

type EditorVariant = "mac" | "windows";

const detectPlatformVariant = async (): Promise<EditorVariant> => {
  try {
    const platform = await window.electronAPI.getPlatform();
    return platform === "darwin" ? "mac" : "windows";
  } catch {
    if (typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform)) {
      return "mac";
    }
    return "windows";
  }
};

export default function VideoEditor() {
  const [variant, setVariant] = useState<EditorVariant>("windows");

  useEffect(() => {
    let mounted = true;

    detectPlatformVariant().then((nextVariant) => {
      if (mounted) {
        setVariant(nextVariant);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  if (variant === "mac") {
    return <VideoEditorMac />;
  }

  return <VideoEditorWindows />;
}
