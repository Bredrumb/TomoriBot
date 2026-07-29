/**
 * Generates Discord voice message metadata (waveform + duration) from an audio buffer.
 *
 * Discord's native voice message UI requires two extra fields on the attachment:
 *   - `waveform`      — base64-encoded uint8 array of ~100 amplitude samples
 *   - `duration_secs` — audio duration in seconds
 *
 * Duration is parsed from the audio header via music-metadata (pure JS, <5ms).
 * Waveform is computed by decoding the audio to raw PCM via ffmpeg-static
 * (bundled binary, no system install required) and downsampling the amplitude.
 *
 * Returns null on any failure — callers should fall back to a plain attachment.
 */

import ffmpegPath from "ffmpeg-static";
import { parseBuffer } from "music-metadata";
import { log } from "@/utils/misc/logger";

/** Number of amplitude samples in the Discord waveform visualization. */
const WAVEFORM_SAMPLES = 100;

/** Maximum time to wait for the ffmpeg subprocess to finish. */
const FFMPEG_TIMEOUT_MS =
  Number.parseInt(process.env.VOICE_WAVEFORM_TIMEOUT_MS ?? "", 10) > 0
    ? Number.parseInt(process.env.VOICE_WAVEFORM_TIMEOUT_MS ?? "", 10)
    : 5_000;

export interface VoiceMessageMetadata {
  /** Base64-encoded uint8 array of amplitude samples (100 values, 0–255). */
  waveform: string;
  /** Audio duration in seconds. */
  durationSecs: number;
}

/**
 * Generates Discord voice message metadata from a raw audio buffer.
 *
 * @param audioBuffer - Raw audio bytes (MP3, OGG, etc.)
 * @param mimeType - MIME type hint for the decoder (e.g. "audio/mpeg")
 * @returns Waveform + duration metadata, or null if generation failed
 */
export async function generateVoiceMessageMetadata(
  audioBuffer: Buffer,
  mimeType: string,
): Promise<VoiceMessageMetadata | null> {
  try {
    // Parse audio header for duration — pure JS, no subprocess needed
    const metadata = await parseBuffer(audioBuffer, { mimeType });
    const durationSecs = metadata.format.duration;
    if (!durationSecs || durationSecs <= 0) {
      log.warn("[VoiceWaveform] Could not determine audio duration from header");
      return null;
    }

    // Decode to raw mono PCM via the ffmpeg-static bundled binary
    if (!ffmpegPath) {
      log.warn("[VoiceWaveform] ffmpeg-static binary not available");
      return null;
    }

    const proc = Bun.spawn(
      [
        ffmpegPath,
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0", // read audio from stdin
        "-f",
        "s16le", // signed 16-bit little-endian PCM
        "-ac",
        "1", // downmix to mono
        "-ar",
        "8000", // 8 kHz is sufficient for visualization
        "pipe:1", // write PCM to stdout
      ],
      {
        stdin: new Blob([new Uint8Array(audioBuffer)]),
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    // Race subprocess exit against a timeout to avoid hanging
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), FFMPEG_TIMEOUT_MS));
    const exitPromise = proc.exited.then(() => new Response(proc.stdout).arrayBuffer());

    const result = await Promise.race([exitPromise, timeoutPromise]);
    if (!result) {
      proc.kill();
      log.warn(`[VoiceWaveform] ffmpeg timed out after ${FFMPEG_TIMEOUT_MS}ms`);
      return null;
    }

    const pcmBuffer = Buffer.from(result);
    if (pcmBuffer.length < 2) {
      log.warn("[VoiceWaveform] ffmpeg returned empty PCM output");
      return null;
    }

    // Compute 100 amplitude samples by splitting PCM into equal chunks
    //    and taking the peak absolute value in each chunk, normalized 0–255.
    const sampleCount = Math.floor(pcmBuffer.length / 2); // 16-bit = 2 bytes
    const chunkSize = Math.max(1, Math.floor(sampleCount / WAVEFORM_SAMPLES));
    const waveformBytes = new Uint8Array(WAVEFORM_SAMPLES);

    for (let i = 0; i < WAVEFORM_SAMPLES; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, sampleCount);
      let peak = 0;
      for (let j = start; j < end; j++) {
        const amplitude = Math.abs(pcmBuffer.readInt16LE(j * 2));
        if (amplitude > peak) peak = amplitude;
      }
      // Normalize 0–32767 → 0–255
      waveformBytes[i] = Math.round((peak / 32767) * 255);
    }

    log.info(`[VoiceWaveform] Generated waveform | duration=${durationSecs.toFixed(2)}s | samples=${WAVEFORM_SAMPLES}`);

    return {
      waveform: Buffer.from(waveformBytes).toString("base64"),
      durationSecs,
    };
  } catch (error) {
    log.warn("[VoiceWaveform] Failed to generate voice message metadata", error);
    return null;
  }
}
