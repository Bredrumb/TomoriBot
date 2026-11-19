import { type AttachmentBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import type { StandardEmbedOptions } from "@/types/discord/embed";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

export interface TransferExportReceipts {
  delivered(): Promise<void>;
  attachedInstead(attachment: AttachmentBuilder): Promise<void>;
}

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

export async function deliverTransferExport(input: {
  userId: string;
  locale: string;
  dmDescription: string;
  attachment: AttachmentBuilder;
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
