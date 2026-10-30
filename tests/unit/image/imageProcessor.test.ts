import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import sharp from "sharp";
import { clearEmergencyCaches } from "@/utils/cache/emergencyCacheClearer";
import { createChatLatencyInvocation, runWithChatTurnLatency } from "@/utils/chat/turnLatency";
import { clearImageCache, fetchAndOptimizeImage, getImageCacheSize } from "@/utils/image/imageProcessor";
import { log } from "@/utils/misc/logger";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import * as security from "@/utils/security/remoteUrlSecurity";
import * as downloads from "@/utils/security/safeDownload";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7XcAAAAASUVORK5CYII=",
  "base64",
);
const url = "https://cdn.discordapp.com/attachments/1/2/image.png";
const spies: Array<{ mockRestore(): void }> = [];

beforeEach(() => clearImageCache());
afterEach(() => {
  clearImageCache();
  for (const spy of spies.splice(0).reverse()) spy.mockRestore();
});

function stubDownloads(buffer = png) {
  const download = spyOn(downloads, "safeDownload").mockResolvedValue({
    success: true,
    buffer,
    contentType: "image/jpeg",
  });
  const validate = spyOn(security, "validateRemoteUrl").mockResolvedValue({ valid: true });
  spies.push(download, validate);
  return { download, validate };
}

describe("recent context image cache", () => {
  it.each([
    "cdn.discordapp.com",
    "media.discordapp.net",
  ])("shares signed variants on %s and preserves payload bytes", async (host) => {
    const { download, validate } = stubDownloads();
    const firstUrl = url.replace("cdn.discordapp.com", host);
    const first = await fetchAndOptimizeImage(`${firstUrl}?ex=111&is=222&hm=aaa&width=512`, "image/webp");
    const secondUrl = `${firstUrl}?ex=333&is=444&hm=bbb&width=512`;
    const second = await fetchAndOptimizeImage(secondUrl, "image/jpeg");
    expect(first).toEqual({ data: png.toString("base64"), mimeType: "image/png" });
    expect(second).toEqual(first);
    expect(download).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith(secondUrl);
    expect(getImageCacheSize()).toBe(1);
    await fetchAndOptimizeImage(`${firstUrl}?width=256`);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("shares in-flight work and counts only the owning download", async () => {
    const { download } = stubDownloads();
    const deferred = Promise.withResolvers<downloads.SafeDownloadResult>();
    download.mockReturnValueOnce(deferred.promise);
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    spies.push(metric);
    let results: Awaited<ReturnType<typeof fetchAndOptimizeImage>>[] = [];
    await runWithChatTurnLatency(createChatLatencyInvocation(Date.now(), "message"), 0, 0, async () => {
      const first = fetchAndOptimizeImage(`${url}?hm=aaa`);
      const second = fetchAndOptimizeImage(`${url}?hm=bbb`);
      expect(download).toHaveBeenCalledTimes(1);
      deferred.resolve({ success: true, buffer: png });
      results = await Promise.all([first, second]);
    });
    expect(results[0]).toEqual(results[1]);
    expect(metric.mock.calls.at(-1)?.[1]).toMatchObject({ image_fetches: 1 });
    await runWithChatTurnLatency(createChatLatencyInvocation(Date.now(), "message"), 0, 0, async () => {
      await fetchAndOptimizeImage(`${url}?hm=ccc`);
    });
    expect(metric.mock.calls.at(-1)?.[1]).toMatchObject({ image_fetches: 0, image_ms: 0 });
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("does not retain failed downloads or policy refusals", async () => {
    const { download } = stubDownloads();
    for (const error of ["network_error", "blocked_by_policy"] as const) {
      download.mockResolvedValueOnce({ success: false, error });
      await expect(fetchAndOptimizeImage(url)).rejects.toBeInstanceOf(Error);
      expect(getImageCacheSize()).toBe(0);
    }
    await fetchAndOptimizeImage(url);
    expect(download).toHaveBeenCalledTimes(3);
    expect(getImageCacheSize()).toBe(1);
  });

  it("refuses a cached URL when its own validation fails", async () => {
    const { download, validate } = stubDownloads();
    await fetchAndOptimizeImage(`${url}?hm=aaa`);
    validate.mockResolvedValueOnce({ valid: false, failureCode: "PRODUCTION_BLOCKED_ADDRESS" });
    await expect(fetchAndOptimizeImage(`${url}?hm=bbb`)).rejects.toBeInstanceOf(Error);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it.each([
    "https://example.com/image.png",
    "https://cdn.discordapp.com.example.com/image.png",
    "http://cdn.discordapp.com/image.png",
    "https://user:password@cdn.discordapp.com/image.png",
    "https://cdn.discordapp.com:8443/image.png",
  ])("does not cache %s", async (remoteUrl) => {
    const { download } = stubDownloads();
    await fetchAndOptimizeImage(remoteUrl);
    await fetchAndOptimizeImage(remoteUrl);
    expect(download).toHaveBeenCalledTimes(2);
    expect(getImageCacheSize()).toBe(0);
  });

  it("applies each caller's MIME hint when the bytes have no known signature", async () => {
    const buffer = Buffer.from("unrecognized image payload");
    const { download } = stubDownloads(buffer);
    expect((await fetchAndOptimizeImage(url, "IMAGE/WEBP; charset=binary")).mimeType).toBe("image/webp");
    expect((await fetchAndOptimizeImage(url, "image/avif")).mimeType).toBe("image/avif");
    expect((await fetchAndOptimizeImage(url)).mimeType).toBe("image/jpeg");
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("evicts oldest insertions by base64 bytes without refreshing their order on a hit", async () => {
    const padded = Buffer.alloc(10 * 1024 * 1024);
    png.copy(padded);
    const { download } = stubDownloads(padded);
    const urls = Array.from({ length: 5 }, (_, index) => `${url}?width=${index}`);
    for (const imageUrl of urls.slice(0, 4)) await fetchAndOptimizeImage(imageUrl);
    expect(getImageCacheSize()).toBe(4);
    await fetchAndOptimizeImage(urls[0]);
    await fetchAndOptimizeImage(urls[4]);
    expect(getImageCacheSize()).toBe(4);
    expect(download).toHaveBeenCalledTimes(5);
    for (const imageUrl of urls.slice(1)) await fetchAndOptimizeImage(imageUrl);
    expect(download).toHaveBeenCalledTimes(5);
    await fetchAndOptimizeImage(urls[0]);
    expect(download).toHaveBeenCalledTimes(6);
  });

  it("returns an oversized entry without retaining it or evicting existing entries", async () => {
    const { download } = stubDownloads();
    await fetchAndOptimizeImage(url);
    const maxMediaSizeMB = MEDIA_LIMITS.MAX_MEDIA_SIZE_MB;
    Reflect.set(MEDIA_LIMITS, "MAX_MEDIA_SIZE_MB", 64);
    try {
      const padded = Buffer.alloc(49 * 1024 * 1024);
      png.copy(padded);
      download.mockResolvedValue({ success: true, buffer: padded });
      const oversizedUrl = `${url}?width=4096`;
      const first = await fetchAndOptimizeImage(oversizedUrl);
      expect(Buffer.byteLength(first.data)).toBeGreaterThan(64 * 1024 * 1024);
      expect(await fetchAndOptimizeImage(oversizedUrl)).toEqual(first);
      expect(download).toHaveBeenCalledTimes(3);
      await fetchAndOptimizeImage(url);
      expect(download).toHaveBeenCalledTimes(3);
      expect(getImageCacheSize()).toBe(1);
    } finally {
      Reflect.set(MEDIA_LIMITS, "MAX_MEDIA_SIZE_MB", maxMediaSizeMB);
    }
  });

  it("memoizes the sharp resize result", async () => {
    const largePng = await sharp({ create: { width: 3072, height: 1024, channels: 3, background: "red" } })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const { download } = stubDownloads(largePng);
    const first = await fetchAndOptimizeImage(url, "image/png");
    expect(first.mimeType).toBe("image/jpeg");
    expect((await sharp(Buffer.from(first.data, "base64")).metadata()).width).toBe(2048);
    expect(await fetchAndOptimizeImage(url, "image/png")).toEqual(first);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("clears cached entries through emergency recovery and ignores pre-clear pending insertions", async () => {
    const { download } = stubDownloads();
    const warn = spyOn(log, "warn").mockImplementation(() => {});
    const metric = spyOn(log, "metric").mockImplementation(() => {});
    spies.push(warn, metric);
    await fetchAndOptimizeImage(url);
    const deferred = Promise.withResolvers<downloads.SafeDownloadResult>();
    download.mockReturnValueOnce(deferred.promise);
    const pending = fetchAndOptimizeImage(`${url}?width=512`);
    const report = clearEmergencyCaches({ collectBeforeMeasuring: false });
    expect(report.steps.find((step) => step.name === "recentImages")).toMatchObject({
      before: 1,
      after: 0,
      cleared: 1,
    });
    deferred.resolve({ success: true, buffer: png });
    await pending;
    expect(getImageCacheSize()).toBe(0);
    await fetchAndOptimizeImage(url);
    expect(download).toHaveBeenCalledTimes(3);
  });
});
