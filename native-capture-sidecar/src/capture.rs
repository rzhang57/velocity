use serde_json::json;
use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::ffmpeg::resolve_ffmpeg_path;
use crate::protocol::{Response, StartCapturePayload, StopCapturePayload};

pub struct ActiveCapture {
    pub session_id: String,
    pub output_path: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub started_at: Instant,
    pub child: Child,
}

pub fn handle_start(
    id: String,
    payload: serde_json::Value,
    active_capture: &mut Option<ActiveCapture>,
) -> Response {
    if active_capture.is_some() {
        return Response::err(id, "capture already running");
    }

    let start_payload: StartCapturePayload = match serde_json::from_value(payload) {
        Ok(v) => v,
        Err(err) => {
            return Response::err(id, format!("invalid start_capture payload: {err}"));
        }
    };

    if start_payload.platform != "win32" {
        return Response::err(
            id,
            "native sidecar backend currently implemented for Windows only",
        );
    }

    if start_payload.video.width == 0
        || start_payload.video.height == 0
        || start_payload.video.fps == 0
    {
        return Response::err(id, "invalid video dimensions/fps");
    }

    let ffmpeg_exe = resolve_ffmpeg_path(start_payload.ffmpeg_path.as_deref());
    if ffmpeg_exe.is_none() {
        return Response::err(
            id,
            "ffmpeg executable not found (bundle native-capture-sidecar/bin/win32/ffmpeg.exe or install ffmpeg on PATH)",
        );
    }
    let ffmpeg_exe = ffmpeg_exe.unwrap_or_else(|| "ffmpeg".to_string());

    let output_path = start_payload.output_path.clone();

    let mut command = match build_ffmpeg_command(&ffmpeg_exe, &start_payload) {
        Ok(cmd) => cmd,
        Err(msg) => return Response::err(id, msg),
    };

    command
        .arg(output_path.as_str())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = match command.spawn() {
        Ok(c) => c,
        Err(err) => {
            return Response::err(id, format!("failed to spawn ffmpeg: {err}"));
        }
    };
    let mut child = child;

    // Detect immediate ffmpeg startup failures (for example unavailable NVENC encoder)
    // so the renderer can fail fast instead of opening an unreadable output file.
    thread::sleep(Duration::from_millis(350));
    match child.try_wait() {
        Ok(Some(status)) => {
            return Response::err(
                id,
                format!(
                    "ffmpeg exited immediately during startup (status={status}). Try h264_libx264."
                ),
            );
        }
        Ok(None) => {}
        Err(err) => {
            return Response::err(id, format!("failed to verify ffmpeg startup: {err}"));
        }
    }

    *active_capture = Some(ActiveCapture {
        session_id: start_payload.session_id,
        output_path: output_path.clone(),
        width: start_payload.video.width,
        height: start_payload.video.height,
        fps: start_payload.video.fps,
        started_at: Instant::now(),
        child,
    });

    Response::ok(
        id,
        json!({
            "status": "recording",
            "outputPath": output_path,
        }),
    )
}

pub fn handle_stop(
    id: String,
    payload: serde_json::Value,
    active_capture: &mut Option<ActiveCapture>,
) -> Response {
    let stop_payload: StopCapturePayload = match serde_json::from_value(payload) {
        Ok(v) => v,
        Err(err) => {
            return Response::err(id, format!("invalid stop_capture payload: {err}"));
        }
    };

    let mut capture = match active_capture.take() {
        Some(v) => v,
        None => {
            return Response::err(id, "capture is not running");
        }
    };

    if capture.session_id != stop_payload.session_id {
        *active_capture = Some(capture);
        return Response::err(id, "sessionId mismatch");
    }

    if let Some(stdin) = capture.child.stdin.as_mut() {
        let _ = stdin.write_all(b"q\n");
        let _ = stdin.flush();
    }

    let wait_deadline = Instant::now() + Duration::from_secs(8);
    loop {
        match capture.child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) => {
                if Instant::now() >= wait_deadline {
                    let _ = capture.child.kill();
                    let _ = capture.child.wait();
                    break;
                }
                thread::sleep(Duration::from_millis(60));
            }
            Err(_) => break,
        }
    }

    let duration_ms = capture.started_at.elapsed().as_millis() as u64;
    let bytes = std::fs::metadata(&capture.output_path)
        .map(|m| m.len())
        .unwrap_or(0);

    Response::ok(
        id,
        json!({
            "outputPath": capture.output_path,
            "durationMs": duration_ms,
            "width": capture.width,
            "height": capture.height,
            "fpsActual": capture.fps,
            "bytes": bytes,
        }),
    )
}

fn build_ffmpeg_command(
    ffmpeg_exe: &str,
    payload: &StartCapturePayload,
) -> Result<Command, String> {
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
    #[cfg(target_os = "windows")]
    {
        const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
        command.creation_flags(BELOW_NORMAL_PRIORITY_CLASS);
    }
    command
        .arg("-y")
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
        "h264_nvenc" => ("h264_nvenc", vec!["-preset", "p2", "-tune", "ll", "-rc", "vbr", "-cq", "27"]),
        "hevc_nvenc" => ("hevc_nvenc", vec!["-preset", "p2", "-tune", "ll", "-rc", "vbr", "-cq", "29"]),
        "h264_amf" => ("h264_amf", vec![]),
        _ => ("libx264", vec!["-preset", "ultrafast", "-tune", "zerolatency"]),
    };

    if payload.source.source_type == "screen" {
        command.arg("-i").arg("desktop");
    } else if payload.source.source_type == "window" {
        let window_name = payload.source.name.clone().unwrap_or_default();
        if window_name.trim().is_empty() {
            return Err("window capture requires source.name in payload".to_string());
        }
        command.arg("-i").arg(format!("title={window_name}"));
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
