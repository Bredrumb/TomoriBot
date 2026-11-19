import { log } from "@/utils/misc/logger";
import {
  type FetchUserRemoteUrlOptions,
  fetchUserRemoteUrl,
  RemoteUrlPolicyError,
} from "@/utils/security/userRemoteFetch";
import { readBoundedResponse, ResponseSizeError } from "@/utils/security/boundedResponse";

export interface SafeDownloadOptions {
  maxSizeMB: number;

  timeoutMs?: number;

  // File size in bytes (unlike maxSizeMB in megabytes), so callers can pass attachment byte counts for pre-download
  // rejection.
  knownSize?: number;

  requestInit?: Omit<RequestInit, "signal">;

  externalSignal?: AbortSignal;

  // Left unset for member-supplied URLs so downloads stay off private networks; only operator-registered services
  // pass getEndpointRemotePolicy().
  remotePolicy?: FetchUserRemoteUrlOptions;
}

export interface SafeDownloadResult {
  success: boolean;

  buffer?: Buffer;

  contentType?: string;

  // A blocked_by_policy error means the SSRF gate refused the URL before any request was sent, so callers must not
  // retry or treat it as a transport failure.
  error?: "size_exceeded" | "timeout" | "network_error" | "invalid_response" | "blocked_by_policy";

  details?: string;
}

export async function safeDownload(url: string, options: SafeDownloadOptions): Promise<SafeDownloadResult> {
  // Signed attachment queries authorize access, so logs retain only the download origin.
  let urlOrigin: string;
  try {
    urlOrigin = new URL(url).origin;
  } catch {
    urlOrigin = "invalid";
  }
  const { maxSizeMB, timeoutMs = 10000, knownSize, requestInit, externalSignal, remotePolicy } = options;
  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  if (knownSize !== undefined && knownSize > maxSizeBytes) {
    log.warn(`File size ${(knownSize / (1024 * 1024)).toFixed(2)} MB exceeds limit of ${maxSizeMB} MB`, {
      metadata: {
        urlOrigin,
        knownSizeMB: knownSize / (1024 * 1024),
        maxSizeMB,
      },
    });

    return {
      success: false,
      error: "size_exceeded",
      details: `File size ${(knownSize / (1024 * 1024)).toFixed(2)} MB exceeds ${maxSizeMB} MB limit`,
    };
  }

  if (url.startsWith("data:")) {
    // Early rejection: base64 is ~1.33x the size of the raw data.
    // Using 0.75x of string length gives a safe lower-bound estimate of the byte size.
    // If the estimate itself exceeds the max, it's definitively too large.
    const estimatedSizeBytes = url.length * 0.75;
    if (estimatedSizeBytes > maxSizeBytes) {
      log.warn(
        `Data URI estimated size ${(estimatedSizeBytes / (1024 * 1024)).toFixed(2)} MB exceeds limit of ${maxSizeMB} MB`,
        {
          metadata: { estimatedSizeMB: estimatedSizeBytes / (1024 * 1024), maxSizeMB },
        },
      );

      return {
        success: false,
        error: "size_exceeded",
        details: `Data URI estimated size ${(estimatedSizeBytes / (1024 * 1024)).toFixed(2)} MB exceeds ${maxSizeMB} MB limit`,
      };
    }

    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length > maxSizeBytes) {
        log.warn(`Data URI ${(buffer.length / (1024 * 1024)).toFixed(2)} MB exceeds limit of ${maxSizeMB} MB`, {
          metadata: { actualSizeMB: buffer.length / (1024 * 1024), maxSizeMB },
        });

        return {
          success: false,
          error: "size_exceeded",
          details: `Data URI size ${(buffer.length / (1024 * 1024)).toFixed(2)} MB exceeds ${maxSizeMB} MB limit`,
        };
      }

      return {
        success: true,
        buffer,
        contentType: response.headers.get("content-type") ?? undefined,
      };
    } catch (error) {
      log.error("Failed to parse data URI in safeDownload", {
        errorType: "download_network_error",
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });

      return {
        success: false,
        error: "invalid_response",
        details: `Failed to parse data URI: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      return { success: false, error: "timeout", details: "Aborted before download started" };
    }
    externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetchUserRemoteUrl(url, { ...(requestInit ?? {}), signal: controller.signal }, remotePolicy);

    if (!response.ok) {
      log.warn(`Download failed with HTTP ${response.status}`, {
        metadata: {
          urlOrigin,
          status: response.status,
          statusText: response.statusText,
        },
      });

      return {
        success: false,
        error: "invalid_response",
        details: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      const sizeBytes = Number.parseInt(contentLength, 10);
      if (sizeBytes > maxSizeBytes) {
        log.warn(`Content-Length ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB exceeds limit of ${maxSizeMB} MB`, {
          metadata: {
            urlOrigin,
            contentLengthMB: sizeBytes / (1024 * 1024),
            maxSizeMB,
          },
        });

        return {
          success: false,
          error: "size_exceeded",
          details: `Content-Length ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB exceeds ${maxSizeMB} MB limit`,
        };
      }
    }

    const buffer = await readBoundedResponse(response, maxSizeBytes, controller.signal);

    if (buffer.length > maxSizeBytes) {
      log.warn(`Downloaded file ${(buffer.length / (1024 * 1024)).toFixed(2)} MB exceeds limit of ${maxSizeMB} MB`, {
        metadata: {
          urlOrigin,
          actualSizeMB: buffer.length / (1024 * 1024),
          maxSizeMB,
        },
      });

      return {
        success: false,
        error: "size_exceeded",
        details: `Downloaded file ${(buffer.length / (1024 * 1024)).toFixed(2)} MB exceeds ${maxSizeMB} MB limit`,
      };
    }

    log.info(`Successfully downloaded ${(buffer.length / (1024 * 1024)).toFixed(2)} MB`);

    return {
      success: true,
      buffer,
      contentType: response.headers.get("content-type") ?? undefined,
    };
  } catch (error) {
    if (error instanceof ResponseSizeError) {
      return { success: false, error: "size_exceeded", details: error.message };
    }
    if (error instanceof Error && error.name === "AbortError") {
      log.warn(`Download timed out after ${timeoutMs}ms`, {
        metadata: { urlOrigin, timeoutMs },
      });

      return {
        success: false,
        error: "timeout",
        details: `Download timed out after ${timeoutMs}ms`,
      };
    }

    if (error instanceof RemoteUrlPolicyError) {
      // Logged at warn, not error: an unreachable-by-policy URL (a plain-HTTP
      // image host, a redirect to a private address) is an expected outcome of
      // user-supplied content, not an incident.
      log.warn("Download blocked by URL policy", {
        errorType: "download_blocked_by_policy",
        metadata: {
          urlOrigin,
          hostname: error.hostname,
          failureCode: error.failureCode ?? "UNKNOWN",
          error: error.message,
        },
      });

      return {
        success: false,
        error: "blocked_by_policy",
        details: error.message,
      };
    }

    log.error("Download failed with network error", {
      errorType: "download_network_error",
      metadata: {
        urlOrigin,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    return {
      success: false,
      error: "network_error",
      details: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
