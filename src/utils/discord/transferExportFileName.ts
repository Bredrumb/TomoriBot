import type { ChatInputCommandInteraction } from "discord.js";
import { buildExportFilename } from "@/utils/discord/attachmentFilename";

export type TransferExportScope = "workspace" | "personal";
export type TransferExportCategory = "config" | "memories";

const TRANSFER_EXPORT_SCOPE_NAMES: Record<TransferExportScope, string> = {
  workspace: "server",
  personal: "personal",
};

export function resolveTransferExportSubject(
  scope: TransferExportScope,
  interaction: ChatInputCommandInteraction,
): string {
  return scope === "workspace" ? (interaction.guild?.name ?? interaction.user.username) : interaction.user.username;
}

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
