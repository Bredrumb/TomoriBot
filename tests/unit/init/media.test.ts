import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import sharp from "sharp";
import { initMediaProcessing } from "@/init/media";

const savedConcurrency = process.env.SHARP_CONCURRENCY;
const savedCacheMemory = process.env.SHARP_CACHE_MEMORY_MB;
const savedCacheItems = process.env.SHARP_CACHE_ITEMS;
const savedCacheFiles = process.env.SHARP_CACHE_FILES;

let concurrencySpy: ReturnType<typeof spyOn>;
let cacheSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  delete process.env.SHARP_CONCURRENCY;
  delete process.env.SHARP_CACHE_MEMORY_MB;
  delete process.env.SHARP_CACHE_ITEMS;
  delete process.env.SHARP_CACHE_FILES;

  // Stubbed rather than called through: both mutate one process-global libvips instance,
  // so a real call would leak the test's settings into every later test in the lane.
  concurrencySpy = spyOn(sharp, "concurrency").mockImplementation(() => 0);
  cacheSpy = spyOn(sharp, "cache").mockImplementation(
    () =>
      ({
        memory: { current: 0, high: 0, max: 0 },
        files: { current: 0, max: 0 },
        items: { current: 0, max: 0 },
      }) as never,
  );
});

afterEach(() => {
  concurrencySpy.mockRestore();
  cacheSpy.mockRestore();

  if (savedConcurrency === undefined) delete process.env.SHARP_CONCURRENCY;
  else process.env.SHARP_CONCURRENCY = savedConcurrency;
  if (savedCacheMemory === undefined) delete process.env.SHARP_CACHE_MEMORY_MB;
  else process.env.SHARP_CACHE_MEMORY_MB = savedCacheMemory;
  if (savedCacheItems === undefined) delete process.env.SHARP_CACHE_ITEMS;
  else process.env.SHARP_CACHE_ITEMS = savedCacheItems;
  if (savedCacheFiles === undefined) delete process.env.SHARP_CACHE_FILES;
  else process.env.SHARP_CACHE_FILES = savedCacheFiles;
});

describe("initMediaProcessing", () => {
  it("applies container-sized defaults when nothing is configured", () => {
    initMediaProcessing();

    expect(concurrencySpy).toHaveBeenCalledWith(1);
    expect(cacheSpy).toHaveBeenCalledWith({ memory: 16, items: 50, files: 0 });
  });

  it("honors explicit overrides", () => {
    process.env.SHARP_CONCURRENCY = "3";
    process.env.SHARP_CACHE_MEMORY_MB = "64";
    process.env.SHARP_CACHE_ITEMS = "200";
    process.env.SHARP_CACHE_FILES = "5";

    initMediaProcessing();

    expect(concurrencySpy).toHaveBeenCalledWith(3);
    expect(cacheSpy).toHaveBeenCalledWith({ memory: 64, items: 200, files: 5 });
  });

  it("accepts zero for the cache knobs, which disables retention", () => {
    process.env.SHARP_CACHE_MEMORY_MB = "0";
    process.env.SHARP_CACHE_ITEMS = "0";

    initMediaProcessing();

    expect(cacheSpy).toHaveBeenCalledWith({ memory: 0, items: 0, files: 0 });
  });

  it("falls back to defaults on unparseable or out-of-range values", () => {
    process.env.SHARP_CONCURRENCY = "0";
    process.env.SHARP_CACHE_MEMORY_MB = "not-a-number";
    process.env.SHARP_CACHE_ITEMS = "-5";

    initMediaProcessing();

    expect(concurrencySpy).toHaveBeenCalledWith(1);
    expect(cacheSpy).toHaveBeenCalledWith({ memory: 16, items: 50, files: 0 });
  });

  it("does not throw when sharp rejects the configuration", () => {
    concurrencySpy.mockImplementation(() => {
      throw new Error("libvips unavailable");
    });

    expect(() => initMediaProcessing()).not.toThrow();
  });
});
