import sharp from "sharp";
import { log } from "@/utils/misc/logger";

// Libvips caches bitmaps in external native memory invisible to heap sweeps and the RSS memory guard, so stock
// defaults risk exceeding the 512 MB budget.
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_CACHE_MEMORY_MB = 16;
const DEFAULT_CACHE_ITEMS = 50;
const DEFAULT_CACHE_FILES = 0;

function readIntEnv(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name]?.trim();
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    log.warn(`Ignoring ${name}="${raw}" (expected an integer >= ${minimum}); using ${fallback}`);
    return fallback;
  }

  return parsed;
}

// Process-global sharp limits must run before any image work because sharp.concurrency and sharp.cache configure a
// shared libvips instance.
export function initMediaProcessing(): void {
  const concurrency = readIntEnv("SHARP_CONCURRENCY", DEFAULT_CONCURRENCY, 1);
  const cacheMemoryMb = readIntEnv("SHARP_CACHE_MEMORY_MB", DEFAULT_CACHE_MEMORY_MB, 0);
  const cacheItems = readIntEnv("SHARP_CACHE_ITEMS", DEFAULT_CACHE_ITEMS, 0);
  const cacheFiles = readIntEnv("SHARP_CACHE_FILES", DEFAULT_CACHE_FILES, 0);

  try {
    sharp.concurrency(concurrency);
    sharp.cache({ memory: cacheMemoryMb, items: cacheItems, files: cacheFiles });

    log.success(
      `Media processing configured (sharp concurrency: ${concurrency}, cache: ${cacheMemoryMb}MB / ${cacheItems} items / ${cacheFiles} files)`,
    );

    if (process.env.RUN_ENV === "production") {
      // Production sets pino to error level, so emit log.metric to make applied libvips limits visible in
      // TomoriBotMetrics_CL.
      log.metric("media_config", {
        sharp_concurrency: concurrency,
        sharp_cache_memory_mb: cacheMemoryMb,
        sharp_cache_items: cacheItems,
        sharp_cache_files: cacheFiles,
      });
    }
  } catch (error) {
    // Image features degrade rather than fail: leaving libvips on its defaults is worse for
    // memory but still functional, so this must not abort startup.
    log.error("Failed to configure sharp limits; continuing with libvips defaults", error, {
      errorType: "MediaProcessingConfigError",
    });
  }
}
