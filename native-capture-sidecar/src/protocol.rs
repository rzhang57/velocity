use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
pub struct Request {
    pub id: String,
    pub cmd: String,
    #[serde(default)]
    pub payload: Value,
}

#[derive(Debug, Serialize)]
pub struct Response {
    pub id: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    pub fn ok(id: impl Into<String>, payload: Value) -> Self {
        Self {
            id: id.into(),
            ok: true,
            payload: Some(payload),
            error: None,
        }
    }

    pub fn err(id: impl Into<String>, msg: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            ok: false,
            payload: None,
            error: Some(msg.into()),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct StartCapturePayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub source: CaptureSource,
    pub video: VideoConfig,
    pub cursor: CursorConfig,
    #[serde(rename = "outputPath")]
    pub output_path: String,
    pub platform: String,
    #[serde(rename = "ffmpegPath")]
    pub ffmpeg_path: Option<String>,
    #[serde(rename = "captureRegion")]
    pub capture_region: Option<CaptureRegion>,
}

#[derive(Debug, Deserialize)]
pub struct EncoderOptionsPayload {
    pub platform: String,
    #[serde(rename = "ffmpegPath")]
    pub ffmpeg_path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CaptureSource {
    #[serde(rename = "type")]
    pub source_type: String,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VideoConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate: u32,
    #[serde(alias = "codec")]
    pub encoder: String,
}

#[derive(Debug, Deserialize)]
pub struct CursorConfig {
    pub mode: String,
}

#[derive(Debug, Deserialize)]
pub struct CaptureRegion {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Deserialize)]
pub struct StopCapturePayload {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[allow(dead_code)]
    pub finalize: Option<bool>,
}

pub fn init_response(id: impl Into<String>) -> Response {
    Response::ok(
        id,
        json!({
            "version": "0.2.0",
            "backend": "ffmpeg-gdigrab",
            "status": "ready"
        }),
    )
}
