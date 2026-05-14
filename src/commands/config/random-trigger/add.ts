/**
 * /config random-trigger add
 * Adds a probabilistic timer-based auto-trigger to a channel.
 * Every N hours, there is a P% chance the configured persona speaks spontaneously.
 */

import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { getCachedTomoriState, getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { getServerRandomTriggerCount, getRandomTriggerByPersonaAndChannel } from "@/utils/db/repositories";
import { insertRandomTrigger, upsertRandomTrigger } from "@/utils/db/repositories";
import type { UserRow, ErrorContext } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";

// ─── Constants ────────────────────────────────────────────────────────────────

const MODAL_CUSTOM_ID = "config_randomtrigger_add_modal";
const PERSONA_SELECT_ID = "persona_select";
const RESPOND_TO_SELF_ID = "respond_to_self";
const PROMPT_INPUT_ID = "prompt_input";

/** Sentinel value that indicates "Random" persona selection */
const RANDOM_PERSONA_VALUE = "random";

/** Default per-server cap; configurable via env */
const MAX_TRIGGERS_PER_SERVER = Number.parseInt(process.env.RANDOM_TRIGGER_MAX_PER_SERVER ?? "10", 10);

// ─── Subcommand Configuration ─────────────────────────────────────────────────

/**
 * Configures the 'add' subcommand for /config random-trigger.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("add")
    .setDescription(localizer("en-US", "commands.config.random-trigger.add.description"))
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription(localizer("en-US", "commands.config.random-trigger.add.channel_description"))
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("timer_hours")
        .setDescription(localizer("en-US", "commands.config.random-trigger.add.timer_hours_description"))
        .setMinValue(1)
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("chance")
        .setDescription(localizer("en-US", "commands.config.random-trigger.add.chance_description"))
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("random_offset_range")
        .setDescription(localizer("en-US", "commands.config.random-trigger.add.random_offset_range_description"))
        .setMinValue(0)
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("silence_threshold")
        .setDescription(localizer("en-US", "commands.config.random-trigger.add.silence_threshold_description"))
        .setMinValue(1)
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName("failure_threshold")
        .setDescription(localizer("en-US", "commands.config.random-trigger.add.failure_threshold_description"))
        .setMinValue(1)
        .setRequired(false),
    );

// ─── Execute ──────────────────────────────────────────────────────────────────

/**
 * Executes the /config random-trigger add command.
 * Flow:
 *   1. Validate guild context and slash options
 *   2. Check per-server trigger cap
 *   3. Build persona select options (all personas + "Random")
 *   4. Show modal (persona select, respond_to_self, optional prompt)
 *   5. Parse modal submission and INSERT or UPSERT trigger
 *   6. Reply with success or override embed
 *
 * @param _client - Discord client instance
 * @param interaction - Slash command interaction
 * @param userData - Invoking user's data
 * @param locale - User's preferred locale
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Ensure command is run in a guild
  if (!interaction.guild) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // NOTE: No deferReply here — promptWithPaginatedModal must be the first
  // acknowledgment. Pre-modal checks are cache-backed and complete within 3 seconds.

  try {
    // 2. Parse and validate slash options
    const channel = interaction.options.getChannel("channel", true);
    const timerHours = interaction.options.getInteger("timer_hours", true);
    const randomOffsetRange = interaction.options.getInteger("random_offset_range", false) ?? null;
    const chance = interaction.options.getInteger("chance", true);
    const silenceThreshold = interaction.options.getInteger("silence_threshold", false) ?? null;
    const failureThreshold = interaction.options.getInteger("failure_threshold", false) ?? null;

    // 3. Load Tomori state to verify the server is set up
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

    // 4. Check per-server trigger cap before proceeding
    const triggerCount = await getServerRandomTriggerCount(tomoriState.server_id);
    if (triggerCount >= MAX_TRIGGERS_PER_SERVER) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.config.random-trigger.add.cap_reached_title",
        descriptionKey: "commands.config.random-trigger.add.cap_reached_description",
        descriptionVars: { max: MAX_TRIGGERS_PER_SERVER.toString() },
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 5. Load all personas for this guild to build the select menu
    const allPersonas = await getCachedAllPersonas(interaction.guild.id);

    // 6. Build select options: "Random" first, then each named persona
    const personaOptions: SelectOption[] = [
      {
        label: safeSelectOptionText(localizer(locale, "commands.config.random-trigger.add.persona_random_label")),
        value: RANDOM_PERSONA_VALUE,
      },
      ...allPersonas.map((p) => ({
        label: safeSelectOptionText(p.tomori_nickname),
        value: (p.tomori_id ?? 0).toString(),
      })),
    ];

    // 7. Show modal: persona select, respond_to_self select, optional prompt
    // (This is the first interaction acknowledgement — no deferReply before this)
    const modalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.config.random-trigger.add.modal_title",
      components: [
        // Persona selection (string select rendered as paginated modal)
        {
          customId: PERSONA_SELECT_ID,
          labelKey: "commands.config.random-trigger.add.persona_select_label",
          placeholder: "commands.config.random-trigger.add.persona_select_placeholder",
          required: true,
          options: personaOptions,
        },
        // respond_to_self: Checkbox Group (checked = yes, unchecked = no)
        // min_values: 0 + required: false allows unchecked (no) submission.
        {
          kind: "checkboxGroup" as const,
          customId: RESPOND_TO_SELF_ID,
          labelKey: "commands.config.random-trigger.add.respond_to_self_label",
          descriptionKey: "commands.config.random-trigger.add.respond_to_self_description",
          minValues: 0,
          required: false,
          options: [
            {
              label: localizer(locale, "commands.config.random-trigger.add.respond_to_self_yes"),
              value: "yes",
            },
          ],
        },
        // Optional custom prompt injected as manualSystemPrompt
        {
          customId: PROMPT_INPUT_ID,
          labelKey: "commands.config.random-trigger.add.prompt_label",
          descriptionKey: "commands.config.random-trigger.add.prompt_description",
          placeholder: "commands.config.random-trigger.add.prompt_placeholder",
          style: TextInputStyle.Paragraph,
          required: false,
          maxLength: 1000,
        },
      ],
    });

    // 8. Handle modal cancellation or timeout
    if (modalResult.outcome !== "submit") {
      log.info(`Randomtrigger add modal ${modalResult.outcome} for user ${interaction.user.id}`);
      return;
    }

    // biome-ignore lint/style/noNonNullAssertion: "submit" outcome guarantees interaction and values exist
    const modalInteraction = modalResult.interaction!;
    // biome-ignore lint/style/noNonNullAssertion: "submit" outcome guarantees interaction and values exist
    const values = modalResult.values!;

    // Defer the modal submit interaction
    if (!modalInteraction.deferred && !modalInteraction.replied) {
      await modalInteraction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    // 9. Parse modal values
    const personaRawValue = values[PERSONA_SELECT_ID] ?? RANDOM_PERSONA_VALUE;
    const customPromptRaw = values[PROMPT_INPUT_ID]?.trim() || null;

    // Map "random" sentinel → null (DB stores NULL for random selection)
    const tomoriId = personaRawValue === RANDOM_PERSONA_VALUE ? null : Number.parseInt(personaRawValue, 10);

    // Checkbox Group: "yes" present in multiValues = respond to self enabled
    const respondToSelf = (modalResult.multiValues?.[RESPOND_TO_SELF_ID] ?? []).includes("yes");

    // Resolve display name for success/override embeds
    const personaDisplayName =
      tomoriId === null
        ? localizer(locale, "commands.config.random-trigger.add.persona_random_label")
        : (allPersonas.find((p) => p.tomori_id === tomoriId)?.tomori_nickname ?? localizer(locale, "general.unknown"));

    const triggerData = {
      serverId: tomoriState.server_id,
      channelDiscId: channel.id,
      tomoriId,
      timerHours,
      randomOffsetRange,
      chancePercent: chance,
      silenceThresholdHours: silenceThreshold,
      respondToSelf,
      customPrompt: customPromptRaw,
      failureThreshold,
    };

    // 10. Override check: if a named persona already has a trigger for this channel, update it
    if (tomoriId !== null) {
      const existing = await getRandomTriggerByPersonaAndChannel(tomoriState.server_id, channel.id, tomoriId);

      if (existing?.trigger_id) {
        // UPSERT the existing trigger with new settings
        const updated = await upsertRandomTrigger(existing.trigger_id, triggerData);

        if (!updated) {
          const context: ErrorContext = {
            serverId: tomoriState.server_id,
            errorType: "DatabaseUpdateError",
            metadata: { operation: "upsertRandomTrigger", ...triggerData },
          };
          await log.error("Failed to upsert random trigger", new Error("upsertRandomTrigger returned null"), context);
          await replyInfoEmbed(modalInteraction, locale, {
            titleKey: "general.errors.update_failed_title",
            descriptionKey: "general.errors.update_failed_description",
            color: ColorCode.ERROR,
          });
          return;
        }

        // Notify user that an existing trigger was updated (override)
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "commands.config.random-trigger.add.override_title",
          descriptionKey: "commands.config.random-trigger.add.override_description",
          descriptionVars: {
            persona: personaDisplayName,
            channel: `<#${channel.id}>`,
          },
          color: ColorCode.WARN,
        });
        return;
      }
    }

    // 11. INSERT new trigger (includes all Random triggers regardless of duplicates)
    const inserted = await insertRandomTrigger(triggerData);

    if (!inserted) {
      const context: ErrorContext = {
        serverId: tomoriState.server_id,
        errorType: "DatabaseInsertError",
        metadata: { operation: "insertRandomTrigger", ...triggerData },
      };
      await log.error("Failed to insert random trigger", new Error("insertRandomTrigger returned null"), context);
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 12. Build optional suffix strings for non-default settings
    const offsetSuffix =
      randomOffsetRange !== null && randomOffsetRange > 0
        ? localizer(locale, "commands.config.random-trigger.add.success_offset_suffix", {
            random_offset_range: randomOffsetRange.toString(),
          })
        : "";
    const silenceSuffix = silenceThreshold
      ? localizer(locale, "commands.config.random-trigger.add.success_silence_suffix", {
          silence_threshold: silenceThreshold.toString(),
        })
      : "";
    const failureSuffix = failureThreshold
      ? localizer(locale, "commands.config.random-trigger.add.success_failure_suffix", {
          failure_threshold: failureThreshold.toString(),
        })
      : "";

    // 13. Reply with success summary
    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "commands.config.random-trigger.add.success_title",
      descriptionKey: "commands.config.random-trigger.add.success_description",
      descriptionVars: {
        channel: `<#${channel.id}>`,
        timer_hours: timerHours.toString(),
        chance: chance.toString(),
        persona: personaDisplayName,
        offset_suffix: offsetSuffix,
        silence_suffix: silenceSuffix,
        failure_suffix: failureSuffix,
      },
      color: ColorCode.SUCCESS,
    });

    log.success(
      `Random trigger created for channel ${channel.id} in server ${interaction.guild.id} (${timerHours}h, +/-${randomOffsetRange ?? 0}h, ${chance}%)`,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: { command: "config randomtrigger add" },
    };
    await log.error("Error in /config random-trigger add", error as Error, context);

    if (!interaction.replied && !interaction.deferred) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "general.errors.unknown_error_title"))
            .setDescription(localizer(locale, "general.errors.unknown_error_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
    }
  }
}
