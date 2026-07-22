/**
 * Command: /server channel-prompt
 * Sets a per-channel system prompt that either appends after (mode = "append")
 * or fully replaces (mode = "replace") the server-level system prompt in the
 * selected channel only. Persona prompt and persona attributes are never affected.
 *
 * The prompt fields are optional: submitting them all empty removes the channel's
 * override (the modal copy tells the user this). Behavior, storage, and context
 * injection mirror the design documented in docs/pipelines/context-build.md.
 */
import {
  ChannelType,
  MessageFlags,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ChannelPromptMode, ErrorContext, UserRow } from "@/types/db/schema";
import type { RadioGroupOption } from "@/types/discord/modal";
import { getCachedChannelPrompt } from "@/utils/cache/channelPromptCache";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { channelPromptRepo } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { combineModalPromptParts, splitPromptIntoModalParts } from "@/utils/text/modalPromptParts";
import {
  buildTextPreview,
  CONFIRMATION_PREVIEW_BUDGET,
  textPreviewFooterKey,
  textPreviewFooterVars,
} from "@/utils/text/textPreview";

const MODAL_CUSTOM_ID = "server_channel_prompt_modal";
const MODE_RADIO_ID = "channel_prompt_mode";
const PROMPT_PART_MAX_LENGTH = 4000;
const PROMPT_PART_COUNT = 4;
const DEFAULT_MODE: ChannelPromptMode = "append";

/**
 * Builds the prompt-mode radio options, pre-selecting the saved mode.
 * @param locale - Locale for option labels/descriptions
 * @param selectedMode - The mode to mark as default-selected
 */
function createModeOptions(locale: string, selectedMode: ChannelPromptMode): RadioGroupOption[] {
  return [
    {
      label: localizer(locale, "commands.server.channel-prompt.mode_append_label"),
      value: "append",
      description: localizer(locale, "commands.server.channel-prompt.mode_append_desc"),
      default: selectedMode === "append",
    },
    {
      label: localizer(locale, "commands.server.channel-prompt.mode_replace_label"),
      value: "replace",
      description: localizer(locale, "commands.server.channel-prompt.mode_replace_desc"),
      default: selectedMode === "replace",
    },
  ];
}

/**
 * Configure the slash command subcommand metadata.
 * @param subcommand - The subcommand builder provided by the loader
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("channel-prompt")
    .setDescription(localizer("en-US", "commands.server.channel-prompt.description"))
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription(localizer("en-US", "commands.server.channel-prompt.channel_description"))
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
          ChannelType.AnnouncementThread,
        )
        .setRequired(true),
    );

/**
 * Execute the /server channel-prompt command.
 * @param _client - Discord client (unused)
 * @param interaction - Chat input command interaction
 * @param userData - Invoking user's row
 * @param locale - Resolved locale for the interaction
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Guild-only — a channel picker is meaningless in DMs (validation before try-catch).
  if (!interaction.guild) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 2. Read the target channel option.
  const selectedChannel = interaction.options.getChannel("channel", true);

  // 3. Load server state (cached) before showing the modal — stays within the 3s window.
  const tomoriState = await getCachedTomoriState(interaction.guild.id);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 4. Declare modalSubmitInteraction outside try-catch for error-path replies.
  let modalSubmitInteraction: ModalSubmitInteraction | undefined;

  try {
    // 5. Load any existing override for this channel to prefill the modal.
    const existing = await getCachedChannelPrompt(tomoriState.server_id, selectedChannel.id);
    const existingParts = splitPromptIntoModalParts(
      existing?.prompt ?? null,
      PROMPT_PART_COUNT,
      PROMPT_PART_MAX_LENGTH,
    );
    const prefillMode = existing?.mode ?? DEFAULT_MODE;

    // 6. Show the modal — 4 text parts (all optional; empty submit removes) + mode radio.
    //    Do NOT deferReply before this call (Pattern 3). Arg 4 auto-defers the submit.
    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.server.channel-prompt.modal_title",
        components: [
          {
            customId: "channel_prompt_part1",
            style: TextInputStyle.Paragraph,
            labelKey: "commands.server.channel-prompt.part1_label",
            descriptionKey: "commands.server.channel-prompt.part1_description",
            placeholder: "commands.server.channel-prompt.part1_placeholder",
            required: false,
            maxLength: PROMPT_PART_MAX_LENGTH,
            value: existingParts[0] || undefined,
          },
          {
            customId: "channel_prompt_part2",
            style: TextInputStyle.Paragraph,
            labelKey: "commands.server.channel-prompt.part2_label",
            placeholder: "commands.server.channel-prompt.part2_placeholder",
            required: false,
            maxLength: PROMPT_PART_MAX_LENGTH,
            value: existingParts[1] || undefined,
          },
          {
            customId: "channel_prompt_part3",
            style: TextInputStyle.Paragraph,
            labelKey: "commands.server.channel-prompt.part3_label",
            placeholder: "commands.server.channel-prompt.part3_placeholder",
            required: false,
            maxLength: PROMPT_PART_MAX_LENGTH,
            value: existingParts[2] || undefined,
          },
          {
            customId: "channel_prompt_part4",
            style: TextInputStyle.Paragraph,
            labelKey: "commands.server.channel-prompt.part4_label",
            placeholder: "commands.server.channel-prompt.part4_placeholder",
            required: false,
            maxLength: PROMPT_PART_MAX_LENGTH,
            value: existingParts[3] || undefined,
          },
          {
            kind: "radioGroup" as const,
            customId: MODE_RADIO_ID,
            labelKey: "commands.server.channel-prompt.mode_label",
            descriptionKey: "commands.server.channel-prompt.mode_description",
            required: true,
            options: createModeOptions(locale, prefillMode),
          },
        ],
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") {
      log.info(`Channel-prompt modal ${modalResult.outcome}`);
      return;
    }

    // 7. ASSIGN (not declare) modalSubmitInteraction; safety check after.
    modalSubmitInteraction = modalResult.interaction;
    if (!modalSubmitInteraction) {
      log.error("Channel-prompt modal submit interaction is undefined after successful submit");
      return;
    }

    // 8. Combine the 4 parts and read the selected mode.
    const channelPrompt = combineModalPromptParts(
      [
        modalResult.values?.channel_prompt_part1 || "",
        modalResult.values?.channel_prompt_part2 || "",
        modalResult.values?.channel_prompt_part3 || "",
        modalResult.values?.channel_prompt_part4 || "",
      ],
      PROMPT_PART_MAX_LENGTH,
    );
    const mode: ChannelPromptMode = modalResult.values?.[MODE_RADIO_ID] === "replace" ? "replace" : "append";
    const channelMention = `<#${selectedChannel.id}>`;

    // 9. Empty submit → remove the override (or report there was none).
    if (!channelPrompt) {
      if (!existing) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.server.channel-prompt.nothing_to_remove_title",
          descriptionKey: "commands.server.channel-prompt.nothing_to_remove_description",
          descriptionVars: { channel: channelMention },
          color: ColorCode.WARN,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const deleted = await channelPromptRepo.deleteChannelPromptOverride(tomoriState.server_id, selectedChannel.id);
      if (!deleted) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.server.channel-prompt.removed_title",
        descriptionKey: "commands.server.channel-prompt.removed_description",
        descriptionVars: { channel: channelMention },
        color: ColorCode.SUCCESS,
        flags: MessageFlags.Ephemeral,
      });
      log.info(`Channel prompt removed for server ${tomoriState.server_id} channel ${selectedChannel.id}`);
      return;
    }

    // 10. Non-empty → upsert the override (repo invalidates the channel cache on success).
    const saved = await channelPromptRepo.setChannelPromptOverride(
      tomoriState.server_id,
      selectedChannel.id,
      channelPrompt,
      mode,
    );
    if (!saved) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 11. Success — show the resolved mode + a short preview.
    const modeLabel = localizer(
      locale,
      mode === "replace"
        ? "commands.server.channel-prompt.mode_replace_label"
        : "commands.server.channel-prompt.mode_append_label",
    );
    const preview = buildTextPreview(channelPrompt, CONFIRMATION_PREVIEW_BUDGET);
    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.server.channel-prompt.saved_title",
      descriptionKey: "commands.server.channel-prompt.saved_description",
      descriptionVars: {
        channel: channelMention,
        mode: modeLabel,
        preview: preview.text,
      },
      footerKey: textPreviewFooterKey(preview),
      footerVars: textPreviewFooterVars(preview),
      color: ColorCode.SUCCESS,
      flags: MessageFlags.Ephemeral,
    });
    log.info(
      `Channel prompt set (${mode}) for server ${tomoriState.server_id} channel ${selectedChannel.id} (${channelPrompt.length} chars)`,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState.server_id,
      personaId: tomoriState.persona_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server channel-prompt",
        channelId: selectedChannel.id,
        guildDiscId: interaction.guild.id,
      },
    };
    await log.error("Error executing /server channel-prompt", error as Error, context);

    const replyTarget = modalSubmitInteraction ?? interaction;
    await replyInfoEmbed(replyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
