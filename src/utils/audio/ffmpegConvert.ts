import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import ffmpegPath from "ffmpeg-static";
import { log } from "@/utils/misc/logger";

class FfmpegSpawnError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "FfmpegSpawnError";
  }
}

const FFMPEG_SIZE_CHECK_INTERVAL_MS = 100;

async function spawnFfmpeg(
  binary: string,
  tmpIn: string,
  tmpOut: string,
  outputArgs: readonly string[],
  signal?: AbortSignal,
  maxBytes?: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(binary, ["-y", "-i", tmpIn, ...outputArgs, tmpOut], { signal, stdio: "ignore" });
    let oversized = false;
    let spawnError: Error | undefined;
    const sizeWatch = maxBytes
      ? setInterval(() => {
          void fs
            .stat(tmpOut)
            .then((stat) => {
              if (stat.size > maxBytes) {
                oversized = true;
                proc.kill();
              }
            })
            .catch(() => undefined);
        }, FFMPEG_SIZE_CHECK_INTERVAL_MS)
      : undefined;
    proc.on("error", (err) => {
      spawnError = err;
    });
    proc.on("close", (code: number | null) => {
      clearInterval(sizeWatch);
      if (spawnError) reject(new FfmpegSpawnError(spawnError));
      else if (code === 0 && !oversized) resolve();
      else reject(new Error("Audio conversion failed"));
    });
  });
}

/**
 * Converts an audio buffer with ffmpeg through temporary files.
 *
 * Tries the bundled ffmpeg-static binary first and retries system ffmpeg only when spawning fails.
 */
export async function convertAudioWithFfmpeg(
  inputBuffer: Buffer,
  output: { args: readonly string[]; extension: string },
  options: { signal?: AbortSignal; maxBytes?: number } = {},
): Promise<Buffer> {
  const { signal, maxBytes } = options;
  signal?.throwIfAborted();
  const suffix = randomUUID();
  const tmpIn = path.join(os.tmpdir(), `audio-in-${suffix}`);
  const tmpOut = path.join(os.tmpdir(), `audio-out-${suffix}.${output.extension}`);

  await fs.writeFile(tmpIn, inputBuffer);

  try {
    const primaryBinary = ffmpegPath ?? "ffmpeg";
    try {
      await spawnFfmpeg(primaryBinary, tmpIn, tmpOut, output.args, signal, maxBytes);
    } catch (err) {
      if (err instanceof FfmpegSpawnError && primaryBinary !== "ffmpeg" && !signal?.aborted) {
        log.warn("[AudioConvert] ffmpeg-static failed to spawn, retrying with system ffmpeg", err);
        await spawnFfmpeg("ffmpeg", tmpIn, tmpOut, output.args, signal, maxBytes);
      } else {
        throw err;
      }
    }

    signal?.throwIfAborted();
    if (maxBytes && (await fs.stat(tmpOut)).size > maxBytes) throw new Error("Converted audio exceeds size limit");
    return await fs.readFile(tmpOut, { signal });
  } finally {
    await Promise.all(
      [tmpIn, tmpOut].map((file) =>
        fs.unlink(file).catch((err: unknown) => {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT")
            log.warn("[AudioConvert] Failed to delete temp audio file", err);
        }),
      ),
    );
  }
}

/** Mono 16 kHz MP3: every hosted transcription model accepts it, and speech needs no more than 16 kHz. */
export function convertAudioToTranscriptionMp3(
  inputBuffer: Buffer,
  options: { signal?: AbortSignal; maxBytes?: number } = {},
): Promise<Buffer> {
  return convertAudioWithFfmpeg(
    inputBuffer,
    { args: ["-vn", "-ar", "16000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", "-f", "mp3"], extension: "mp3" },
    options,
  );
}
