import { type AttachmentBuilder, EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { StandardEmbedOptions } from "@/types/discord/embed";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

/**
 * The seams an export operation exposes to its tests. The receipt flow itself lives in
 * {@link deliverTransferExport}, so a leaf only supplies its own reader and vocabulary.
 */
export interface TransferExportReceiptDependencies {
  deliverDirectMessage(
    interaction: ChatInputCommandInteraction,
    payload: { embeds: EmbedBuilder[]; files: AttachmentBuilder[] },
  ): Promise<unknown>;
  replyInfoEmbed(
    interaction: ChatInputCommandInteraction,
    locale: string,
    options: StandardEmbedOptions,
    flags?: MessageFlags,
  ): Promise<void>;
}

/**
 * Send the export to the actor's DMs and answer with the matching receipt.
 *
 * The success receipt belongs after the DM, not after the read: the read can succeed
 * while the DM fails, and the actor still needs an answer on the interaction. Because
 * the read is non-destructive, that failed-DM receipt is the whole recovery, so it does
 * not compensate with a delete or a rollback.
 *
 * @returns True when the DM was delivered and the success receipt was sent.
 */
export async function deliverTransferExport(input: {
  interaction: ChatInputCommandInteraction;
  locale: string;
  typeLabel: string;
  /** Locale key for the DM's description. Config and memories name their own payload here. */
  dmDescriptionKey: string;
  attachment: AttachmentBuilder;
  /** Names the failing operation in the log line, so a closed DM is traceable to its leaf. */
  operationLabel: string;
  dependencies: TransferExportReceiptDependencies;
}): Promise<boolean> {
  try {
    await input.dependencies.deliverDirectMessage(input.interaction, {
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(input.locale, "commands.data.export.dm_title"))
          .setDescription(localizer(input.locale, input.dmDescriptionKey, { type: input.typeLabel }))
          .setColor(ColorCode.INFO),
      ],
      files: [input.attachment],
    });

    await input.dependencies.replyInfoEmbed(input.interaction, input.locale, {
      titleKey: "commands.data.export.success_title",
      descriptionKey: "commands.data.export.success_description",
      descriptionVars: { type: input.typeLabel },
      color: ColorCode.SUCCESS,
      flags: MessageFlags.Ephemeral,
    });

    return true;
  } catch (dmError) {
    log.warn(
      `Failed to send the ${input.operationLabel} export DM to user ${input.interaction.user.id}:`,
      dmError as Error,
    );
    await input.dependencies.replyInfoEmbed(input.interaction, input.locale, {
      titleKey: "commands.data.export.dm_failed_title",
      descriptionKey: "commands.data.export.dm_failed_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });

    return false;
  }
}
