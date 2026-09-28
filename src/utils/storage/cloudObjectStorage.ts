// Recovers an object key from a stored public URL for the GCS and S3 backends that avatar and
// voice-sample storage share. Each module keeps its own bucket, prefix, and env configuration; only
// the URL shapes are common, and they are common because the backends produce them, not because the
// two asset types agree on anything.

/** The bucket addressing a stored object URL was minted for. */
export type CloudObjectStorageConfig =
  | { backend: "gcs"; bucket: string; prefix: string; publicBaseUrl: string }
  | {
      backend: "s3";
      bucket: string;
      prefix: string;
      publicBaseUrl: string;
      region: string;
      endpoint?: string;
    };

/**
 * Recovers the object key a public URL points at, or null when the URL belongs to another bucket.
 *
 * GCS public URLs are `https://storage.googleapis.com/BUCKET/PREFIX/...`, so the configured public
 * base URL is stripped and the prefix is checked afterwards. S3 matches on hostname rather than
 * origin, because a custom CDN domain, virtual-hosted style, and path-style URL all address the
 * same object.
 *
 * @param url - Stored reference to decode
 * @returns The key including the configured prefix, or null when the URL is not this bucket's
 */
export function extractCloudObjectKeyFromUrl(config: CloudObjectStorageConfig, url: string): string | null {
  try {
    if (config.backend === "gcs") {
      // GCS public URLs: https://storage.googleapis.com/BUCKET/PREFIX/...
      // Strip the publicBaseUrl prefix to recover the object key.
      const baseUrl = config.publicBaseUrl.replace(/\/+$/, "");
      if (!url.startsWith(`${baseUrl}/`)) {
        return null;
      }
      const key = url.slice(baseUrl.length + 1);
      return key.startsWith(`${config.prefix}/`) ? key : null;
    }

    // S3: match on hostname (supports custom CDN domains, virtual-hosted style, and path-style)
    const parsed = new URL(url);
    const baseHost = new URL(config.publicBaseUrl).hostname;
    const hostname = parsed.hostname;
    const pathName = parsed.pathname.replace(/^\/+/, "");

    if (hostname !== baseHost) {
      const s3Host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
      const s3HostLegacy = `${config.bucket}.s3.amazonaws.com`;
      if (hostname !== s3Host && hostname !== s3HostLegacy) {
        return null;
      }
    }

    return pathName.startsWith(`${config.prefix}/`) ? pathName : null;
  } catch {
    return null;
  }
}
