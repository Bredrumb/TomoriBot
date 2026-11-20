import type { ChatInputCommandInteraction } from "discord.js";
import { buildExportFilename } from "@/utils/discord/attachmentFilename";

export type TransferExportScope = "workspace" | "personal";
export type TransferExportCategory = "config" | "memories";

/** The scope's word in the filename. The internal scope stays `workspace`, which may be a DM-backed workspace. */
const TRANSFER_EXPORT_SCOPE_NAMES: Record<TransferExportScope, string> = {
  workspace: "server",
  personal: "personal",
};

/**
 * The name a transfer file is told apart by: the workspace it belongs to, or the exporting account. Both scopes
 * fall back to the account handle, which is what a DM-backed workspace has instead of a guild name.
 */
export function resolveTransferExportSubject(
  scope: TransferExportScope,
  interaction: ChatInputCommandInteraction,
): string {
  return scope === "workspace" ? (interaction.guild?.name ?? interaction.user.username) : interaction.user.username;
}

/**
 * `tomori-<category>-<scope>-<name>-<timestamp>.json`, following the shared export filename convention.
 * The subject passes through `sanitizeAttachmentFilenamePart` so arbitrary guild or account names never
 * introduce path separators, reserved characters, or control characters.
 */
export function buildTransferExportFileName(input: {
  scope: TransferExportScope;
  category: TransferExportCategory;
  subject: string;
  now?: Date;
}): string {
  const scopeName = TRANSFER_EXPORT_SCOPE_NAMES[input.scope];
  return buildExportFilename({
    kind: input.category,
    scope: scopeName,
    subject: {
      value: input.subject,
      fallback: scopeName,
    },
    extension: "json",
    now: input.now,
  });
}
