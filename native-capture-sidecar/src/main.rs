use serde_json::json;
use std::io::{self, BufRead, Write};

mod capture;
mod ffmpeg;
mod protocol;
mod system;

use capture::{handle_start, handle_stop};
use ffmpeg::handle_get_encoder_options;
use protocol::{init_response, Request, Response};

fn main() {
    eprintln!(
        "[native-capture][sidecar] boot pid={} platform={} ready_for_stdio_protocol=true",
        std::process::id(),
        std::env::consts::OS
    );

    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut active_capture = None;

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(v) => v,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }

        let request: Request = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(err) => {
                let _ = writeln!(
                    stdout,
                    "{}",
                    json!({
                        "ok": false,
                        "error": format!("invalid request json: {err}")
                    })
                );
                let _ = stdout.flush();
                continue;
            }
        };

        let response = match request.cmd.as_str() {
            "init" => init_response(&request.id),
            "get_encoder_options" => handle_get_encoder_options(request.id.clone(), request.payload),
            "start_capture" => handle_start(request.id.clone(), request.payload, &mut active_capture),
            "stop_capture" => handle_stop(request.id.clone(), request.payload, &mut active_capture),
            _ => Response::err(&request.id, format!("unknown command: {}", request.cmd)),
        };

        if request.cmd == "init" || request.cmd == "get_encoder_options" {
            eprintln!(
                "[native-capture][sidecar] cmd={} id={} ok={}",
                request.cmd, request.id, response.ok
            );
        }

        if writeln!(
            stdout,
            "{}",
            serde_json::to_string(&response)
                .unwrap_or_else(|_| "{\"ok\":false,\"error\":\"serialize failed\"}".to_string())
        )
        .is_err()
        {
            continue;
        }
        let _ = stdout.flush();
    }
}
