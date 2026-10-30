import { type AttachmentBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import type { StandardEmbedOptions } from "@/types/discord/embed";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

/**
 * How a surface answers once the DM settles. A slash command replies on its own ephemeral anchor,
 * while a panel repaints in place, so each surface supplies its own pair.
 */
export interface TransferExportReceipts {
  delivered(): Promise<void>;
  /** Carries the file itself, because a closed DM must not leave the actor without their export. */
  attachedInstead(attachment: AttachmentBuilder): Promise<void>;
}

/**
 * The receipts a slash-command export answers with on its deferred ephemeral reply.
 */
export function transferExportReplyReceipts(
  typeLabel: string,
  reply: (options: StandardEmbedOptions) => Promise<void>,
): TransferExportReceipts {
  return {
    delivered: () =>
      reply({
        titleKey: "commands.data.export.success_title",
        descriptionKey: "commands.data.export.success_description",
        descriptionVars: { type: typeLabel },
        color: ColorCode.SUCCESS,
        flags: MessageFlags.Ephemeral,
      }),
    attachedInstead: (attachment) =>
      reply({
        titleKey: "commands.data.export.dm_failed_title",
        descriptionKey: "commands.data.export.dm_failed_attached_description",
        descriptionVars: { type: typeLabel },
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
        files: [attachment],
      }),
  };
}

/**
 * Send a keepable export to the actor's DMs, where it doubles as a backup, and answer with the
 * matching receipt.
 *
 * The success receipt belongs after the DM, not after the read: the read can succeed while the DM
 * fails, and the actor still needs an answer on the interaction. Because the read is
 * non-destructive, attaching the file to the private answer is the whole recovery, so it does not
 * compensate with a delete or a rollback.
 *
 * @returns True when the DM was delivered.
 */
export async function deliverTransferExport(input: {
  userId: string;
  locale: string;
  dmDescription: string;
  attachment: AttachmentBuilder;
  /** Names the failing operation in the log line, so a closed DM is traceable to its surface. */
  operationLabel: string;
  sendDirectMessage(payload: { embeds: EmbedBuilder[]; files: AttachmentBuilder[] }): Promise<unknown>;
  receipts: TransferExportReceipts;
}): Promise<boolean> {
  try {
    await input.sendDirectMessage({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(input.locale, "commands.data.export.dm_title"))
          .setDescription(input.dmDescription)
          .setColor(ColorCode.INFO),
      ],
      files: [input.attachment],
    });
  } catch (dmError) {
    log.warn(`Failed to send the ${input.operationLabel} export DM to user ${input.userId}:`, dmError as Error);
    await input.receipts.attachedInstead(input.attachment);
    return false;
  }

  await input.receipts.delivered();
  return true;
}
