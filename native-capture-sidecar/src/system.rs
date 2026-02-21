use std::process::{Command, Stdio};

pub fn detect_gpu_vendors_windows() -> Option<(bool, bool)> {
    if !cfg!(target_os = "windows") {
        return None;
    }

    let output = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-Command")
        .arg("Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()?;

    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    if !output.stderr.is_empty() {
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    if text.trim().is_empty() {
        return None;
    }

    let lower = text.to_lowercase();
    let has_nvidia = lower.contains("nvidia");
    let has_amd = lower.contains("amd") || lower.contains("radeon");
    Some((has_nvidia, has_amd))
}
