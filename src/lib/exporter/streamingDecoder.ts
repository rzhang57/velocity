import { WebDemuxer } from 'web-demuxer';
import type { TrimRegion } from '@/components/video-editor/types';

export interface DecodedVideoInfo {
  width: number;
  height: number;
  duration: number; // seconds
  frameRate: number;
  codec: string;
  hasAudio: boolean;
  audioCodec?: string;
}

/** Caller must close the VideoFrame after use. */
type OnFrameCallback = (
  frame: VideoFrame,
  exportTimestampUs: number,
  sourceTimestampMs: number
) => Promise<void>;

type OnAudioChunkCallback = (
  chunk: EncodedAudioChunk
) => Promise<void>;

/**
 * Decodes video frames via web-demuxer + VideoDecoder in a single forward pass.
 * Way faster than seeking an HTMLVideoElement per frame.
 *
 * Frames in trimmed regions are decoded (needed for P/B-frame state) but discarded.
 * Non-trimmed frames get buffered per segment and resampled to the target frame rate.
 */
export class StreamingVideoDecoder {
  private demuxer: WebDemuxer | null = null;
  private decoder: VideoDecoder | null = null;
  private cancelled = false;
  private metadata: DecodedVideoInfo | null = null;

  async loadMetadata(videoUrl: string): Promise<DecodedVideoInfo> {
    const response = await fetch(videoUrl);
    const blob = await response.blob();
    const filename = videoUrl.split('/').pop() || 'video';
    const file = new File([blob], filename, { type: blob.type });

    // Relative URL so it resolves correctly in both dev (http) and packaged (file://) builds
    const wasmUrl = new URL('./wasm/web-demuxer.wasm', window.location.href).href;
    this.demuxer = new WebDemuxer({ wasmFilePath: wasmUrl });
    await this.demuxer.load(file);

    const mediaInfo = await this.demuxer.getMediaInfo();
    const videoStream = mediaInfo.streams.find(s => s.codec_type_string === 'video');
    const audioStream = mediaInfo.streams.find(s => s.codec_type_string === 'audio');

    let frameRate = 60;
    if (videoStream?.avg_frame_rate) {
      const parts = videoStream.avg_frame_rate.split('/');
      if (parts.length === 2) {
        const num = parseInt(parts[0], 10);
        const den = parseInt(parts[1], 10);
        if (den > 0 && num > 0) frameRate = num / den;
      }
    }

    this.metadata = {
      width: videoStream?.width || 1920,
      height: videoStream?.height || 1080,
      duration: mediaInfo.duration,
      frameRate,
      codec: videoStream?.codec_string || 'unknown',
      hasAudio: Boolean(audioStream),
      audioCodec: typeof audioStream?.codec_name === 'string'
        ? audioStream.codec_name
        : (typeof audioStream?.codec_string === 'string' ? audioStream.codec_string : undefined),
    };

    return this.metadata;
  }

  async decodeAll(
    targetFrameRate: number,
    trimRegions: TrimRegion[] | undefined,
    onFrame: OnFrameCallback
  ): Promise<void> {
    if (!this.demuxer || !this.metadata) {
      throw new Error('Must call loadMetadata() before decodeAll()');
    }

    const decoderConfig = await this.demuxer.getDecoderConfig('video');
    const segments = this.computeSegments(this.metadata.duration, trimRegions);
    const frameDurationUs = 1_000_000 / targetFrameRate;

    // Fast path: no trims means one contiguous segment. Stream frames immediately
    // instead of buffering the entire source before emitting output frames.
    if (!trimRegions || trimRegions.length === 0) {
      await this.decodeUntrimmed(decoderConfig, frameDurationUs, onFrame);
      return;
    }

    // Async frame queue — decoder pushes, consumer pulls
    const pendingFrames: VideoFrame[] = [];
    let frameResolve: ((frame: VideoFrame | null) => void) | null = null;
    let decodeError: Error | null = null;
    let decodeDone = false;

    this.decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        if (frameResolve) {
          const resolve = frameResolve;
          frameResolve = null;
          resolve(frame);
        } else {
          pendingFrames.push(frame);
        }
      },
      error: (e: DOMException) => {
        decodeError = new Error(`VideoDecoder error: ${e.message}`);
        if (frameResolve) {
          const resolve = frameResolve;
          frameResolve = null;
          resolve(null);
        }
      },
    });
    this.decoder.configure(decoderConfig);

    const getNextFrame = (): Promise<VideoFrame | null> => {
      if (decodeError) throw decodeError;
      if (pendingFrames.length > 0) return Promise.resolve(pendingFrames.shift()!);
      if (decodeDone) return Promise.resolve(null);
      return new Promise(resolve => { frameResolve = resolve; });
    };

    // One forward stream through the whole file
    const reader = this.demuxer.read('video').getReader();

    // Feed chunks to decoder in background with backpressure
    const feedPromise = (async () => {
      try {
        while (!this.cancelled) {
          const { done, value: chunk } = await reader.read();
          if (done || !chunk) break;

          while (this.decoder!.decodeQueueSize > 10 && !this.cancelled) {
            await new Promise(resolve => setTimeout(resolve, 1));
          }
          if (this.cancelled) break;

          this.decoder!.decode(chunk);
        }

        if (!this.cancelled && this.decoder!.state === 'configured') {
          await this.decoder!.flush();
        }
      } catch (e) {
        decodeError = e instanceof Error ? e : new Error(String(e));
      } finally {
        decodeDone = true;
        if (frameResolve) {
          const resolve = frameResolve;
          frameResolve = null;
          resolve(null);
        }
      }
    })();

    // Route decoded frames into segments by timestamp, then deliver with VFR→CFR resampling
    let segmentIdx = 0;
    let exportFrameIndex = 0;
    let segmentBuffer: VideoFrame[] = [];

    while (!this.cancelled && segmentIdx < segments.length) {
      const frame = await getNextFrame();
      if (!frame) break;

      const frameTimeSec = frame.timestamp / 1_000_000;
      const currentSegment = segments[segmentIdx];

      // Before current segment — trimmed or pre-video
      if (frameTimeSec < currentSegment.startSec - 0.001) {
        frame.close();
        continue;
      }

      // Past current segment — flush buffer and advance
      if (frameTimeSec >= currentSegment.endSec - 0.001) {
        exportFrameIndex = await this.deliverSegment(
          segmentBuffer, currentSegment, targetFrameRate, frameDurationUs, exportFrameIndex, onFrame
        );
        for (const f of segmentBuffer) f.close();
        segmentBuffer = [];

        segmentIdx++;
        while (segmentIdx < segments.length && frameTimeSec >= segments[segmentIdx].endSec - 0.001) {
          segmentIdx++;
        }

        if (segmentIdx < segments.length && frameTimeSec >= segments[segmentIdx].startSec - 0.001) {
          segmentBuffer.push(frame);
        } else {
          frame.close();
        }
        continue;
      }

      segmentBuffer.push(frame);
    }

    // Flush last segment
    if (segmentBuffer.length > 0 && segmentIdx < segments.length) {
      exportFrameIndex = await this.deliverSegment(
        segmentBuffer, segments[segmentIdx], targetFrameRate, frameDurationUs, exportFrameIndex, onFrame
      );
      for (const f of segmentBuffer) f.close();
    }

    // Drain leftover decoded frames
    while (!decodeDone) {
      const frame = await getNextFrame();
      if (!frame) break;
      frame.close();
    }

    try { reader.cancel(); } catch { /* already closed */ }
    await feedPromise;
    for (const f of pendingFrames) f.close();
    pendingFrames.length = 0;

    if (this.decoder?.state === 'configured') {
      this.decoder.close();
    }
    this.decoder = null;
  }

  async copyAudio(
    trimRegions: TrimRegion[] | undefined,
    onChunk: OnAudioChunkCallback
  ): Promise<void> {
    if (!this.demuxer || !this.metadata || !this.metadata.hasAudio) {
      return;
    }

    const segments = this.computeSegments(this.metadata.duration, trimRegions);
    if (segments.length === 0) {
      return;
    }
    const segmentUs = segments.map((segment) => ({
      startUs: Math.round(segment.startSec * 1_000_000),
      endUs: Math.round(segment.endSec * 1_000_000),
    }));
    const cumulativeOffsetUs: number[] = [];
    let cursorUs = 0;
    for (const segment of segmentUs) {
      cumulativeOffsetUs.push(cursorUs);
      cursorUs += Math.max(0, segment.endUs - segment.startUs);
    }

    const mapSourceToExportUs = (sourceUs: number): number | null => {
      for (let i = 0; i < segmentUs.length; i++) {
        const segment = segmentUs[i];
        if (sourceUs < segment.startUs) continue;
        if (sourceUs >= segment.endUs) continue;
        return cumulativeOffsetUs[i] + (sourceUs - segment.startUs);
      }
      return null;
    };

    const reader = this.demuxer.read('audio').getReader();
    try {
      while (!this.cancelled) {
        const { done, value } = await reader.read();
        if (done || !value) break;

        const chunk = value as EncodedAudioChunk;
        if (typeof chunk.timestamp !== 'number' || typeof chunk.byteLength !== 'number') {
          continue;
        }

        const sourceTimestampUs = chunk.timestamp;
        const durationUs = typeof chunk.duration === 'number' ? chunk.duration : 0;
        const samplePointUs = sourceTimestampUs + Math.floor(durationUs / 2);
        const mappedSampleUs = mapSourceToExportUs(samplePointUs);
        if (mappedSampleUs == null) {
          continue;
        }
        const mappedTimestampUs = Math.max(0, mappedSampleUs - Math.floor(durationUs / 2));

        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        const remappedChunk = new EncodedAudioChunk({
          type: chunk.type,
          timestamp: mappedTimestampUs,
          duration: durationUs > 0 ? durationUs : undefined,
          data: bytes,
        });

        await onChunk(remappedChunk);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // intentional: ignore reader cancel errors during cleanup
      }
    }
  }

  async getAudioDecoderConfig(): Promise<AudioDecoderConfig | null> {
    if (!this.demuxer || !this.metadata || !this.metadata.hasAudio) {
      return null;
    }

    const decoderConfig = await this.demuxer.getDecoderConfig('audio');
    return decoderConfig as AudioDecoderConfig;
  }

  private async decodeUntrimmed(
    decoderConfig: VideoDecoderConfig,
    frameDurationUs: number,
    onFrame: OnFrameCallback
  ): Promise<void> {
    if (!this.demuxer || !this.metadata) {
      throw new Error('Must call loadMetadata() before decodeUntrimmed()');
    }

    const durationUs = Math.max(0, Math.round(this.metadata.duration * 1_000_000));
    let nextEmitUs = 0;
    let exportFrameIndex = 0;
    let lastFrame: VideoFrame | null = null;
    let lastFrameTimestampUs = 0;

    const emitFrom = async (sourceFrame: VideoFrame, sourceTimestampUs: number) => {
      const clone = new VideoFrame(sourceFrame, { timestamp: sourceTimestampUs });
      await onFrame(clone, exportFrameIndex * frameDurationUs, sourceTimestampUs / 1000);
      exportFrameIndex++;
    };

    const pendingFrames: VideoFrame[] = [];
    let frameResolve: ((frame: VideoFrame | null) => void) | null = null;
    let decodeError: Error | null = null;
    let decodeDone = false;

    this.decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        if (frameResolve) {
          const resolve = frameResolve;
          frameResolve = null;
          resolve(frame);
        } else {
          pendingFrames.push(frame);
        }
      },
      error: (e: DOMException) => {
        decodeError = new Error(`VideoDecoder error: ${e.message}`);
        if (frameResolve) {
          const resolve = frameResolve;
          frameResolve = null;
          resolve(null);
        }
      },
    });
    this.decoder.configure(decoderConfig);

    const getNextFrame = (): Promise<VideoFrame | null> => {
      if (decodeError) throw decodeError;
      if (pendingFrames.length > 0) return Promise.resolve(pendingFrames.shift()!);
      if (decodeDone) return Promise.resolve(null);
      return new Promise(resolve => { frameResolve = resolve; });
    };

    const reader = this.demuxer.read('video').getReader();
    const feedPromise = (async () => {
      try {
        while (!this.cancelled) {
          const { done, value: chunk } = await reader.read();
          if (done || !chunk) break;
          while (this.decoder!.decodeQueueSize > 10 && !this.cancelled) {
            await new Promise(resolve => setTimeout(resolve, 1));
          }
          if (this.cancelled) break;
          this.decoder!.decode(chunk);
        }
        if (!this.cancelled && this.decoder!.state === 'configured') {
          await this.decoder!.flush();
        }
      } catch (e) {
        decodeError = e instanceof Error ? e : new Error(String(e));
      } finally {
        decodeDone = true;
        if (frameResolve) {
          const resolve = frameResolve;
          frameResolve = null;
          resolve(null);
        }
      }
    })();

    try {
      while (!this.cancelled) {
        const frame = await getNextFrame();
        if (!frame) break;

        const sourceTimestampUs = frame.timestamp;
        while (!this.cancelled && nextEmitUs <= sourceTimestampUs && nextEmitUs < durationUs) {
          await emitFrom(frame, sourceTimestampUs);
          nextEmitUs += frameDurationUs;
        }

        if (lastFrame) {
          lastFrame.close();
        }
        lastFrame = new VideoFrame(frame, { timestamp: sourceTimestampUs });
        lastFrameTimestampUs = sourceTimestampUs;
        frame.close();
      }

      while (!this.cancelled && lastFrame && nextEmitUs < durationUs) {
        await emitFrom(lastFrame, lastFrameTimestampUs);
        nextEmitUs += frameDurationUs;
      }

      while (!decodeDone) {
        const frame = await getNextFrame();
        if (!frame) break;
        frame.close();
      }
      await feedPromise;
      for (const frame of pendingFrames) frame.close();
      pendingFrames.length = 0;
    } finally {
      try { reader.cancel(); } catch { /* ignore */ }
      if (lastFrame) {
        lastFrame.close();
        lastFrame = null;
      }
      if (this.decoder?.state === 'configured') {
        this.decoder.close();
      }
      this.decoder = null;
    }
  }

  /**
   * Resample buffered frames to fill the target frame count for this segment.
   * Handles VFR sources by duplicating/decimating as needed.
   */
  private async deliverSegment(
    frames: VideoFrame[],
    segment: { startSec: number; endSec: number },
    targetFrameRate: number,
    frameDurationUs: number,
    startExportFrameIndex: number,
    onFrame: OnFrameCallback
  ): Promise<number> {
    if (frames.length === 0) return startExportFrameIndex;

    const segmentFrameCount = Math.ceil((segment.endSec - segment.startSec) * targetFrameRate);
    let exportFrameIndex = startExportFrameIndex;

    for (let i = 0; i < segmentFrameCount && !this.cancelled; i++) {
      const sourceIdx = Math.min(
        Math.floor(i * frames.length / segmentFrameCount),
        frames.length - 1
      );
      const sourceFrame = frames[sourceIdx];
      const clone = new VideoFrame(sourceFrame, { timestamp: sourceFrame.timestamp });
      await onFrame(clone, exportFrameIndex * frameDurationUs, sourceFrame.timestamp / 1000);
      exportFrameIndex++;
    }

    return exportFrameIndex;
  }

  private computeSegments(
    totalDuration: number,
    trimRegions?: TrimRegion[]
  ): Array<{ startSec: number; endSec: number }> {
    if (!trimRegions || trimRegions.length === 0) {
      return [{ startSec: 0, endSec: totalDuration }];
    }

    const sorted = [...trimRegions].sort((a, b) => a.startMs - b.startMs);
    const segments: Array<{ startSec: number; endSec: number }> = [];
    let cursor = 0;

    for (const trim of sorted) {
      const trimStart = trim.startMs / 1000;
      const trimEnd = trim.endMs / 1000;
      if (cursor < trimStart) {
        segments.push({ startSec: cursor, endSec: trimStart });
      }
      cursor = trimEnd;
    }

    if (cursor < totalDuration) {
      segments.push({ startSec: cursor, endSec: totalDuration });
    }

    return segments;
  }

  getEffectiveDuration(trimRegions?: TrimRegion[]): number {
    if (!this.metadata) throw new Error('Must call loadMetadata() first');
    const trimmed = (trimRegions || []).reduce(
      (sum, r) => sum + (r.endMs - r.startMs) / 1000, 0
    );
    return this.metadata.duration - trimmed;
  }

  cancel(): void {
    this.cancelled = true;
  }

  destroy(): void {
    this.cancelled = true;

    if (this.decoder) {
      try {
        if (this.decoder.state === 'configured') this.decoder.close();
      } catch { /* ignore */ }
      this.decoder = null;
    }

    if (this.demuxer) {
      try { this.demuxer.destroy(); } catch { /* intentional: ignore demuxer destroy errors */ }
      this.demuxer = null;
    }
  }
}
