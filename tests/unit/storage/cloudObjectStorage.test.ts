import { describe, expect, it } from "bun:test";
import { extractCloudObjectKeyFromUrl } from "@/utils/storage/cloudObjectStorage";

const GCS_CONFIG = {
  backend: "gcs",
  bucket: "tomori-assets",
  prefix: "avatars",
  publicBaseUrl: "https://storage.googleapis.com/tomori-assets",
} as const;

const S3_CONFIG = {
  backend: "s3",
  bucket: "tomori-assets",
  prefix: "voice-samples",
  publicBaseUrl: "https://tomori-assets.s3.eu-west-1.amazonaws.com",
  region: "eu-west-1",
} as const;

describe("extractCloudObjectKeyFromUrl", () => {
  describe("gcs backend", () => {
    it("strips the configured public base url to recover the key", () => {
      expect(
        extractCloudObjectKeyFromUrl(GCS_CONFIG, "https://storage.googleapis.com/tomori-assets/avatars/4/1.png"),
      ).toBe("avatars/4/1.png");
    });

    it("rejects a url from another bucket or a key outside the configured prefix", () => {
      // Another bucket sharing the storage.googleapis.com host.
      expect(
        extractCloudObjectKeyFromUrl(GCS_CONFIG, "https://storage.googleapis.com/other/avatars/4/1.png"),
      ).toBeNull();
      // Right bucket, but the object sits outside the prefix this module owns.
      expect(
        extractCloudObjectKeyFromUrl(GCS_CONFIG, "https://storage.googleapis.com/tomori-assets/other/1.png"),
      ).toBeNull();
    });

    it("rejects a prefix that only shares a leading substring", () => {
      // `avatars-archive` must not read as the `avatars` prefix.
      expect(
        extractCloudObjectKeyFromUrl(GCS_CONFIG, "https://storage.googleapis.com/tomori-assets/avatars-archive/1.png"),
      ).toBeNull();
    });
  });

  describe("s3 backend", () => {
    it("recovers the key from virtual-hosted and legacy aws hostnames", () => {
      // Virtual-hosted style, which is the configured public base url.
      expect(
        extractCloudObjectKeyFromUrl(
          S3_CONFIG,
          "https://tomori-assets.s3.eu-west-1.amazonaws.com/voice-samples/7/2.wav",
        ),
      ).toBe("voice-samples/7/2.wav");
      // The regional-less host is still accepted when the base host differs.
      expect(
        extractCloudObjectKeyFromUrl(S3_CONFIG, "https://tomori-assets.s3.amazonaws.com/voice-samples/7/2.wav"),
      ).toBe("voice-samples/7/2.wav");
    });

    it("matches a custom CDN domain through the configured base host or the bucket host", () => {
      const cdnConfig = { ...S3_CONFIG, publicBaseUrl: "https://cdn.example.test" };

      expect(extractCloudObjectKeyFromUrl(cdnConfig, "https://cdn.example.test/voice-samples/7/2.wav")).toBe(
        "voice-samples/7/2.wav",
      );
      // The AWS hostname still resolves, because the bucket, region, and prefix are unchanged.
      expect(
        extractCloudObjectKeyFromUrl(
          cdnConfig,
          "https://tomori-assets.s3.eu-west-1.amazonaws.com/voice-samples/7/2.wav",
        ),
      ).toBe("voice-samples/7/2.wav");
      // A third-party host that is neither the base host nor this bucket is refused.
      expect(extractCloudObjectKeyFromUrl(cdnConfig, "https://someone-else.test/voice-samples/7/2.wav")).toBeNull();
    });

    it("rejects another bucket and a key outside the configured prefix", () => {
      expect(
        extractCloudObjectKeyFromUrl(S3_CONFIG, "https://someone-else.s3.eu-west-1.amazonaws.com/voice-samples/1.wav"),
      ).toBeNull();
      expect(
        extractCloudObjectKeyFromUrl(S3_CONFIG, "https://tomori-assets.s3.eu-west-1.amazonaws.com/other/1.wav"),
      ).toBeNull();
    });

    it("treats a malformed url as no key", () => {
      // Neither backend may claim a reference it cannot decode, or a delete would target the wrong key.
      expect(extractCloudObjectKeyFromUrl(S3_CONFIG, "not a url")).toBeNull();
    });
  });
});
