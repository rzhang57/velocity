#[cfg(target_os = "windows")]
pub mod inner {
    use std::io::{BufRead, BufReader, Write};
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
        Win32::Graphics::Gdi::{GetMonitorInfoW, HMONITOR, MONITORINFO, MONITOR_DEFAULTTOPRIMARY},
        Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
        Win32::System::WinRT::Direct3D11::{
            CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
        },
        Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop,
    };

    type CaptureResult<T> = std::result::Result<T, String>;

    enum CaptureTarget {
        Window(isize),
        Monitor(isize),
    }

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

    pub fn hwnd_from_source_id(source_id: &str) -> Option<isize> {
        let after = source_id.strip_prefix("window:")?;
        let num_str = after.split(':').next()?;
        let val: isize = num_str.parse().ok()?;
        if val > 0 { Some(val) } else { None }
    }

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

        let (setup_tx, setup_rx) =
            std::sync::mpsc::channel::<CaptureResult<(u32, u32)>>();

        let encoder = encoder.to_string();
        let ffmpeg_exe = ffmpeg_exe.to_string();
        let output_path_str = output_path.to_string();

        let thread = thread::spawn(move || {
            wgc_thread(
                CaptureTarget::Window(hwnd_val),
                fps,
                encoder,
                bitrate,
                ffmpeg_exe,
                output_path_str,
                hide_cursor,
                encoder_args,
                stop_flag_thread,
                setup_tx,
                0,
                0,
                None,
                None,
            )
        });

        let (width, height) = match setup_rx.recv_timeout(Duration::from_secs(8)) {
            Ok(Ok(dims)) => dims,
            Ok(Err(e)) => {
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

    pub fn hmonitor_from_point(x: i32, y: i32) -> isize {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::Graphics::Gdi::MonitorFromPoint;
        let hmon = unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTOPRIMARY) };
        hmon.0 as isize
    }

    pub fn monitor_rect(hmonitor_val: isize) -> Option<(i32, i32, u32, u32)> {
        let hmon = HMONITOR(hmonitor_val as *mut core::ffi::c_void);
        let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        let ok = unsafe { GetMonitorInfoW(hmon, &mut info).as_bool() };
        if !ok {
            return None;
        }
        let r = info.rcMonitor;
        Some((r.left, r.top, (r.right - r.left) as u32, (r.bottom - r.top) as u32))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn start_monitor(
        hmonitor_val: isize,
        crop_x: u32,
        crop_y: u32,
        out_width: u32,
        out_height: u32,
        video_width: u32,
        video_height: u32,
        fps: u32,
        encoder: &str,
        bitrate: u32,
        ffmpeg_exe: &str,
        output_path: &str,
        hide_cursor: bool,
        encoder_args: Vec<String>,
    ) -> CaptureResult<WgcCapture> {
        eprintln!(
            "[native-capture][wgc] start_monitor hmonitor=0x{:x} crop={}x{}+{},{} out={}x{} target={}x{} fps={} encoder={}",
            hmonitor_val as usize,
            out_width, out_height, crop_x, crop_y,
            out_width, out_height,
            video_width, video_height,
            fps, encoder
        );
        let scale_to = if video_width != out_width || video_height != out_height {
            Some((video_width, video_height))
        } else {
            None
        };
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_thread = Arc::clone(&stop_flag);
        let (setup_tx, setup_rx) = std::sync::mpsc::channel::<CaptureResult<(u32, u32)>>();
        let encoder = encoder.to_string();
        let ffmpeg_exe = ffmpeg_exe.to_string();
        let output_path_str = output_path.to_string();
        let thread = thread::spawn(move || {
            wgc_thread(
                CaptureTarget::Monitor(hmonitor_val),
                fps,
                encoder,
                bitrate,
                ffmpeg_exe,
                output_path_str,
                hide_cursor,
                encoder_args,
                stop_flag_thread,
                setup_tx,
                crop_x,
                crop_y,
                Some((out_width, out_height)),
                scale_to,
            )
        });
        let final_w = scale_to.map(|(w, _)| w).unwrap_or(out_width);
        let final_h = scale_to.map(|(_, h)| h).unwrap_or(out_height);
        match setup_rx.recv_timeout(Duration::from_secs(8)) {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => {
                let _ = thread.join();
                return Err(e);
            }
            Err(_) => {
                let _ = thread.join();
                return Err("WGC monitor capture setup timed out".to_string());
            }
        }
        eprintln!(
            "[native-capture][wgc] monitor setup complete size={}x{}",
            final_w, final_h
        );
        Ok(WgcCapture {
            width: final_w,
            height: final_h,
            output_path: output_path.to_string(),
            started_at: Instant::now(),
            stop_flag,
            thread: Some(thread),
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn wgc_thread(
        target: CaptureTarget,
        fps: u32,
        encoder: String,
        bitrate: u32,
        ffmpeg_exe: String,
        output_path: String,
        hide_cursor: bool,
        encoder_args: Vec<String>,
        stop_flag: Arc<AtomicBool>,
        setup_tx: std::sync::mpsc::Sender<CaptureResult<(u32, u32)>>,
        crop_x: u32,
        crop_y: u32,
        out_size: Option<(u32, u32)>,
        scale_to: Option<(u32, u32)>,
    ) -> CaptureResult<()> {
        unsafe {
            use windows::Win32::System::Threading::{
                GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_ABOVE_NORMAL,
            };
            let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);
        }

        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED)
                .map_err(|e| format!("RoInitialize failed: {e}"))?;
        }

        let (d3d_device, d3d_context) = create_d3d11_device()?;

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

        let interop: IGraphicsCaptureItemInterop =
            windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
                .map_err(|e| format!("IGraphicsCaptureItemInterop factory: {e}"))?;
        let item: GraphicsCaptureItem = match &target {
            CaptureTarget::Window(hwnd) => unsafe {
                interop
                    .CreateForWindow(HWND(*hwnd as *mut core::ffi::c_void))
                    .map_err(|e| format!("IGraphicsCaptureItemInterop::CreateForWindow: {e}"))?
            },
            CaptureTarget::Monitor(hmon) => unsafe {
                interop
                    .CreateForMonitor(HMONITOR(*hmon as *mut core::ffi::c_void))
                    .map_err(|e| format!("IGraphicsCaptureItemInterop::CreateForMonitor: {e}"))?
            },
        };

        let item_size = item.Size().map_err(|e| format!("item.Size(): {e}"))?;
        let cap_w = (item_size.Width.max(1)) as u32;
        let cap_h = (item_size.Height.max(1)) as u32;
        let (out_w, out_h) = out_size.unwrap_or((cap_w, cap_h));

        let frame_pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            3, // absorb GPU readback stalls at up to 120 fps
            SizeInt32 { Width: cap_w as i32, Height: cap_h as i32 },
        )
        .map_err(|e| format!("Direct3D11CaptureFramePool::CreateFreeThreaded: {e}"))?;

        let session = frame_pool
            .CreateCaptureSession(&item)
            .map_err(|e| format!("CreateCaptureSession: {e}"))?;

        if hide_cursor {
            let _ = session.SetIsCursorCaptureEnabled(false);
        }

        // Three staging textures in a ring. CopyResource queues an async GPU copy
        // into the current write slot; we Map the slot from 2 frames ago, by which
        // point the GPU copy is already complete and Map returns without stalling.
        const N_STAGING: usize = 3;
        let mut staging_pool: Vec<ID3D11Texture2D> = Vec::with_capacity(N_STAGING);
        for _ in 0..N_STAGING {
            staging_pool.push(create_staging_texture(&d3d_device, cap_w, cap_h)?);
        }
        let mut write_idx: usize = 0;
        let mut frames_queued: u64 = 0;

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

        session
            .StartCapture()
            .map_err(|e| format!("StartCapture: {e}"))?;

        let mut ffmpeg_child = spawn_ffmpeg_rawvideo(
            &ffmpeg_exe,
            &encoder,
            bitrate,
            fps,
            out_w,
            out_h,
            &encoder_args,
            &output_path,
            scale_to,
        )?;
        let ffmpeg_stdin = ffmpeg_child
            .stdin
            .take()
            .ok_or_else(|| "ffmpeg stdin not available".to_string())?;
        let ffmpeg_stderr = ffmpeg_child.stderr.take();
        let ffmpeg_stderr_lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        if let Some(stderr) = ffmpeg_stderr {
            let stderr_lines = Arc::clone(&ffmpeg_stderr_lines);
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    eprintln!("[native-capture][wgc][ffmpeg][stderr] {}", trimmed);
                    if let Ok(mut guard) = stderr_lines.lock() {
                        if guard.len() >= 30 {
                            let _ = guard.remove(0);
                        }
                        guard.push(trimmed.to_string());
                    }
                }
            });
        }
        thread::sleep(Duration::from_millis(300));
        match ffmpeg_child.try_wait() {
            Ok(Some(status)) => {
                let stderr_excerpt = ffmpeg_stderr_lines
                    .lock()
                    .ok()
                    .map(|lines| lines.join(" | "))
                    .unwrap_or_default();
                return Err(format!(
                    "ffmpeg exited immediately during startup (status={status}).{}",
                    if stderr_excerpt.is_empty() {
                        String::new()
                    } else {
                        format!(" stderr={stderr_excerpt}")
                    }
                ));
            }
            Ok(None) => {}
            Err(err) => return Err(format!("failed to verify ffmpeg startup: {err}")),
        }

        let final_w = scale_to.map(|(w, _)| w).unwrap_or(out_w);
        let final_h = scale_to.map(|(_, h)| h).unwrap_or(out_h);
        let _ = setup_tx.send(Ok((final_w, final_h)));

        let (frame_tx, frame_rx) = std::sync::mpsc::sync_channel::<Arc<Vec<u8>>>(256);
        let write_thread: JoinHandle<bool> = thread::spawn(move || {
            let mut stdin = ffmpeg_stdin;
            while let Ok(frame) = frame_rx.recv() {
                if stdin.write_all(&frame).is_err() {
                    return false;
                }
            }
            drop(stdin); // EOF → ffmpeg finalises
            true
        });

        // Shared latest converted frame between the GPU capture loop and the pacing thread.
        // The capture loop writes here after each YUV conversion; the pacing thread reads
        // at its own cadence and blocking-sends to the ffmpeg pipe. This separation means
        // pipe back-pressure can never stall the GPU capture loop, preventing choppiness.
        let shared_latest: Arc<Mutex<Option<Arc<Vec<u8>>>>> = Arc::new(Mutex::new(None));
        let shared_latest_pacing = Arc::clone(&shared_latest);

        let frame_interval = Duration::from_nanos(1_000_000_000 / fps.max(1) as u64);
        let recording_started_at = Instant::now();
        let pacing_stop_flag = Arc::clone(&stop_flag);

        // Pacing thread: sends frames at the requested fps with correct wall-clock timing.
        // Runs independently from GPU capture so pipe stalls never cause recording gaps.
        let pacing_thread: JoinHandle<(u64, u64, bool)> = thread::spawn(move || {
            let mut next_send = Instant::now() + frame_interval;
            let mut frames_sent: u64 = 0;
            let mut frames_duplicated: u64 = 0;
            let mut last_frame: Option<Arc<Vec<u8>>> = None;
            let mut logged_first_frame = false;

            loop {
                if pacing_stop_flag.load(Ordering::SeqCst) {
                    break;
                }

                let now = Instant::now();
                if now < next_send {
                    let wait = (next_send - now).min(Duration::from_millis(5));
                    thread::sleep(wait);
                    continue;
                }

                // Pull the latest converted frame from the capture thread.
                if let Ok(guard) = shared_latest_pacing.lock() {
                    if let Some(ref f) = *guard {
                        last_frame = Some(Arc::clone(f));
                    }
                }

                let Some(ref frame) = last_frame else {
                    next_send = Instant::now() + frame_interval;
                    continue;
                };

                let mut emits_this_loop: u32 = 0;
                while Instant::now() >= next_send {
                    match frame_tx.send(Arc::clone(frame)) {
                        Ok(_) => {
                            frames_sent += 1;
                            if emits_this_loop > 0 {
                                frames_duplicated += 1;
                            }
                            if !logged_first_frame {
                                eprintln!("[native-capture][wgc] first-frame sent");
                                logged_first_frame = true;
                            } else if frames_sent % 120 == 0 {
                                eprintln!(
                                    "[native-capture][wgc] frame-progress sent={} dup={}",
                                    frames_sent, frames_duplicated
                                );
                            }
                        }
                        Err(_) => {
                            // ffmpeg pipe disconnected
                            return (frames_sent, frames_duplicated, false);
                        }
                    }
                    emits_this_loop += 1;
                    next_send += frame_interval;
                    if emits_this_loop >= 8 {
                        next_send = Instant::now() + frame_interval;
                        break;
                    }
                }
            }

            // Pad with duplicate frames so video duration equals wall-clock recording time.
            // Handles frame drops from any cause (pipe pressure, slow encoder, etc.) and
            // ensures screen, camera, and microphone tracks all stay in sync.
            if let Some(ref frame) = last_frame {
                let elapsed_secs = recording_started_at.elapsed().as_secs_f64();
                let total_expected = (fps as f64 * elapsed_secs).round() as u64;
                if frames_sent < total_expected {
                    let pad_count = total_expected - frames_sent;
                    eprintln!(
                        "[native-capture][wgc] padding {} frames \
                        (elapsed={:.3}s expected={} sent={})",
                        pad_count, elapsed_secs, total_expected, frames_sent
                    );
                    for _ in 0..pad_count {
                        if frame_tx.send(Arc::clone(frame)).is_err() {
                            break;
                        }
                        frames_sent += 1;
                    }
                }
            }

            (frames_sent, frames_duplicated, true)
        });

        // GPU capture loop — reads WGC frames, converts to YUV420p, publishes to shared_latest.
        // Never touches frame_tx so pipe back-pressure cannot block this loop.
        let mut frame_arc: Arc<Vec<u8>> =
            Arc::new(vec![0u8; out_w as usize * out_h as usize * 3 / 2]);
        let mut logged_first_frame_cap = false;
        let mut latest_row_pitch: usize = 0;

        loop {
            if stop_flag.load(Ordering::SeqCst) {
                break;
            }

            {
                let (lock, cvar) = &*frame_signal;
                let mut ready = lock.lock().unwrap();
                if !*ready {
                    let (guard, _) = cvar.wait_timeout(ready, Duration::from_millis(20)).unwrap();
                    ready = guard;
                }
                *ready = false;
            }

            if stop_flag.load(Ordering::SeqCst) {
                break;
            }

            let mut latest_frame = None;
            while let Ok(frame) = frame_pool.TryGetNextFrame() {
                latest_frame = Some(frame);
            }

            if let Some(frame) = latest_frame {
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

                unsafe {
                    let src_res: ID3D11Resource = src_texture.cast().unwrap();
                    let dst_res: ID3D11Resource = staging_pool[write_idx].cast().unwrap();
                    d3d_context.CopyResource(&dst_res, &src_res);
                }

                let read_idx = (write_idx + 1) % N_STAGING;
                write_idx = (write_idx + 1) % N_STAGING;
                frames_queued += 1;

                if frames_queued >= N_STAGING as u64 {
                    let mut mapped = windows::Win32::Graphics::Direct3D11::D3D11_MAPPED_SUBRESOURCE::default();
                    let map_ok = unsafe {
                        d3d_context
                            .Map(&staging_pool[read_idx].cast::<ID3D11Resource>().unwrap(), 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                            .is_ok()
                    };
                    if map_ok {
                        let pitch = mapped.RowPitch as usize;
                        let src_slice = unsafe {
                            std::slice::from_raw_parts(
                                mapped.pData as *const u8,
                                pitch * cap_h as usize,
                            )
                        };
                        let buf = Arc::make_mut(&mut frame_arc);
                        bgra_to_yuv420p(src_slice, pitch, crop_x as usize, crop_y as usize, buf, out_w as usize, out_h as usize);
                        latest_row_pitch = pitch;
                        unsafe {
                            d3d_context.Unmap(&staging_pool[read_idx].cast::<ID3D11Resource>().unwrap(), 0);
                        }

                        // Publish for the pacing thread (non-blocking)
                        if let Ok(mut guard) = shared_latest.lock() {
                            *guard = Some(Arc::clone(&frame_arc));
                        }
                        if !logged_first_frame_cap {
                            eprintln!(
                                "[native-capture][wgc] capture: first frame ready \
                                cap={}x{} out={}x{} pitch={}",
                                cap_w, cap_h, out_w, out_h, latest_row_pitch
                            );
                            logged_first_frame_cap = true;
                        }
                    }
                }
            }
        }

        let (frames_sent, frames_duplicated, pipe_ok) =
            pacing_thread.join().map_err(|_| "pacing thread panicked".to_string())?;
        let ffmpeg_pipe_broken = !pipe_ok;

        let write_ok = write_thread.join().unwrap_or(false);
        let ffmpeg_status = ffmpeg_child
            .wait()
            .map_err(|e| format!("Failed to wait for ffmpeg process: {e}"))?;

        let _ = session.Close();
        let _ = frame_pool.Close();

        if frames_sent == 0 {
            return Err("No frames were captured from target window".to_string());
        }
        eprintln!(
            "[native-capture][wgc] finalize sent_frames={} duplicated_frames={} ffmpeg_pipe_broken={} write_ok={} ffmpeg_status={}",
            frames_sent,
            frames_duplicated,
            ffmpeg_pipe_broken,
            write_ok,
            ffmpeg_status
        );
        let stderr_excerpt = ffmpeg_stderr_lines
            .lock()
            .ok()
            .map(|lines| lines.join(" | "))
            .unwrap_or_default();
        if ffmpeg_pipe_broken || !write_ok {
            return Err(format!(
                "FFmpeg input pipe closed during capture (status={ffmpeg_status}).{}",
                if stderr_excerpt.is_empty() {
                    String::new()
                } else {
                    format!(" stderr={stderr_excerpt}")
                }
            ));
        }
        if !ffmpeg_status.success() {
            return Err(format!(
                "FFmpeg exited with non-zero status: {ffmpeg_status}.{}",
                if stderr_excerpt.is_empty() {
                    String::new()
                } else {
                    format!(" stderr={stderr_excerpt}")
                }
            ));
        }

        Ok(())
    }

    fn bgra_to_yuv420p(
        bgra: &[u8],
        src_pitch: usize,
        src_x: usize,
        src_y: usize,
        yuv: &mut [u8],
        width: usize,
        height: usize,
    ) {
        let y_size = width * height;
        let uv_w = width / 2;

        // Y plane — compiler auto-vectorises this inner loop well
        for row in 0..height {
            for col in 0..width {
                let p = (src_y + row) * src_pitch + (src_x + col) * 4;
                let b = bgra[p] as i32;
                let g = bgra[p + 1] as i32;
                let r = bgra[p + 2] as i32;
                yuv[row * width + col] = (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16) as u8;
            }
        }

        // U then V planes (planar YUV420p), sample top-left of each 2×2 block
        let u_off = y_size;
        let v_off = y_size + uv_w * (height / 2);
        for row in (0..height).step_by(2) {
            for col in (0..width).step_by(2) {
                let p = (src_y + row) * src_pitch + (src_x + col) * 4;
                let b = bgra[p] as i32;
                let g = bgra[p + 1] as i32;
                let r = bgra[p + 2] as i32;
                let i = (row / 2) * uv_w + col / 2;
                yuv[u_off + i] = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128) as u8;
                yuv[v_off + i] = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128) as u8;
            }
        }
    }

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
        scale_to: Option<(u32, u32)>,
    ) -> CaptureResult<Child> {
        let bitrate_str = bitrate.max(1_000_000).to_string();
        let fps_str = fps.to_string();
        let size_str = format!("{}x{}", width, height);
        let bufsize_str = bitrate.saturating_mul(3).to_string();
        let gop_str = (fps.max(1) * 2).to_string();

        let (video_codec, default_enc_args): (&str, &[&str]) = match encoder {
            "h264_nvenc" => (
                "h264_nvenc",
                &["-preset", "p4", "-tune", "ll", "-rc", "vbr", "-cq", "20"],
            ),
            "hevc_nvenc" => (
                "hevc_nvenc",
                &["-preset", "p4", "-tune", "ll", "-rc", "vbr", "-cq", "22"],
            ),
            "h264_amf" => ("h264_amf", &["-quality", "quality"]),
            // medium preset produces dramatically sharper text/UI than ultrafast at the
            // cost of slightly more CPU; still real-time at 1080p60 on any modern CPU.
            _ => ("libx264", &["-preset", "medium", "-tune", "zerolatency"]),
        };

        let mut cmd = Command::new(ffmpeg_exe);
        cmd.arg("-y")
            .arg("-f")
            .arg("rawvideo")
            .arg("-pixel_format").arg("yuv420p")
            .arg("-video_size").arg(&size_str)
            .arg("-framerate").arg(&fps_str)
            .arg("-i").arg("pipe:0")
            .arg("-r").arg(&fps_str);

        if let Some((tw, th)) = scale_to {
            // lanczos preserves sharp edges/text when downscaling; bilinear (default) blurs
            cmd.arg("-vf").arg(format!("scale={}:{}:flags=lanczos", tw, th));
        }

        cmd.arg("-pix_fmt").arg("yuv420p")
            .arg("-c:v").arg(video_codec);

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
            .stderr(Stdio::piped());

        cmd.spawn().map_err(|e| format!("Failed to spawn ffmpeg: {e}"))
    }
}

#[cfg(target_os = "windows")]
pub use inner::{
    hmonitor_from_point, hwnd_from_source_id, monitor_rect, source_bounds_from_hwnd, start,
    start_monitor, stop, WgcCapture,
};
