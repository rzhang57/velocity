use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::capture::{ActiveCapture, CaptureBackend, SourceBounds};
use crate::ffmpeg::resolve_ffmpeg_path;
use crate::protocol::StartCapturePayload;

pub fn start_capture(start_payload: StartCapturePayload) -> Result<ActiveCapture, String> {
    if !cfg!(target_os = "windows") {
        return Err("win32 capture requested, but sidecar binary is not a windows build".to_string());
    }

    let ffmpeg_exe = resolve_ffmpeg_path(start_payload.ffmpeg_path.as_deref());
    if ffmpeg_exe.is_none() {
        return Err(
            "ffmpeg executable not found (bundle native-capture-sidecar/bin/win32/ffmpeg.exe or install ffmpeg on PATH)".to_string(),
        );
    }
    let ffmpeg_exe = ffmpeg_exe.unwrap_or_else(|| "ffmpeg.exe".to_string());

    if start_payload.source.source_type == "screen" {
        let region = start_payload.capture_region.as_ref();
        let center_x = region.map(|r| r.x + r.width as i32 / 2).unwrap_or(0);
        let center_y = region.map(|r| r.y + r.height as i32 / 2).unwrap_or(0);
        let hmonitor = crate::wgc::hmonitor_from_point(center_x, center_y);
        let (mon_x, mon_y, mon_w, mon_h) = crate::wgc::monitor_rect(hmonitor)
            .unwrap_or((0, 0, start_payload.video.width, start_payload.video.height));
        let (crop_x, crop_y, out_w, out_h) = if let Some(r) = region {
            let cx = (r.x - mon_x).max(0) as u32;
            let cy = (r.y - mon_y).max(0) as u32;
            (cx, cy, r.width.min(mon_w.saturating_sub(cx)), r.height.min(mon_h.saturating_sub(cy)))
        } else {
            (0, 0, mon_w, mon_h)
        };
        let out_w = out_w.max(2) & !1;
        let out_h = out_h.max(2) & !1;
        let hide_cursor = start_payload.cursor.mode == "hide";
        let encoder_args = build_encoder_args(&start_payload.video.encoder);
        eprintln!(
            "[native-capture][win][wgc] screen start hmonitor=0x{:x} monitor={}x{}@{},{} crop={}x{}+{},{} out={}x{} target={}x{} fps={} encoder={}",
            hmonitor as usize, mon_w, mon_h, mon_x, mon_y,
            out_w, out_h, crop_x, crop_y,
            out_w, out_h,
            start_payload.video.width, start_payload.video.height,
            start_payload.video.fps, start_payload.video.encoder
        );
        let wgc_capture = crate::wgc::start_monitor(
            hmonitor,
            crop_x,
            crop_y,
            out_w,
            out_h,
            start_payload.video.width,
            start_payload.video.height,
            start_payload.video.fps,
            &start_payload.video.encoder,
            start_payload.video.bitrate,
            &ffmpeg_exe,
            &start_payload.output_path,
            hide_cursor,
            encoder_args,
        )?;
        eprintln!(
            "[native-capture][win][wgc] screen start succeeded output_path={} size={}x{}",
            start_payload.output_path, wgc_capture.width, wgc_capture.height
        );
        return Ok(ActiveCapture {
            session_id: start_payload.session_id,
            output_path: start_payload.output_path,
            width: wgc_capture.width,
            height: wgc_capture.height,
            fps: start_payload.video.fps,
            started_at: Instant::now(),
            platform: "win32".to_string(),
            restore_cursor_on_stop: false,
            source_bounds: None,
            backend: CaptureBackend::Wgc(wgc_capture),
        });
    }

    if start_payload.source.source_type == "window" {
        let hwnd = start_payload
            .source
            .id
            .as_deref()
            .and_then(crate::wgc::hwnd_from_source_id)
            .ok_or_else(|| "window capture requires source.id in the form window:<hwnd>:...".to_string())?;
        let source_bounds = crate::wgc::source_bounds_from_hwnd(hwnd).map(|bounds| SourceBounds {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
        });
        eprintln!(
            "[native-capture][win][wgc] start requested source_id={:?} source_name={:?} hwnd=0x{:x} bounds={:?} fps={} encoder={} bitrate={} cursor_mode={}",
            start_payload.source.id,
            start_payload.source.name,
            hwnd as usize,
            source_bounds.as_ref().map(|b| format!("{}x{}@{},{}", b.width, b.height, b.x, b.y)),
            start_payload.video.fps,
            start_payload.video.encoder,
            start_payload.video.bitrate,
            start_payload.cursor.mode
        );
        let encoder_args = build_encoder_args(&start_payload.video.encoder);
        let hide_cursor = start_payload.cursor.mode == "hide";
        let wgc_capture = crate::wgc::start(
            hwnd,
            start_payload.video.fps,
            &start_payload.video.encoder,
            start_payload.video.bitrate,
            &ffmpeg_exe,
            &start_payload.output_path,
            hide_cursor,
            encoder_args,
        )?;
        eprintln!(
            "[native-capture][win][wgc] start succeeded output_path={} capture_size={}x{}",
            start_payload.output_path,
            wgc_capture.width,
            wgc_capture.height
        );

        return Ok(ActiveCapture {
            session_id: start_payload.session_id,
            output_path: start_payload.output_path,
            width: wgc_capture.width,
            height: wgc_capture.height,
            fps: start_payload.video.fps,
            started_at: Instant::now(),
            platform: "win32".to_string(),
            restore_cursor_on_stop: false,
            source_bounds,
            backend: CaptureBackend::Wgc(wgc_capture),
        });
    }

    let output_path = start_payload.output_path.clone();
    let mut command = build_ffmpeg_command(&ffmpeg_exe, &start_payload)?;

    command
        .arg(output_path.as_str())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let child = command
        .spawn()
        .map_err(|err| format!("failed to spawn ffmpeg: {err}"))?;
    let mut child = child;
    let stderr_lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    if let Some(stderr) = child.stderr.take() {
        let stderr_lines_for_thread = Arc::clone(&stderr_lines);
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                eprintln!("[native-capture][win][ffmpeg][stderr] {}", trimmed);
                if let Ok(mut guard) = stderr_lines_for_thread.lock() {
                    if guard.len() >= 30 {
                        let _ = guard.remove(0);
                    }
                    guard.push(trimmed.to_string());
                }
            }
        });
    }

    thread::sleep(Duration::from_millis(350));
    match child.try_wait() {
        Ok(Some(status)) => {
            let stderr_excerpt = stderr_lines
                .lock()
                .ok()
                .map(|lines| lines.join(" | "))
                .unwrap_or_default();
            return Err(format!(
                "ffmpeg exited immediately during startup (status={status}). Try h264_libx264.{}",
                if stderr_excerpt.is_empty() {
                    String::new()
                } else {
                    format!(" stderr={stderr_excerpt}")
                }
            ));
        }
        Ok(None) => {}
        Err(err) => {
            let stderr_excerpt = stderr_lines
                .lock()
                .ok()
                .map(|lines| lines.join(" | "))
                .unwrap_or_default();
            return Err(format!(
                "failed to verify ffmpeg startup: {err}.{}",
                if stderr_excerpt.is_empty() {
                    String::new()
                } else {
                    format!(" stderr={stderr_excerpt}")
                }
            ));
        }
    }

    Ok(ActiveCapture {
        session_id: start_payload.session_id,
        output_path,
        width: start_payload.video.width,
        height: start_payload.video.height,
        fps: start_payload.video.fps,
        started_at: Instant::now(),
        platform: "win32".to_string(),
        restore_cursor_on_stop: false,
        source_bounds: None,
        backend: CaptureBackend::Ffmpeg(child),
    })
}

fn build_ffmpeg_command(ffmpeg_exe: &str, payload: &StartCapturePayload) -> Result<Command, String> {
    let draw_mouse = if payload.cursor.mode == "hide" { "0" } else { "1" };
    let bitrate = format!("{}", payload.video.bitrate.max(1_000_000));
    let source_dimensions = if payload.source.source_type == "screen" {
        payload
            .capture_region
            .as_ref()
            .map(|region| (region.width.max(1), region.height.max(1)))
    } else {
        None
    };
    let needs_scale = match source_dimensions {
        Some((src_w, src_h)) => src_w != payload.video.width || src_h != payload.video.height,
        None => payload.source.source_type == "window",
    };

    let mut command = Command::new(ffmpeg_exe);

    command
        .arg("-y")
        .arg("-loglevel")
        .arg("warning")
        .arg("-f")
        .arg("gdigrab")
        .arg("-thread_queue_size")
        .arg("2048")
        .arg("-framerate")
        .arg(format!("{}", payload.video.fps))
        .arg("-draw_mouse")
        .arg(draw_mouse);

    if payload.source.source_type == "screen" {
        if let Some(region) = &payload.capture_region {
            command
                .arg("-offset_x")
                .arg(format!("{}", region.x))
                .arg("-offset_y")
                .arg(format!("{}", region.y))
                .arg("-video_size")
                .arg(format!("{}x{}", region.width.max(1), region.height.max(1)));
        }
    }

    let (video_codec, encoder_args): (&str, Vec<&str>) = match payload.video.encoder.as_str() {
        "h264_nvenc" => ("h264_nvenc", vec!["-preset", "p4", "-tune", "ll", "-rc", "vbr", "-cq", "20"]),
        "hevc_nvenc" => ("hevc_nvenc", vec!["-preset", "p4", "-tune", "ll", "-rc", "vbr", "-cq", "22"]),
        "h264_amf" => ("h264_amf", vec!["-quality", "quality"]),
        _ => ("libx264", vec!["-preset", "medium", "-tune", "zerolatency"]),
    };

    if payload.source.source_type == "screen" {
        command.arg("-i").arg("desktop");
    } else if payload.source.source_type == "window" {
        return Err("window capture is handled by WGC path before FFmpeg command build".to_string());
    } else {
        return Err("unsupported source type".to_string());
    }

    if needs_scale {
        command
            .arg("-vf")
            .arg(format!("scale={}x{}", payload.video.width, payload.video.height));
    }

    command
        .arg("-r")
        .arg(format!("{}", payload.video.fps))
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-b:v")
        .arg(bitrate.as_str())
        .arg("-maxrate")
        .arg(bitrate.as_str())
        .arg("-bufsize")
        .arg(format!("{}", payload.video.bitrate.saturating_mul(3)))
        .arg("-g")
        .arg(format!("{}", (payload.video.fps.max(1)) * 2))
        .arg("-movflags")
        .arg("+faststart")
        .arg("-c:v")
        .arg(video_codec);

    for arg in encoder_args {
        command.arg(arg);
    }

    Ok(command)
}

fn build_encoder_args(encoder: &str) -> Vec<String> {
    match encoder {
        "h264_nvenc" => vec![
            "-preset".to_string(), "p4".to_string(),
            "-tune".to_string(), "ll".to_string(),
            "-rc".to_string(), "vbr".to_string(),
            "-cq".to_string(), "20".to_string(),
        ],
        "hevc_nvenc" => vec![
            "-preset".to_string(), "p4".to_string(),
            "-tune".to_string(), "ll".to_string(),
            "-rc".to_string(), "vbr".to_string(),
            "-cq".to_string(), "22".to_string(),
        ],
        "h264_amf" => vec!["-quality".to_string(), "quality".to_string()],
        _ => vec![
            "-preset".to_string(), "medium".to_string(),
            "-tune".to_string(), "zerolatency".to_string(),
        ],
    }
}
