import { useEffect, useRef, useState, type CSSProperties } from "react";

export function CameraPreviewWindow() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deviceId = params.get("deviceId") || undefined;

    const start = async () => {
      try {
        const platform = await window.electronAPI.getPlatform().catch(() => "");
        const isMac = platform === "darwin";
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 60 },
          },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          if (isMac) {
            void videoRef.current.play().catch((playError) => {
              console.warn("Camera preview autoplay was blocked on macOS:", playError);
            });
          } else {
            await videoRef.current.play();
          }
        }
      } catch (err) {
        setError("Unable to access camera preview");
        console.error("Camera preview failed:", err);
      }
    };

    start();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  return (
    <div
      className="w-screen h-screen p-1 bg-transparent"
      style={{ WebkitAppRegion: 'drag' } as CSSProperties}
    >
      {error ? (
        <div className="w-full h-full flex items-center justify-center text-sm text-red-300 rounded-xl border border-white/20 bg-black/80">
          {error}
        </div>
      ) : (
        <video
          ref={videoRef}
          className="w-full h-full object-cover opacity-90 rounded-xl border border-white/20"
          muted
          playsInline
          autoPlay
        />
      )}
    </div>
  );
}
