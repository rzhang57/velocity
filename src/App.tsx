import { useEffect, useState } from "react";
import { LaunchWindow } from "./components/launch/LaunchWindow";
import { CameraPreviewWindow } from "./components/launch/CameraPreviewWindow";
import { HudPopoverWindow } from "./components/launch/HudPopoverWindow";
import { SourceSelector } from "./components/launch/SourceSelector";
import VideoEditor from "./components/video-editor/VideoEditor";
import { loadAllCustomFonts } from "./lib/customFonts";

export default function App() {
  const [windowType] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('windowType') || '';
  });

  useEffect(() => {
    if (windowType === 'hud-overlay' || windowType === 'source-selector' || windowType === 'camera-preview' || windowType === 'hud-popover') {
      document.body.style.background = 'transparent';
      document.documentElement.style.background = 'transparent';
      document.getElementById('root')?.style.setProperty('background', 'transparent');
      document.body.style.margin = '0';
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }

    // Load custom fonts on app initialization
    loadAllCustomFonts().catch((error) => {
      console.error('Failed to load custom fonts:', error);
    });
  }, [windowType]);

  switch (windowType) {
    case 'hud-overlay':
      return <LaunchWindow />;
    case 'source-selector':
      return <SourceSelector />;
    case 'camera-preview':
      return <CameraPreviewWindow />;
    case 'hud-popover':
      return <HudPopoverWindow />;
    case 'editor':
      return <VideoEditor />;
    default:
      return null;
  }
}
