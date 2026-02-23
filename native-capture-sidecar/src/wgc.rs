/// Windows Graphics Capture (WGC) backend for window recording.
///
/// WGC is the proper Windows 10+ API for capturing any window regardless of its renderer
/// (GDI or GPU-accelerated). It is the Windows equivalent of macOS ScreenCaptureKit.
///
/// Key properties:
/// - Works for Chrome, VS Code, games, and all other GPU-rendered apps
/// - `IsCursorCaptureEnabled(false)` hides the cursor from the video without touching
///   the user's visible system cursor
/// - Captures the DWMWA content area (no DWM shadow)
/// - Delivers frames via a Direct3D 11 texture that we CPU-readback and pipe to ffmpeg
///   as `rawvideo` (BGRA), which ffmpeg encodes to H.264 / HEVC.
#[cfg(target_os = "windows")]
pub mod inner {
    use std::io::Write;
    use std::process::{Child, Command, Stdio};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    };
    use std::thread::{self, JoinHandle};
    use std::time::{Duration, Instant};

    use windows::{
        core::Interface,
        Foundation::TypedEventHandler,
        Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem},
        Graphics::DirectX::DirectXPixelFormat,
        Graphics::SizeInt32,
        Win32::Foundation::HWND,
        Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE,
        Win32::Graphics::Direct3D11::{
            D3D11CreateDevice, D3D11_BIND_FLAG, D3D11_CPU_ACCESS_READ,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ, D3D11_SDK_VERSION,
            D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING, ID3D11Device, ID3D11DeviceContext,
            ID3D11Resource, ID3D11Texture2D,
        },
        Win32::Graphics::Dxgi::{IDXGIDevice, IDXGISurface},
        Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
        Win32::System::WinRT::Direct3D11::{
            CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
        },
        Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop,
    };

    type CaptureResult<T> = std::result::Result<T, String>;

    // ── Public types ──────────────────────────────────────────────────────────

    pub struct WgcCapture {
        pub width: u32,
        pub height: u32,
        pub output_path: String,
        started_at: Instant,
        stop_flag: Arc<AtomicBool>,
        thread: Option<JoinHandle<CaptureResult<()>>>,
    }

    pub struct CaptureBounds {
        pub x: i32,
        pub y: i32,
        pub width: u32,
        pub height: u32,
    }

    pub struct WgcResult {
        pub output_path: String,
        pub width: u32,
        pub height: u32,
        pub duration_ms: u64,
        pub bytes: u64,
    }

    // ── Entry point ───────────────────────────────────────────────────────────

    /// Parse the Win32 HWND value from a source ID like `"window:12345:0"`.
    pub fn hwnd_from_source_id(source_id: &str) -> Option<isize> {
        let after = source_id.strip_prefix("window:")?;
        let num_str = after.split(':').next()?;
        let val: isize = num_str.parse().ok()?;
        if val > 0 { Some(val) } else { None }
    }

    /// Start a WGC capture session for the given HWND.
    ///
    /// Returns a `WgcCapture` handle. Call `stop()` to finalise the recording.
    pub fn start(
        hwnd_val: isize,
        fps: u32,
        encoder: &str,
        bitrate: u32,
        ffmpeg_exe: &str,
        output_path: &str,
        hide_cursor: bool,
        encoder_args: Vec<String>,
    ) -> CaptureResult<WgcCapture> {
        eprintln!(
            "[native-capture][wgc] start hwnd=0x{:x} fps={} encoder={} bitrate={} hide_cursor={} output={}",
            hwnd_val as usize,
            fps,
            encoder,
            bitrate,
            hide_cursor,
            output_path
        );
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_thread = Arc::clone(&stop_flag);

        // One-shot channel to receive (width, height) once the WGC item is created.
        let (setup_tx, setup_rx) =
            std::sync::mpsc::channel::<CaptureResult<(u32, u32)>>();

        let encoder = encoder.to_string();
        let ffmpeg_exe = ffmpeg_exe.to_string();
        let output_path_str = output_path.to_string();

        let thread = thread::spawn(move || {
            wgc_thread(
                hwnd_val,
                fps,
                encoder,
                bitrate,
                ffmpeg_exe,
                output_path_str,
                hide_cursor,
                encoder_args,
                stop_flag_thread,
                setup_tx,
            )
        });

        // Wait for WGC setup to complete (timeout 8 s).
        let (width, height) = match setup_rx.recv_timeout(Duration::from_secs(8)) {
            Ok(Ok(dims)) => dims,
            Ok(Err(e)) => {
                // Thread reported an error; join to avoid leaking.
                let _ = thread.join();
                return Err(e);
            }
            Err(_) => {
                let _ = thread.join();
                return Err("WGC capture setup timed out".to_string());
            }
        };
        eprintln!(
            "[native-capture][wgc] setup complete hwnd=0x{:x} size={}x{}",
            hwnd_val as usize,
            width,
            height
        );

        Ok(WgcCapture {
            width,
            height,
            output_path: output_path.to_string(),
            started_at: Instant::now(),
            stop_flag,
            thread: Some(thread),
        })
    }

    /// Signal the capture thread to stop and wait for ffmpeg to finish.
    pub fn stop(mut capture: WgcCapture) -> CaptureResult<WgcResult> {
        eprintln!(
            "[native-capture][wgc] stop requested output={} size={}x{}",
            capture.output_path,
            capture.width,
            capture.height
        );
        capture.stop_flag.store(true, Ordering::SeqCst);
        if let Some(handle) = capture.thread.take() {
            match handle.join() {
                Ok(Ok(())) => {}
                Ok(Err(e)) => return Err(e),
                Err(_) => return Err("WGC capture thread panicked".to_string()),
            }
        }
        let duration_ms = capture.started_at.elapsed().as_millis() as u64;
        let bytes = std::fs::metadata(&capture.output_path)
            .map(|m| m.len())
            .unwrap_or(0);
        eprintln!(
            "[native-capture][wgc] stop complete output={} duration_ms={} bytes={}",
            capture.output_path,
            duration_ms,
            bytes
        );
        Ok(WgcResult {
            output_path: capture.output_path.clone(),
            width: capture.width,
            height: capture.height,
            duration_ms,
            bytes,
        })
    }

    pub fn source_bounds_from_hwnd(hwnd_val: isize) -> Option<CaptureBounds> {
        use windows::Win32::Foundation::{HWND, RECT};
        use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};

        let mut rect = RECT::default();
        let ok = unsafe {
            DwmGetWindowAttribute(
                HWND(hwnd_val as *mut core::ffi::c_void),
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut rect as *mut _ as *mut _,
                std::mem::size_of::<RECT>() as u32,
            )
            .is_ok()
        };
        if !ok {
            return None;
        }

        let width = (rect.right - rect.left).max(1) as u32;
        let height = (rect.bottom - rect.top).max(1) as u32;
        Some(CaptureBounds {
            x: rect.left,
            y: rect.top,
            width,
            height,
        })
    }

    // ── Capture thread ────────────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    fn wgc_thread(
        hwnd_val: isize,
        fps: u32,
        encoder: String,
        bitrate: u32,
        ffmpeg_exe: String,
        output_path: String,
        hide_cursor: bool,
        encoder_args: Vec<String>,
        stop_flag: Arc<AtomicBool>,
        setup_tx: std::sync::mpsc::Sender<CaptureResult<(u32, u32)>>,
    ) -> CaptureResult<()> {
        // ── 1. Initialise WinRT for this thread ───────────────────────────────
        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED)
                .map_err(|e| format!("RoInitialize failed: {e}"))?;
        }

        // ── 2. Create D3D11 device (BGRA support required by WGC) ─────────────
        let (d3d_device, d3d_context) = create_d3d11_device()?;

        // ── 3. Wrap the DXGI device as a WinRT IDirect3DDevice ────────────────
        let dxgi_device: IDXGIDevice = d3d_device
            .cast()
            .map_err(|e| format!("ID3D11Device→IDXGIDevice: {e}"))?;
        let winrt_inspect = unsafe {
            CreateDirect3D11DeviceFromDXGIDevice(&dxgi_device)
                .map_err(|e| format!("CreateDirect3D11DeviceFromDXGIDevice: {e}"))?
        };
        let winrt_device: windows::Graphics::DirectX::Direct3D11::IDirect3DDevice =
            winrt_inspect
                .cast()
                .map_err(|e| format!("IDirect3DDevice cast: {e}"))?;

        // ── 4. Create GraphicsCaptureItem for the HWND ────────────────────────
        let interop: IGraphicsCaptureItemInterop =
            windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
                .map_err(|e| format!("IGraphicsCaptureItemInterop factory: {e}"))?;
        let item: GraphicsCaptureItem = unsafe {
            interop
                .CreateForWindow(HWND(hwnd_val as *mut core::ffi::c_void))
                .map_err(|e| format!("IGraphicsCaptureItemInterop::CreateForWindow: {e}"))?
        };

        // Content size matches DWMWA_EXTENDED_FRAME_BOUNDS (no DWM shadow).
        let item_size = item.Size().map_err(|e| format!("item.Size(): {e}"))?;
        let cap_w = (item_size.Width.max(1)) as u32;
        let cap_h = (item_size.Height.max(1)) as u32;

        // ── 5. Create frame pool (free-threaded) ──────────────────────────────
        let frame_pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            1, // one buffered frame
            SizeInt32 { Width: cap_w as i32, Height: cap_h as i32 },
        )
        .map_err(|e| format!("Direct3D11CaptureFramePool::CreateFreeThreaded: {e}"))?;

        // ── 6. Create capture session ─────────────────────────────────────────
        let session = frame_pool
            .CreateCaptureSession(&item)
            .map_err(|e| format!("CreateCaptureSession: {e}"))?;

        // Hide the cursor from the captured video (does not affect the user's cursor).
        // Requires Windows 10 2004+; silently ignored on older builds.
        if hide_cursor {
            let _ = session.SetIsCursorCaptureEnabled(false);
        }

        // ── 7. CPU-readback staging texture ───────────────────────────────────
        let staging_texture = create_staging_texture(&d3d_device, cap_w, cap_h)?;

        // ── 8. Frame-arrival notification via condvar ─────────────────────────
        let frame_signal = Arc::new((Mutex::new(false), Condvar::new()));
        let frame_signal_cb = Arc::clone(&frame_signal);
        frame_pool
            .FrameArrived(&TypedEventHandler::new(
                move |_pool: &Option<Direct3D11CaptureFramePool>, _| {
                    let (lock, cvar) = &*frame_signal_cb;
                    *lock.lock().unwrap() = true;
                    cvar.notify_one();
                    Ok(())
                },
            ))
            .map_err(|e| format!("FrameArrived registration: {e}"))?;

        // ── 9. Signal setup complete to the caller ────────────────────────────
        let _ = setup_tx.send(Ok((cap_w, cap_h)));

        // ── 10. Start WGC ─────────────────────────────────────────────────────
        session
            .StartCapture()
            .map_err(|e| format!("StartCapture: {e}"))?;

        // ── 11. Spawn ffmpeg expecting raw BGRA frames on stdin ───────────────
        let mut ffmpeg_child = spawn_ffmpeg_rawvideo(
            &ffmpeg_exe,
            &encoder,
            bitrate,
            fps,
            cap_w,
            cap_h,
            &encoder_args,
            &output_path,
        )?;
        let mut ffmpeg_stdin = ffmpeg_child
            .stdin
            .take()
            .ok_or_else(|| "ffmpeg stdin not available".to_string())?;

        // ── 12. Frame capture loop ────────────────────────────────────────────
        let bytes_per_row = cap_w as usize * 4; // BGRA = 4 bytes/pixel
        let mut frame_buf = vec![0u8; bytes_per_row * cap_h as usize];
        let mut last_frame_buf = vec![0u8; bytes_per_row * cap_h as usize];

        let frame_interval = Duration::from_nanos(1_000_000_000 / fps.max(1) as u64);
        let mut next_send = Instant::now() + frame_interval;
        let mut frames_sent: u64 = 0;
        let mut ffmpeg_pipe_broken = false;
        let mut logged_first_frame = false;
        let mut has_last_frame = false;
        let mut latest_row_pitch: usize = 0;
        let mut frames_duplicated: u64 = 0;

        loop {
            if stop_flag.load(Ordering::SeqCst) {
                break;
            }

            // Wait for either frame-arrival, next send deadline, or periodic stop check.
            {
                let now = Instant::now();
                let wait_for = next_send
                    .saturating_duration_since(now)
                    .min(Duration::from_millis(200));
                let (lock, cvar) = &*frame_signal;
                let mut ready = lock.lock().unwrap();
                if !*ready {
                    let (guard, _) = cvar.wait_timeout(ready, wait_for).unwrap();
                    ready = guard;
                }
                *ready = false;
            }

            if stop_flag.load(Ordering::SeqCst) {
                break;
            }

            let now = Instant::now();
            // Drain frame pool and keep only the most recent frame if any.
            let mut latest_frame = None;
            while let Ok(frame) = frame_pool.TryGetNextFrame() {
                latest_frame = Some(frame);
            }

            if let Some(frame) = latest_frame {
                // Get the underlying D3D11 texture from the WinRT surface.
                let surface = match frame.Surface() {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                let dxgi_access = match surface.cast::<IDirect3DDxgiInterfaceAccess>() {
                    Ok(a) => a,
                    Err(_) => continue,
                };
                let src_surface: IDXGISurface = match unsafe { dxgi_access.GetInterface() } {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                let src_texture: ID3D11Texture2D = match src_surface.cast() {
                    Ok(t) => t,
                    Err(_) => continue,
                };

                // Copy GPU texture to our CPU-readable staging texture.
                unsafe {
                    let src_res: ID3D11Resource = src_texture.cast().unwrap();
                    let dst_res: ID3D11Resource = staging_texture.cast().unwrap();
                    d3d_context.CopyResource(&dst_res, &src_res);
                }

                // Map staging texture and extract BGRA bytes.
                let mut mapped = windows::Win32::Graphics::Direct3D11::D3D11_MAPPED_SUBRESOURCE::default();
                let map_ok = unsafe {
                    d3d_context
                        .Map(&staging_texture.cast::<ID3D11Resource>().unwrap(), 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                        .is_ok()
                };
                if !map_ok {
                    continue;
                }

                {
                    let pitch = mapped.RowPitch as usize;
                    let src_slice = unsafe {
                        std::slice::from_raw_parts(
                            mapped.pData as *const u8,
                            pitch * cap_h as usize,
                        )
                    };
                    for row in 0..cap_h as usize {
                        let src_row = &src_slice[row * pitch..row * pitch + bytes_per_row];
                        let dst_start = row * bytes_per_row;
                        frame_buf[dst_start..dst_start + bytes_per_row].copy_from_slice(src_row);
                    }
                    latest_row_pitch = pitch;
                }

                unsafe {
                    d3d_context.Unmap(&staging_texture.cast::<ID3D11Resource>().unwrap(), 0);
                }

                last_frame_buf.copy_from_slice(&frame_buf);
                has_last_frame = true;
            }

            if now < next_send {
                continue;
            }
            if !has_last_frame {
                next_send = now + frame_interval;
                continue;
            }

            // Emit one or more frames at the requested FPS. If no new frame arrived,
            // duplicate the last frame so video duration matches wall-clock duration.
            let mut emits_this_loop: u32 = 0;
            while now >= next_send {
                if ffmpeg_stdin.write_all(&last_frame_buf).is_err() {
                    ffmpeg_pipe_broken = true;
                    break;
                }
                frames_sent += 1;
                if emits_this_loop > 0 {
                    frames_duplicated += 1;
                }
                emits_this_loop += 1;
                next_send += frame_interval;

                if !logged_first_frame {
                    let mut sample = [0u8; 8];
                    let sample_len = sample.len().min(last_frame_buf.len());
                    sample[..sample_len].copy_from_slice(&last_frame_buf[..sample_len]);
                    eprintln!(
                        "[native-capture][wgc] first-frame sent size={}x{} sample_bgra={:?} row_pitch={} bytes_per_row={}",
                        cap_w,
                        cap_h,
                        sample,
                        latest_row_pitch,
                        bytes_per_row
                    );
                    logged_first_frame = true;
                } else if frames_sent % 120 == 0 {
                    eprintln!(
                        "[native-capture][wgc] frame-progress sent_frames={} duplicated_frames={}",
                        frames_sent,
                        frames_duplicated
                    );
                }

                // Avoid huge burst writes after stalls.
                if emits_this_loop >= 8 {
                    next_send = Instant::now() + frame_interval;
                    break;
                }
            }
            if ffmpeg_pipe_broken {
                break;
            }
        }

        // ── 13. Finalise ──────────────────────────────────────────────────────
        // Close stdin to signal EOF to ffmpeg, then wait for it to finish encoding.
        drop(ffmpeg_stdin);
        let ffmpeg_status = ffmpeg_child
            .wait()
            .map_err(|e| format!("Failed to wait for ffmpeg process: {e}"))?;

        // Close the WGC session cleanly.
        let _ = session.Close();
        let _ = frame_pool.Close();

        if frames_sent == 0 {
            return Err("No frames were captured from target window".to_string());
        }
        eprintln!(
            "[native-capture][wgc] finalize sent_frames={} duplicated_frames={} ffmpeg_pipe_broken={} ffmpeg_status={}",
            frames_sent,
            frames_duplicated,
            ffmpeg_pipe_broken,
            ffmpeg_status
        );
        if ffmpeg_pipe_broken {
            return Err(format!("FFmpeg input pipe closed during capture (status={ffmpeg_status})"));
        }
        if !ffmpeg_status.success() {
            return Err(format!("FFmpeg exited with non-zero status: {ffmpeg_status}"));
        }

        Ok(())
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn create_d3d11_device() -> CaptureResult<(ID3D11Device, ID3D11DeviceContext)> {
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                None,
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
            .map_err(|e| format!("D3D11CreateDevice: {e}"))?;
        }
        Ok((device.unwrap(), context.unwrap()))
    }

    fn create_staging_texture(
        device: &ID3D11Device,
        width: u32,
        height: u32,
    ) -> CaptureResult<ID3D11Texture2D> {
        use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
        use windows::Win32::Graphics::Direct3D11::D3D11_RESOURCE_MISC_FLAG;

        let desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: D3D11_BIND_FLAG(0).0 as u32,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: D3D11_RESOURCE_MISC_FLAG(0).0 as u32,
        };
        let mut texture: Option<ID3D11Texture2D> = None;
        unsafe {
            device
                .CreateTexture2D(&desc, None, Some(&mut texture))
                .map_err(|e| format!("CreateTexture2D (staging): {e}"))?;
        }
        Ok(texture.unwrap())
    }

    #[allow(clippy::too_many_arguments)]
    fn spawn_ffmpeg_rawvideo(
        ffmpeg_exe: &str,
        encoder: &str,
        bitrate: u32,
        fps: u32,
        width: u32,
        height: u32,
        encoder_args: &[String],
        output_path: &str,
    ) -> CaptureResult<Child> {
        use std::os::windows::process::CommandExt;
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;

        let bitrate_str = bitrate.max(1_000_000).to_string();
        let fps_str = fps.to_string();
        let size_str = format!("{}x{}", width, height);
        let bufsize_str = bitrate.saturating_mul(3).to_string();
        let gop_str = (fps.max(1) * 2).to_string();

        let (video_codec, default_enc_args): (&str, &[&str]) = match encoder {
            "h264_nvenc" => (
                "h264_nvenc",
                &["-preset", "p2", "-tune", "ll", "-rc", "vbr", "-cq", "27"],
            ),
            "hevc_nvenc" => (
                "hevc_nvenc",
                &["-preset", "p2", "-tune", "ll", "-rc", "vbr", "-cq", "29"],
            ),
            "h264_amf" => ("h264_amf", &[]),
            _ => ("libx264", &["-preset", "ultrafast", "-tune", "zerolatency"]),
        };

        let mut cmd = Command::new(ffmpeg_exe);
        cmd.creation_flags(BELOW_NORMAL_PRIORITY_CLASS);
        cmd.arg("-y")
            // Input: raw BGRA frames from stdin
            .arg("-f").arg("rawvideo")
            .arg("-pixel_format").arg("bgra")
            .arg("-video_size").arg(&size_str)
            .arg("-framerate").arg(&fps_str)
            .arg("-i").arg("pipe:0")
            // Output
            .arg("-r").arg(&fps_str)
            .arg("-pix_fmt").arg("yuv420p")
            .arg("-c:v").arg(video_codec);

        // Prefer caller-supplied encoder args; fall back to defaults.
        if encoder_args.is_empty() {
            for arg in default_enc_args {
                cmd.arg(arg);
            }
        } else {
            for arg in encoder_args {
                cmd.arg(arg);
            }
        }

        cmd.arg("-b:v").arg(&bitrate_str)
            .arg("-maxrate").arg(&bitrate_str)
            .arg("-bufsize").arg(&bufsize_str)
            .arg("-g").arg(&gop_str)
            .arg("-movflags").arg("+faststart")
            .arg(output_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        cmd.spawn().map_err(|e| format!("Failed to spawn ffmpeg: {e}"))
    }
}

// Re-export the inner module's public items on Windows.
#[cfg(target_os = "windows")]
pub use inner::{hwnd_from_source_id, source_bounds_from_hwnd, start, stop, WgcCapture};
