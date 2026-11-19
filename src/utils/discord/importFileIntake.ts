import { createHash } from "node:crypto";
import { MessageFlags, type Attachment, type ChatInputCommandInteraction } from "discord.js";
import type { SafeDownloadResult } from "@/utils/security/safeDownload";

export interface ImportIntakeDependencies {
  downloadAttachment(attachment: Attachment): Promise<SafeDownloadResult>;
}

export type ImportFileIntake =
  | {
      ok: true;
      buffer: Buffer;
      jsonData: unknown;
      // Uploaded bytes digest bound into the snapshot so a later apply step detects if the file was swapped.
      fingerprint: string;
    }
  | { ok: false };

// Ephemeral deferral runs before download to beat Discord's 3s window, so callers cannot follow with a modal or
// paginated panel.
export async function readImportFile(
  interaction: ChatInputCommandInteraction,
  attachment: Attachment,
  dependencies: ImportIntakeDependencies,
): Promise<ImportFileIntake> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const download = await dependencies.downloadAttachment(attachment);
  if (!download.success || !download.buffer) {
    return { ok: false };
  }

  let jsonData: unknown;
  try {
    jsonData = JSON.parse(download.buffer.toString("utf8"));
  } catch {
    return { ok: false };
  }

  return {
    ok: true,
    buffer: download.buffer,
    jsonData,
    fingerprint: createHash("sha256").update(download.buffer).digest("hex"),
  };
}
