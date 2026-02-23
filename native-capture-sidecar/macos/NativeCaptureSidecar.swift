import Foundation
import AVFoundation
import CoreMedia
import CoreVideo
import ScreenCaptureKit
import AppKit

typealias JsonObject = [String: Any]

private func logSidecar(_ message: String) {
    fputs("[native-capture][sck][sidecar] \(message)\n", stderr)
    fflush(stderr)
}

struct SidecarError: Error {
    let message: String
    init(_ message: String) {
        self.message = message
    }
}

private struct SidecarRequest {
    let id: String
    let cmd: String
    let payload: JsonObject
}

private enum SidecarCommand: String {
    case `init` = "init"
    case getEncoderOptions = "get_encoder_options"
    case startCapture = "start_capture"
    case stopCapture = "stop_capture"
}

private func describeNSError(_ error: Error?) -> String {
    guard let nsError = error as NSError? else {
        return "unknown"
    }
    let domain = nsError.domain
    let code = nsError.code
    let message = nsError.localizedDescription
    return "\(domain)(\(code)): \(message)"
}

final class CaptureSession: NSObject, SCStreamOutput {
    let sessionId: String
    let outputPath: String
    var width: Int
    var height: Int
    let fps: Int
    let bitrate: Int
    let displayId: UInt32?
    let windowId: UInt32?
    let sourceType: String
    let showCursor: Bool
    var sourceBounds: CGRect?

    private var stream: SCStream?
    private var writer: AVAssetWriter?
    private var writerInput: AVAssetWriterInput?
    private var firstFramePTS: CMTime?
    private var hasWrittenFrame = false
    private var didReceiveFirstFrame = false
    private var didLogFirstFrameMetadata = false
    private let sampleQueue = DispatchQueue(label: "velocity.sck.samples")
    private let startedAt = Date()

    init(
        sessionId: String,
        outputPath: String,
        width: Int,
        height: Int,
        fps: Int,
        bitrate: Int,
        sourceType: String,
        displayId: UInt32?,
        windowId: UInt32?,
        showCursor: Bool
    ) {
        self.sessionId = sessionId
        self.outputPath = outputPath
        self.width = max(2, (width / 2) * 2)
        self.height = max(2, (height / 2) * 2)
        self.fps = max(1, fps)
        self.bitrate = max(1_000_000, bitrate)
        self.sourceType = sourceType
        self.displayId = displayId
        self.windowId = windowId
        self.showCursor = showCursor
    }

    func start(completion: @escaping (Result<Void, SidecarError>) -> Void) {
        logSidecar("start requested sessionId=\(sessionId) width=\(width) height=\(height) fps=\(fps) showCursor=\(showCursor)")
        if #available(macOS 13.0, *) {
            Task {
                do {
                    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                    let filter = try resolveContentFilter(content)

                    try prepareWriter()
                    let config = makeStreamConfiguration()
                    let stream = SCStream(filter: filter, configuration: config, delegate: nil)
                    logSidecar("stream config sessionId=\(sessionId) sourceType=\(sourceType) width=\(config.width) height=\(config.height) fps=\(fps) scalesToFit=\(config.scalesToFit)")
                    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleQueue)

                    guard let writer = writer else {
                        completion(.failure(SidecarError("AVAssetWriter unavailable")))
                        return
                    }
                    if !writer.startWriting() {
                        completion(.failure(SidecarError(writer.error?.localizedDescription ?? "Failed to start AVAssetWriter")))
                        return
                    }

                    self.stream = stream
                    try await stream.startCapture()
                    let firstFrameReady = await self.waitForFirstFrame(timeoutMs: 3000)
                    if !firstFrameReady {
                        logSidecar("start capture failed sessionId=\(self.sessionId) reason=no_frames_within_timeout")
                        try? await stream.stopCapture()
                        completion(.failure(SidecarError("No frames received from ScreenCaptureKit. Check screen recording permission and source selection.")))
                        return
                    }
                    let target = sourceType == "window"
                        ? "windowId=\(windowId.map(String.init) ?? "unknown")"
                        : "displayId=\(displayId.map(String.init) ?? "default")"
                    logSidecar("start capture succeeded sessionId=\(sessionId) \(target)")
                    completion(.success(()))
                } catch let error as SidecarError {
                    logSidecar("start capture failed sessionId=\(sessionId) error=\(error.message)")
                    completion(.failure(error))
                } catch {
                    logSidecar("start capture failed sessionId=\(sessionId) error=\(error.localizedDescription)")
                    completion(.failure(SidecarError(error.localizedDescription)))
                }
            }
        } else {
            logSidecar("start rejected: macOS version unsupported")
            completion(.failure(SidecarError("ScreenCaptureKit requires macOS 13+")))
        }
    }

    func stop(completion: @escaping (Result<JsonObject, SidecarError>) -> Void) {
        logSidecar("stop requested sessionId=\(sessionId)")
        if #available(macOS 13.0, *) {
            Task {
                if let stream = self.stream {
                    do {
                        try await stream.stopCapture()
                    } catch {
                        // Continue to finalize writer even if stopCapture throws.
                    }
                }
                self.stream = nil

                guard let writer = writer, let writerInput = writerInput else {
                    completion(.failure(SidecarError("Capture writer is not initialized")))
                    return
                }

                writerInput.markAsFinished()

                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    writer.finishWriting {
                        continuation.resume()
                    }
                }

                if writer.status == .failed {
                    let bytes = (try? FileManager.default.attributesOfItem(atPath: outputPath)[.size] as? NSNumber)?.uint64Value ?? 0
                    if bytes > 0 {
                        logSidecar("stop writer failed but output exists sessionId=\(sessionId) bytes=\(bytes) error=\(describeNSError(writer.error))")
                        let durationMs = UInt64(max(0, Date().timeIntervalSince(startedAt) * 1000))
                        completion(.success(makeStopPayload(durationMs: durationMs, bytes: bytes)))
                        return
                    }
                    if !hasWrittenFrame {
                        logSidecar("stop failed sessionId=\(sessionId) writerStatus=failed reason=no_frames_written error=\(describeNSError(writer.error))")
                        completion(.failure(SidecarError("No frames were written. Check screen recording permission and selected source.")))
                        return
                    }
                    logSidecar("stop failed sessionId=\(sessionId) writerStatus=failed error=\(describeNSError(writer.error))")
                    completion(.failure(SidecarError(writer.error?.localizedDescription ?? "Failed to finalize capture output")))
                    return
                }

                let bytes = (try? FileManager.default.attributesOfItem(atPath: outputPath)[.size] as? NSNumber)?.uint64Value ?? 0
                let durationMs = UInt64(max(0, Date().timeIntervalSince(startedAt) * 1000))
                logSidecar("stop completed sessionId=\(sessionId) durationMs=\(durationMs) bytes=\(bytes) outputPath=\(outputPath)")
                completion(.success(makeStopPayload(durationMs: durationMs, bytes: bytes)))
            }
        } else {
            logSidecar("stop rejected: macOS version unsupported")
            completion(.failure(SidecarError("ScreenCaptureKit requires macOS 13+")))
        }
    }

    @available(macOS 13.0, *)
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .screen else { return }
        guard CMSampleBufferIsValid(sampleBuffer) else { return }
        if let attachmentsArray = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
            as? [[SCStreamFrameInfo: Any]],
           let attachments = attachmentsArray.first,
           let statusRaw = attachments[SCStreamFrameInfo.status] as? Int,
           let status = SCFrameStatus(rawValue: statusRaw),
           status != .complete {
            return
        }
        guard let writer = writer, let input = writerInput else { return }
        guard writer.status == .writing else { return }

        if !didLogFirstFrameMetadata {
            let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
            let pixelWidth = imageBuffer.map(CVPixelBufferGetWidth) ?? 0
            let pixelHeight = imageBuffer.map(CVPixelBufferGetHeight) ?? 0
            let contentRectDescription: String = {
                guard let attachmentsArray = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
                        as? [[SCStreamFrameInfo: Any]],
                      let attachments = attachmentsArray.first,
                      let rawRect = attachments[SCStreamFrameInfo.contentRect] else {
                    return "none"
                }
                if let rect = rawRect as? CGRect {
                    return "{{x:\(Int(rect.origin.x)), y:\(Int(rect.origin.y)), w:\(Int(rect.size.width)), h:\(Int(rect.size.height))}}"
                }
                if let dict = rawRect as? NSDictionary,
                   let rect = CGRect(dictionaryRepresentation: dict) {
                    return "{{x:\(Int(rect.origin.x)), y:\(Int(rect.origin.y)), w:\(Int(rect.size.width)), h:\(Int(rect.size.height))}}"
                }
                return String(describing: rawRect)
            }()
            logSidecar("first frame metadata sessionId=\(sessionId) pixelBuffer=\(pixelWidth)x\(pixelHeight) contentRect=\(contentRectDescription)")
            didLogFirstFrameMetadata = true
        }

        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if firstFramePTS == nil {
            firstFramePTS = pts
            writer.startSession(atSourceTime: pts)
        }

        if input.isReadyForMoreMediaData {
            let appended = input.append(sampleBuffer)
            if appended {
                hasWrittenFrame = true
                didReceiveFirstFrame = true
            } else {
                logSidecar("sample append failed sessionId=\(sessionId) error=\(describeNSError(writer.error))")
            }
        }
    }

    private func prepareWriter() throws {
        let outputUrl = URL(fileURLWithPath: outputPath)
        let parent = outputUrl.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: outputPath) {
            try FileManager.default.removeItem(atPath: outputPath)
        }

        let writer = try AVAssetWriter(outputURL: outputUrl, fileType: .mp4)
        let compression: [String: Any] = [
            AVVideoAverageBitRateKey: bitrate,
            AVVideoExpectedSourceFrameRateKey: fps,
            AVVideoMaxKeyFrameIntervalKey: fps * 2,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        ]
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: compression,
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else {
            throw NSError(domain: "velocity.sck", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unable to attach video input to writer"])
        }
        writer.add(input)

        self.writer = writer
        self.writerInput = input
        self.firstFramePTS = nil
        self.hasWrittenFrame = false
        self.didReceiveFirstFrame = false
        self.didLogFirstFrameMetadata = false
    }

    @available(macOS 13.0, *)
    private func resolveContentFilter(_ content: SCShareableContent) throws -> SCContentFilter {
        if sourceType == "window" {
            guard let windowId else {
                throw SidecarError("Window capture requires source.id")
            }
            guard let window = pickWindow(from: content.windows, preferredWindowId: windowId) else {
                throw SidecarError("Selected window not available for capture")
            }
            sourceBounds = window.frame
            width = evenDimension(Int(window.frame.width.rounded()))
            height = evenDimension(Int(window.frame.height.rounded()))
            logSidecar("window source selected sessionId=\(sessionId) windowId=\(window.windowID) frame=\(window.frame)")
            return SCContentFilter(desktopIndependentWindow: window)
        }

        guard let display = pickDisplay(from: content.displays, preferredDisplayId: displayId) else {
            throw SidecarError("No capturable display found")
        }
        return SCContentFilter(display: display, excludingWindows: [])
    }

    private func makeStreamConfiguration() -> SCStreamConfiguration {
        let config = SCStreamConfiguration()
        config.width = width
        config.height = height
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        config.queueDepth = 8
        config.showsCursor = showCursor
        config.capturesAudio = false
        config.pixelFormat = kCVPixelFormatType_32BGRA
        return config
    }

    private func makeStopPayload(durationMs: UInt64, bytes: UInt64) -> JsonObject {
        [
            "outputPath": outputPath,
            "durationMs": durationMs,
            "width": width,
            "height": height,
            "fpsActual": fps,
            "bytes": bytes,
            "sourceBounds": sourceBounds.map { bounds in
                [
                    "x": Int(bounds.origin.x.rounded()),
                    "y": Int(bounds.origin.y.rounded()),
                    "width": Int(bounds.size.width.rounded()),
                    "height": Int(bounds.size.height.rounded()),
                ]
            } as Any
        ]
    }

    private func waitForFirstFrame(timeoutMs: Int) async -> Bool {
        let deadlineNs = UInt64(max(100, timeoutMs)) * 1_000_000
        let stepNs: UInt64 = 25_000_000
        var elapsedNs: UInt64 = 0
        while elapsedNs < deadlineNs {
            if didReceiveFirstFrame { return true }
            try? await Task.sleep(nanoseconds: stepNs)
            elapsedNs += stepNs
        }
        return didReceiveFirstFrame
    }
}

private func evenDimension(_ value: Int) -> Int {
    let rounded = max(2, value)
    return rounded - (rounded % 2)
}

@available(macOS 13.0, *)
private func pickDisplay(from displays: [SCDisplay], preferredDisplayId: UInt32?) -> SCDisplay? {
    if let preferredDisplayId, let match = displays.first(where: { $0.displayID == preferredDisplayId }) {
        return match
    }
    return displays.first
}

@available(macOS 13.0, *)
private func pickWindow(from windows: [SCWindow], preferredWindowId: UInt32) -> SCWindow? {
    windows.first(where: { $0.windowID == preferredWindowId })
}

private func writeResponse(id: String, ok: Bool, payload: JsonObject? = nil, error: String? = nil) {
    var out: JsonObject = [
        "id": id,
        "ok": ok,
    ]
    if let payload { out["payload"] = payload }
    if let error { out["error"] = error }
    if let data = try? JSONSerialization.data(withJSONObject: out, options: []),
       let line = String(data: data, encoding: .utf8) {
        fputs(line + "\n", stdout)
        fflush(stdout)
    }
}

private func parseRequest(_ line: String) -> SidecarRequest? {
    guard let data = line.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data, options: []),
          let dict = obj as? JsonObject,
          let id = dict["id"] as? String,
          let cmd = dict["cmd"] as? String else {
        return nil
    }
    let payload = dict["payload"] as? JsonObject ?? [:]
    return SidecarRequest(id: id, cmd: cmd, payload: payload)
}

private func stringValue(_ value: Any?) -> String? {
    if let s = value as? String { return s }
    return nil
}

private func intValue(_ value: Any?) -> Int? {
    if let i = value as? Int { return i }
    if let n = value as? NSNumber { return n.intValue }
    if let s = value as? String, let i = Int(s) { return i }
    return nil
}

private func uint32Value(_ value: Any?) -> UInt32? {
    if let n = intValue(value), n >= 0 {
        return UInt32(n)
    }
    return nil
}

private func parseElectronWindowId(_ value: Any?) -> UInt32? {
    guard let sourceId = stringValue(value), sourceId.hasPrefix("window:") else {
        return nil
    }
    let parts = sourceId.split(separator: ":")
    guard parts.count >= 2, let id = UInt32(parts[1]) else {
        return nil
    }
    return id
}

private struct StartCaptureRequest {
    let sessionId: String
    let outputPath: String
    let sourceType: String
    let width: Int
    let height: Int
    let fps: Int
    let bitrate: Int
    let sourceDisplayId: UInt32?
    let sourceWindowId: UInt32?
    let showCursor: Bool

    static func parse(_ payload: JsonObject) -> StartCaptureRequest? {
        guard let sessionId = stringValue(payload["sessionId"]),
              let outputPath = stringValue(payload["outputPath"]),
              let source = payload["source"] as? JsonObject,
              let sourceType = stringValue(source["type"]),
              (sourceType == "screen" || sourceType == "window"),
              let video = payload["video"] as? JsonObject,
              let width = intValue(video["width"]),
              let height = intValue(video["height"]),
              let fps = intValue(video["fps"]),
              let bitrate = intValue(video["bitrate"]) else {
            return nil
        }
        let sourceWindowId = parseElectronWindowId(source["id"])
        if sourceType == "window" && sourceWindowId == nil {
            return nil
        }
        let sourceDisplayId = uint32Value(source["displayId"])
        let cursor = payload["cursor"] as? JsonObject
        let showCursor = (stringValue(cursor?["mode"]) ?? "system") != "hide"
        return StartCaptureRequest(
            sessionId: sessionId,
            outputPath: outputPath,
            sourceType: sourceType,
            width: width,
            height: height,
            fps: fps,
            bitrate: bitrate,
            sourceDisplayId: sourceDisplayId,
            sourceWindowId: sourceWindowId,
            showCursor: showCursor
        )
    }
}

private struct StopCaptureRequest {
    let sessionId: String

    static func parse(_ payload: JsonObject) -> StopCaptureRequest? {
        guard let sessionId = stringValue(payload["sessionId"]) else {
            return nil
        }
        return StopCaptureRequest(sessionId: sessionId)
    }
}

private final class SidecarCommandProcessor {
    private var activeCapture: CaptureSession?

    func process(_ request: SidecarRequest) {
        guard let command = SidecarCommand(rawValue: request.cmd) else {
            writeResponse(id: request.id, ok: false, error: "unknown command: \(request.cmd)")
            return
        }

        switch command {
        case .`init`:
            handleInit(request.id)
        case .getEncoderOptions:
            handleGetEncoderOptions(request.id)
        case .startCapture:
            handleStartCapture(request.id, payload: request.payload)
        case .stopCapture:
            handleStopCapture(request.id, payload: request.payload)
        }
    }

    private func handleInit(_ id: String) {
        logSidecar("cmd=init id=\(id)")
        writeResponse(
            id: id,
            ok: true,
            payload: [
                "version": "0.3.0",
                "backend": "screencapturekit-avassetwriter",
                "status": "ready",
            ]
        )
    }

    private func handleGetEncoderOptions(_ id: String) {
        logSidecar("cmd=get_encoder_options id=\(id)")
        writeResponse(
            id: id,
            ok: true,
            payload: [
                "options": [
                    [
                        "codec": "h264_libx264",
                        "label": "H264 (ScreenCaptureKit)",
                        "hardware": "cpu",
                    ],
                ],
            ]
        )
    }

    private func handleStartCapture(_ id: String, payload: JsonObject) {
        logSidecar("cmd=start_capture id=\(id)")
        if activeCapture != nil {
            writeResponse(id: id, ok: false, error: "capture already running")
            return
        }
        guard let parsed = StartCaptureRequest.parse(payload) else {
            writeResponse(id: id, ok: false, error: "invalid start_capture payload")
            return
        }
        if parsed.sourceType == "window" && parsed.sourceWindowId == nil {
            writeResponse(id: id, ok: false, error: "window capture requires source.id (window:<id>:...)")
            return
        }

        let capture = CaptureSession(
            sessionId: parsed.sessionId,
            outputPath: parsed.outputPath,
            width: parsed.width,
            height: parsed.height,
            fps: parsed.fps,
            bitrate: parsed.bitrate,
            sourceType: parsed.sourceType,
            displayId: parsed.sourceDisplayId,
            windowId: parsed.sourceWindowId,
            showCursor: parsed.showCursor
        )

        let sem = DispatchSemaphore(value: 0)
        var startResult: Result<Void, SidecarError> = .failure(SidecarError("capture did not start"))
        capture.start { result in
            startResult = result
            sem.signal()
        }
        sem.wait()

        switch startResult {
        case .success:
            activeCapture = capture
            writeResponse(
                id: id,
                ok: true,
                payload: [
                    "status": "recording",
                    "outputPath": parsed.outputPath,
                ]
            )
        case .failure(let error):
            writeResponse(id: id, ok: false, error: error.message)
        }
    }

    private func handleStopCapture(_ id: String, payload: JsonObject) {
        logSidecar("cmd=stop_capture id=\(id)")
        guard let parsed = StopCaptureRequest.parse(payload) else {
            writeResponse(id: id, ok: false, error: "invalid stop_capture payload")
            return
        }
        guard let capture = activeCapture else {
            writeResponse(id: id, ok: false, error: "capture is not running")
            return
        }
        guard capture.sessionId == parsed.sessionId else {
            writeResponse(id: id, ok: false, error: "sessionId mismatch")
            return
        }

        let sem = DispatchSemaphore(value: 0)
        var stopResult: Result<JsonObject, SidecarError> = .failure(SidecarError("capture did not stop"))
        capture.stop { result in
            stopResult = result
            sem.signal()
        }
        sem.wait()
        activeCapture = nil

        switch stopResult {
        case .success(let payload):
            writeResponse(id: id, ok: true, payload: payload)
        case .failure(let error):
            writeResponse(id: id, ok: false, error: error.message)
        }
    }
}

private func bootstrapAppKitForScreenCapture() {
    _ = NSApplication.shared
    NSApp.setActivationPolicy(.prohibited)
}

bootstrapAppKitForScreenCapture()
private let processor = SidecarCommandProcessor()

while let rawLine = readLine() {
    let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
    if line.isEmpty { continue }

    guard let request = parseRequest(line) else {
        writeResponse(id: "unknown", ok: false, error: "invalid request json")
        continue
    }
    processor.process(request)
}
