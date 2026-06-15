import type { APIAttachment } from "discord.js";
import { PERSONA_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";

const DOWNLOAD_TIMEOUT_MS = 15000;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif"]);
const ALLOWED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif"]);

export type PersonaSpriteImageValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "file_too_large" | "invalid_format";
    };

export function validatePersonaSpriteImageAttachment(attachment: APIAttachment): PersonaSpriteImageValidationResult {
  const maxSizeBytes = PERSONA_LIMITS.MAX_AVATAR_SIZE_MB * 1024 * 1024;
  if (attachment.size > maxSizeBytes) {
    return { ok: false, reason: "file_too_large" };
  }

  const contentType = attachment.content_type?.toLowerCase();
  if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
    return { ok: false, reason: "invalid_format" };
  }

  const extension = attachment.filename.toLowerCase().split(".").pop();
  if (!extension || !ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
    return { ok: false, reason: "invalid_format" };
  }

  return { ok: true };
}

export async function downloadPersonaSpriteImageAttachment(
  attachment: APIAttachment,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; reason: "timeout" | "download_failed" }> {
  const downloadResult = await safeDownload(attachment.url, {
    maxSizeMB: PERSONA_LIMITS.MAX_AVATAR_SIZE_MB,
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    knownSize: attachment.size,
  });

  if (!downloadResult.success || !downloadResult.buffer) {
    return {
      ok: false,
      reason: downloadResult.error === "timeout" ? "timeout" : "download_failed",
    };
  }

  return {
    ok: true,
    buffer: downloadResult.buffer,
  };
}
