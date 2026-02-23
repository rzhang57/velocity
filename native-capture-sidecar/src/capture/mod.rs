use serde_json::json;
use std::io::Write;
use std::thread;
use std::time::{Duration, Instant};

use crate::protocol::{Response, StartCapturePayload, StopCapturePayload};

mod macos;
mod windows;

pub struct ActiveCapture {
    pub session_id: String,
    pub output_path: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub started_at: Instant,
    pub platform: String,
    pub restore_cursor_on_stop: bool,
    pub child: std::process::Child,
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

    if start_payload.video.width == 0
        || start_payload.video.height == 0
        || start_payload.video.fps == 0
    {
        return Response::err(id, "invalid video dimensions/fps");
    }

    let start_result = match start_payload.platform.as_str() {
        "win32" => windows::start_capture(start_payload),
        "darwin" => macos::start_capture(start_payload),
        platform => Err(format!("unsupported platform for native capture: {platform}")),
    };

    match start_result {
        Ok(capture) => {
            let output_path = capture.output_path.clone();
            *active_capture = Some(capture);
            Response::ok(
                id,
                json!({
                    "status": "recording",
                    "outputPath": output_path,
                }),
            )
        }
        Err(message) => Response::err(id, message),
    }
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

    if capture.platform == "darwin" && capture.restore_cursor_on_stop {
        macos::restore_cursor_visibility();
    }

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
