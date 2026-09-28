import { createHash } from "node:crypto";
import { MessageFlags, type Attachment, type ChatInputCommandInteraction } from "discord.js";
import type { SafeDownloadResult } from "@/utils/security/safeDownload";

/**
 * The seam an upload operation exposes to its tests. The file intake itself lives in
 * {@link readImportFile}, so a leaf only supplies its own reader and vocabulary.
 */
export interface ImportIntakeDependencies {
  downloadAttachment(attachment: Attachment): Promise<SafeDownloadResult>;
}

export type ImportFileIntake =
  | {
      ok: true;
      buffer: Buffer;
      jsonData: unknown;
      /** Digest of the uploaded bytes, bound into the snapshot so a later apply can detect a swap. */
      fingerprint: string;
    }
  | { ok: false };

/**
 * Acknowledge the interaction, then download and parse the uploaded export file.
 *
 * The acknowledgement belongs before the download and the parse, both of which routinely
 * outlive Discord's three-second window, and it has to stay a plain deferral: a modal or a
 * paginated panel acknowledges on its own and Discord rejects a second acknowledgement.
 *
 * Every failure collapses to `{ ok: false }` because the leaves answer them with the same
 * invalid-file refusal, and none of them may store a snapshot for a file they could not
 * read.
 */
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
