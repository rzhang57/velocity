use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::capture::ActiveCapture;
use crate::ffmpeg::resolve_ffmpeg_path;
use crate::protocol::StartCapturePayload;

pub fn start_capture(start_payload: StartCapturePayload) -> Result<ActiveCapture, String> {
    if !cfg!(target_os = "macos") {
        return Err("darwin capture requested, but sidecar binary is not a macOS build".to_string());
    }

    if start_payload.source.source_type != "screen" {
        return Err("macOS native sidecar currently supports screen capture only".to_string());
    }

    if start_payload.video.encoder != "h264_libx264" {
        return Err("macOS native sidecar v1 supports h264_libx264 only".to_string());
    }

    let ffmpeg_exe = resolve_ffmpeg_path(start_payload.ffmpeg_path.as_deref());
    if ffmpeg_exe.is_none() {
        return Err(
            "ffmpeg executable not found (bundle native-capture-sidecar/bin/darwin/ffmpeg or install ffmpeg on PATH)".to_string(),
        );
    }
    let ffmpeg_exe = ffmpeg_exe.unwrap_or_else(|| "ffmpeg".to_string());
    let should_hide_native_cursor = start_payload.cursor.mode == "hide";

    let output_path = start_payload.output_path.clone();
    let mut command = build_ffmpeg_command(&ffmpeg_exe, &start_payload)?;

    command
        .arg(output_path.as_str())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = command
        .spawn()
        .map_err(|err| format!("failed to spawn ffmpeg: {err}"))?;
    let mut child = child;

    if should_hide_native_cursor {
        hide_cursor_globally();
    }

    thread::sleep(Duration::from_millis(350));
    match child.try_wait() {
        Ok(Some(status)) => {
            if should_hide_native_cursor {
                show_cursor_globally();
            }
            return Err(format!(
                "ffmpeg exited immediately during startup (status={status}). Confirm screen capture permissions and avfoundation input."
            ));
        }
        Ok(None) => {}
        Err(err) => {
            if should_hide_native_cursor {
                show_cursor_globally();
            }
            return Err(format!("failed to verify ffmpeg startup: {err}"));
        }
    }

    Ok(ActiveCapture {
        session_id: start_payload.session_id,
        output_path,
        width: start_payload.video.width,
        height: start_payload.video.height,
        fps: start_payload.video.fps,
        started_at: Instant::now(),
        platform: "darwin".to_string(),
        restore_cursor_on_stop: should_hide_native_cursor,
        child,
    })
}

fn build_ffmpeg_command(ffmpeg_exe: &str, payload: &StartCapturePayload) -> Result<Command, String> {
    let capture_cursor = if payload.cursor.mode == "hide" { "0" } else { "1" };
    let capture_mouse_clicks = if payload.cursor.mode == "hide" { "0" } else { "1" };
    let bitrate = format!("{}", payload.video.bitrate.max(1_000_000));

    let screen_index = payload
        .source
        .name
        .as_deref()
        .and_then(parse_screen_index_from_name)
        .or_else(|| {
            std::env::var("VELOCITY_MAC_SCREEN_INDEX")
                .ok()
                .and_then(|value| value.parse::<u32>().ok())
        })
        .unwrap_or(0);

    let mut command = Command::new(ffmpeg_exe);
    command
        .arg("-y")
        .arg("-f")
        .arg("avfoundation")
        .arg("-thread_queue_size")
        .arg("2048")
        .arg("-framerate")
        .arg(format!("{}", payload.video.fps))
        .arg("-capture_cursor")
        .arg(capture_cursor)
        .arg("-capture_mouse_clicks")
        .arg(capture_mouse_clicks)
        .arg("-i")
        .arg(format!("{screen_index}:none"));

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
        .arg("libx264")
        .arg("-preset")
        .arg("ultrafast")
        .arg("-tune")
        .arg("zerolatency");

    Ok(command)
}

fn parse_screen_index_from_name(name: &str) -> Option<u32> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(index) = trimmed.parse::<u32>() {
        return Some(index);
    }

    // Common label shape is "Screen 1", while avfoundation uses zero-based index.
    let digits: String = trimmed.chars().filter(|ch| ch.is_ascii_digit()).collect();
    let one_based = digits.parse::<u32>().ok()?;
    Some(one_based.saturating_sub(1))
}

pub fn restore_cursor_visibility() {
    show_cursor_globally();
}

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn CGMainDisplayID() -> u32;
    fn CGDisplayHideCursor(display: u32) -> i32;
    fn CGDisplayShowCursor(display: u32) -> i32;
}

fn hide_cursor_globally() {
    #[cfg(target_os = "macos")]
    unsafe {
        let display = CGMainDisplayID();
        let _ = CGDisplayHideCursor(display);
    }
}

fn show_cursor_globally() {
    #[cfg(target_os = "macos")]
    unsafe {
        let display = CGMainDisplayID();
        let _ = CGDisplayShowCursor(display);
    }
}
