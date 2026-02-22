use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::capture::ActiveCapture;
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

    thread::sleep(Duration::from_millis(350));
    match child.try_wait() {
        Ok(Some(status)) => {
            return Err(format!(
                "ffmpeg exited immediately during startup (status={status}). Try h264_libx264."
            ));
        }
        Ok(None) => {}
        Err(err) => {
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
        platform: "win32".to_string(),
        child,
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
