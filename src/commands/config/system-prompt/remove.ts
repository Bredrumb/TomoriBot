/**
 * Command: /config system-prompt remove
 * Clears the custom system prompt, reverting to default DEFAULT_SYSTEM_PROMPT
 */

import type { ChatInputCommandInteraction, Client } from "discord.js";
import { MessageFlags, SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { configRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { log, ColorCode } from "@/utils/misc/logger";
import { DEFAULT_SYSTEM_PROMPT } from "@/utils/text/contextBuilder";
import {
  buildTextPreview,
  EMBED_TEXT_PREVIEW_BUDGET,
  textPreviewFooterKey,
  textPreviewFooterVars,
} from "@/utils/text/textPreview";

/**
 * Configure the slash command subcommand metadata
 */
export function configureSubcommand(): SlashCommandSubcommandBuilder {
  return new SlashCommandSubcommandBuilder()
    .setName("remove")
    .setDescription("Remove the custom system prompt and use the default prompt")
    .setDescriptionLocalizations({});
}

/**
 * Execute the /config system-prompt remove command
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  // Defer the interaction before async work to prevent timeout
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const serverId = interaction.guildId ?? interaction.user.id;
    const tomoriState = await getCachedTomoriState(serverId);

    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!tomoriState.config.system_prompt) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.prompt.clear.no_custom_prompt_title",
        descriptionKey: "commands.config.prompt.clear.no_custom_prompt_description",
        descriptionVars: { defaultPrompt: DEFAULT_SYSTEM_PROMPT.trim() },
        color: ColorCode.INFO,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Capture the custom prompt before the write, so the success embed can
    //    echo it back. The default prompt is a constant that is always readable
    //    from source; the custom one is gone the moment this write lands.
    const removedPreview = buildTextPreview(tomoriState.config.system_prompt, EMBED_TEXT_PREVIEW_BUDGET);

    await configRepository.updateChatConfig(tomoriState.server_id, {
      system_prompt: null,
    });

    // Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(serverId);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.config.prompt.clear.success_title",
      descriptionKey:
        removedPreview.totalChars > 0
          ? "commands.config.prompt.clear.success_description_with_prompt"
          : "commands.config.prompt.clear.success_description",
      descriptionVars: { removed_prompt: removedPreview.text },
      footerKey: textPreviewFooterKey(removedPreview),
      footerVars: textPreviewFooterVars(removedPreview),
      color: ColorCode.SUCCESS,
      flags: MessageFlags.Ephemeral,
    });

    log.info(`System prompt cleared for server ${serverId}`);
  } catch (error) {
    log.error("Failed to clear custom system prompt:", error as Error);

    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
