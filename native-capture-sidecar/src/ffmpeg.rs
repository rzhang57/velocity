use serde_json::json;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::protocol::{EncoderOptionsPayload, Response};
use crate::system::detect_gpu_vendors_windows;

pub fn resolve_ffmpeg_path(preferred: Option<&str>) -> Option<String> {
    if let Some(path) = preferred {
        if Path::new(path).exists() {
            return Some(path.to_string());
        }
    }

    let candidate = if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };

    let probe = Command::new(candidate)
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    if probe.is_ok() {
        Some(candidate.to_string())
    } else {
        None
    }
}

pub fn ffmpeg_has_encoder(ffmpeg_exe: &str, encoder_name: &str) -> bool {
    let output = Command::new(ffmpeg_exe)
        .arg("-hide_banner")
        .arg("-encoders")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    let output = match output {
        Ok(v) => v,
        Err(_) => return false,
    };

    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.stderr.is_empty() {
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    text.contains(encoder_name)
}

pub fn handle_get_encoder_options(id: String, payload: serde_json::Value) -> Response {
    let payload: EncoderOptionsPayload = match serde_json::from_value(payload) {
        Ok(v) => v,
        Err(err) => {
            return Response::err(id, format!("invalid get_encoder_options payload: {err}"));
        }
    };

    let mut options = vec![json!({
        "codec": "h264_libx264",
        "label": "x264 CPU",
        "hardware": "cpu",
    })];

    if payload.platform != "win32" {
        eprintln!(
            "[encoder-options][sidecar] Non-win32 platform={}, returning CPU-only option",
            payload.platform
        );
        return Response::ok(id, json!({ "options": options }));
    }

    let ffmpeg_exe = resolve_ffmpeg_path(payload.ffmpeg_path.as_deref());
    eprintln!(
        "[encoder-options][sidecar] ffmpeg_path_input={:?} resolved_ffmpeg={:?}",
        payload.ffmpeg_path, ffmpeg_exe
    );
    if let Some(ffmpeg_exe) = ffmpeg_exe {
        let gpu_vendors = detect_gpu_vendors_windows();
        eprintln!("[encoder-options][sidecar] gpu_vendor_detection={:?}", gpu_vendors);
        let has_nvenc = ffmpeg_has_encoder(&ffmpeg_exe, "h264_nvenc");
        let has_amf = ffmpeg_has_encoder(&ffmpeg_exe, "h264_amf");
        eprintln!(
            "[encoder-options][sidecar] encoder_detection ffmpeg={} h264_nvenc={} h264_amf={}",
            ffmpeg_exe, has_nvenc, has_amf
        );
        let allow_nvenc = match gpu_vendors {
            Some((has_nvidia_gpu, _)) => has_nvidia_gpu,
            None => true,
        };
        let allow_amf = match gpu_vendors {
            Some((_, has_amd_gpu)) => has_amd_gpu,
            None => true,
        };
        eprintln!(
            "[encoder-options][sidecar] encoder_gating allow_nvenc={} allow_amf={}",
            allow_nvenc, allow_amf
        );
        if has_nvenc && allow_nvenc {
            options.push(json!({
                "codec": "h264_nvenc",
                "label": "NVIDIA H264 (GPU)",
                "hardware": "nvidia",
            }));
        }
        if has_amf && allow_amf {
            options.push(json!({
                "codec": "h264_amf",
                "label": "AMD H264",
                "hardware": "amd",
            }));
        }
    }
    eprintln!("[encoder-options][sidecar] returning options={}", json!({ "options": options }));

    Response::ok(id, json!({ "options": options }))
}
