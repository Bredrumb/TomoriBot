/**
 * Safe Download Utility
 * Provides size-limited, timeout-protected file downloads for Discord attachments
 * Prevents DDoS attacks via oversized files or slow download attacks
 */

import { log } from "@/utils/misc/logger";

/**
 * Options for safe download operation
 */
export interface SafeDownloadOptions {
	/**
	 * Maximum file size in MB
	 */
	maxSizeMB: number;

	/**
	 * Timeout in milliseconds (default: 10000ms / 10 seconds)
	 */
	timeoutMs?: number;

	/**
	 * Known file size from Discord attachment metadata (in bytes)
	 * If provided, size check occurs before download attempt
	 */
	knownSize?: number;
}

/**
 * Result of safe download operation
 */
export interface SafeDownloadResult {
	/**
	 * Whether the download succeeded
	 */
	success: boolean;

	/**
	 * Downloaded file buffer (only if success === true)
	 */
	buffer?: Buffer;

	/**
	 * Error type if download failed
	 */
	error?: "size_exceeded" | "timeout" | "network_error" | "invalid_response";

	/**
	 * Additional error details for logging/debugging
	 */
	details?: string;
}

/**
 * Safely download a file with size and timeout protections
 *
 * @param url - URL to download from
 * @param options - Download options (maxSizeMB, timeoutMs, knownSize)
 * @returns Download result with buffer or error information
 *
 * @example
 * ```typescript
 * const result = await safeDownload(attachment.url, {
 *   maxSizeMB: 8,
 *   timeoutMs: 10000,
 *   knownSize: attachment.size
 * });
 *
 * if (!result.success) {
 *   // Handle error based on result.error
 * }
 *
 * const imageBuffer = result.buffer;
 * ```
 */
export async function safeDownload(
	url: string,
	options: SafeDownloadOptions,
): Promise<SafeDownloadResult> {
	const { maxSizeMB, timeoutMs = 10000, knownSize } = options;
	const maxSizeBytes = maxSizeMB * 1024 * 1024;

	// 1. Pre-check known size if provided (early rejection, no network call)
	if (knownSize !== undefined && knownSize > maxSizeBytes) {
		log.warn(
			`File size ${(knownSize / (1024 * 1024)).toFixed(2)} MB exceeds limit of ${maxSizeMB} MB`,
			{
				metadata: {
					url,
					knownSizeMB: knownSize / (1024 * 1024),
					maxSizeMB,
				},
			},
		);

		return {
			success: false,
			error: "size_exceeded",
			details: `File size ${(knownSize / (1024 * 1024)).toFixed(2)} MB exceeds ${maxSizeMB} MB limit`,
		};
	}

	// 2. Setup timeout controller
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		// 3. Fetch with timeout and abort signal
		const response = await fetch(url, { signal: controller.signal });

		clearTimeout(timeoutId);

		// 4. Validate response status
		if (!response.ok) {
			log.warn(`Download failed with HTTP ${response.status}`, {
				metadata: {
					url,
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

		// 5. Check content-length header as backup size validation
		const contentLength = response.headers.get("content-length");
		if (contentLength) {
			const sizeBytes = Number.parseInt(contentLength, 10);
			if (sizeBytes > maxSizeBytes) {
				log.warn(
					`Content-Length ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB exceeds limit of ${maxSizeMB} MB`,
					{
						metadata: {
							url,
							contentLengthMB: sizeBytes / (1024 * 1024),
							maxSizeMB,
						},
					},
				);

				return {
					success: false,
					error: "size_exceeded",
					details: `Content-Length ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB exceeds ${maxSizeMB} MB limit`,
				};
			}
		}

		// 6. Download as ArrayBuffer and convert to Buffer
		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		// 7. Final size check on actual downloaded data
		if (buffer.length > maxSizeBytes) {
			log.warn(
				`Downloaded file ${(buffer.length / (1024 * 1024)).toFixed(2)} MB exceeds limit of ${maxSizeMB} MB`,
				{
					metadata: {
						url,
						actualSizeMB: buffer.length / (1024 * 1024),
						maxSizeMB,
					},
				},
			);

			return {
				success: false,
				error: "size_exceeded",
				details: `Downloaded file ${(buffer.length / (1024 * 1024)).toFixed(2)} MB exceeds ${maxSizeMB} MB limit`,
			};
		}

		// 8. Success!
		log.info(
			`Successfully downloaded ${(buffer.length / (1024 * 1024)).toFixed(2)} MB`,
		);

		return {
			success: true,
			buffer,
		};
	} catch (error) {
		clearTimeout(timeoutId);

		// Handle abort (timeout)
		if (error instanceof Error && error.name === "AbortError") {
			log.warn(`Download timed out after ${timeoutMs}ms`, {
				metadata: { url, timeoutMs },
			});

			return {
				success: false,
				error: "timeout",
				details: `Download timed out after ${timeoutMs}ms`,
			};
		}

		// Handle other network errors
		log.error("Download failed with network error", {
			errorType: "download_network_error",
			metadata: {
				url,
				error: error instanceof Error ? error.message : String(error),
			},
		});

		return {
			success: false,
			error: "network_error",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}
