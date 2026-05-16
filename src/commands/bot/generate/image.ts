import {
  MessageFlags,
  PermissionFlagsBits,
  TextInputStyle,
  type BaseGuildTextChannel,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
  type TextChannel,
} from "discord.js";
import { sendCooldownDM } from "@/utils/discord/cooldownDM";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { personaRepository } from "@/utils/db/repositories";
import { sql } from "@/utils/db/client";
import { getOrCreateWebhook } from "@/utils/discord/webhook/lifecycle";
import { resolvePersonaWebhookIdentity } from "@/utils/discord/webhook/identity";
import { cooldownRepository } from "@/utils/db/repositories/CooldownRepository";
import { checkImageQuota } from "@/utils/quota/imageQuotaManager";
import { hasOptApiKey } from "@/utils/security/crypto";
import { CooldownType, type TomoriState, type UserRow } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { runHiddenImageTurn } from "@/utils/provider/hiddenImageTurn";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";
import { getCachedWhitelistStatus } from "@/utils/cache/channelWhitelistCache";
import { getCachedPersonalSpotlightStatus } from "@/utils/cache/personalSpotlightCache";
import { filterPersonasForTrigger, isPersonaAllowedForTrigger } from "@/utils/persona/personaAccess";

// ─── Modal field identifiers ──────────────────────────────────────────────────

const MODAL_CUSTOM_ID = "bot_generate_image_modal";
const PROMPT_INPUT_ID = "bot_generate_image_prompt";
const SETTING_INPUT_ID = "bot_generate_image_setting";
const BACKEND_INPUT_ID = "bot_generate_image_backend";
const PERSONA_INPUT_ID = "bot_generate_image_persona";

// ─── Preset / backend types ───────────────────────────────────────────────────

type SceneSettingId = "storybeat" | "character" | "snapshot" | "vertical";
type SceneImageBackend = "current_provider" | "novelai";
type NaiOrientation = "portrait" | "landscape" | "square";

interface SceneSettingPreset {
  aspectRatio: string;
  /** Human-readable framing label shown in the modal and passed to the hidden agent. */
  plannerLabel: string;
  /** Framing instruction passed to the hidden agent as part of its directive. */
  plannerInstruction: string;
  novelAiOrientation: NaiOrientation;
}

const SCENE_SETTING_PRESETS: Record<SceneSettingId, SceneSettingPreset> = {
  storybeat: {
    aspectRatio: "16:9",
    plannerLabel: "Story Beat",
    plannerInstruction:
      "Use a wider cinematic composition that captures the immediate scene, action, and surroundings.",
    novelAiOrientation: "landscape",
  },
  character: {
    aspectRatio: "3:4",
    plannerLabel: "Character Focus",
    plannerInstruction:
      "Prioritize the main character or speaker, with closer framing and readable expression/body language.",
    novelAiOrientation: "portrait",
  },
  snapshot: {
    aspectRatio: "1:1",
    plannerLabel: "Square Snapshot",
    plannerInstruction: "Create a balanced square composition that still shows the current moment clearly.",
    novelAiOrientation: "square",
  },
  vertical: {
    aspectRatio: "9:16",
    plannerLabel: "Phone Wallpaper",
    plannerInstruction:
      "Use tall vertical framing with strong silhouette, depth, and room for a wallpaper-style composition.",
    novelAiOrientation: "portrait",
  },
};

interface SceneImageBackendAvailability {
  currentProvider: boolean;
  novelAi: boolean;
  showBackendSelector: boolean;
  defaultBackend: SceneImageBackend | null;
}

/**
 * Persona fields needed for the modal selector, webhook identity resolution,
 * and overriding the `buildContext()` persona identity in the hidden agent.
 */
interface PersonaSummary {
  tomori_id: number;
  tomori_nickname: string;
  webhook_avatar_url: string | null;
  is_alter: boolean;
  /** From persona_configs — null when no persona-specific prompt is set. */
  persona_prompt: string | null;
  /** Appearance/personality attribute list used by buildContext(). */
  attribute_list: string[];
  /** Lineage ID used by buildContext() for persona-scoped memory/RAG. */
  persona_lineage_id: number;
}

type ImageQuotaCheckResult = Awaited<ReturnType<typeof checkImageQuota>>;

// ─── Subcommand registration ──────────────────────────────────────────────────

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("image").setDescription(localizer("en-US", "commands.bot.generate.image.description"));

// ─── Locale helpers ───────────────────────────────────────────────────────────

function getSettingOptions(locale: string) {
  return [
    {
      label: localizer(locale, "commands.bot.generate.image.modal.setting_storybeat_label"),
      value: "storybeat",
      description: localizer(locale, "commands.bot.generate.image.modal.setting_storybeat_description"),
    },
    {
      label: localizer(locale, "commands.bot.generate.image.modal.setting_character_label"),
      value: "character",
      description: localizer(locale, "commands.bot.generate.image.modal.setting_character_description"),
    },
    {
      label: localizer(locale, "commands.bot.generate.image.modal.setting_snapshot_label"),
      value: "snapshot",
      description: localizer(locale, "commands.bot.generate.image.modal.setting_snapshot_description"),
    },
    {
      label: localizer(locale, "commands.bot.generate.image.modal.setting_vertical_label"),
      value: "vertical",
      description: localizer(locale, "commands.bot.generate.image.modal.setting_vertical_description"),
    },
  ];
}

function getBackendOptions(locale: string, providerName: string) {
  return [
    {
      label: localizer(locale, "commands.bot.generate.image.modal.backend_current_label"),
      value: "current_provider",
      description: localizer(locale, "commands.bot.generate.image.modal.backend_current_description", {
        provider: providerName,
      }),
    },
    {
      label: localizer(locale, "commands.bot.generate.image.modal.backend_novelai_label"),
      value: "novelai",
      description: localizer(locale, "commands.bot.generate.image.modal.backend_novelai_description"),
    },
  ];
}

// ─── Persona helpers ──────────────────────────────────────────────────────────

/**
 * Fetches persona summaries for the modal selector and context overrides.
 * Includes the fields needed to override buildContext() persona identity
 * (nickname, attributes, persona prompt, lineage ID) without loading a full TomoriState.
 * Returns main persona first (is_alter=false), then alters ordered by recency.
 * @param serverId - Numeric DB server ID from tomoriState
 */
async function loadServerPersonaSummaries(serverId: number): Promise<PersonaSummary[]> {
  return await sql<PersonaSummary[]>`
		SELECT
			t.tomori_id,
			t.tomori_nickname,
			t.webhook_avatar_url,
			t.is_alter,
			t.attribute_list,
			t.persona_lineage_id,
			pc.persona_prompt
		FROM tomoris t
		LEFT JOIN persona_configs pc ON pc.tomori_id = t.tomori_id
		WHERE t.server_id = ${serverId}
		ORDER BY t.is_alter ASC, t.updated_at DESC NULLS LAST, t.tomori_id DESC
	`;
}

/**
 * Builds string-select options from persona summaries for the modal.
 * The active persona (matching activeTomoriId) is marked as default.
 * @param personas - List of persona summaries from loadServerPersonaSummaries
 * @param activeTomoriId - The currently active persona's tomori_id
 */
function getPersonaSelectOptions(personas: PersonaSummary[], activeTomoriId: number) {
  return personas.map((p) => ({
    label: p.tomori_nickname,
    value: p.tomori_id.toString(),
    default: p.tomori_id === activeTomoriId,
  }));
}

// ─── Backend availability ─────────────────────────────────────────────────────

async function resolveSceneImageBackendAvailability(params: {
  provider: string;
  tomoriState: TomoriState;
  serverId: string;
}): Promise<SceneImageBackendAvailability> {
  const serverIdNumber = Number.parseInt(params.serverId, 10);
  const hasNovelAiOptKey = Number.isNaN(serverIdNumber) ? false : await hasOptApiKey(serverIdNumber, "novelai");
  const hasNaiImageSlot = Boolean(params.tomoriState.config.nai_diffusion_model_id);
  const novelAiAvailable =
    hasNaiImageSlot &&
    (hasNovelAiOptKey || (params.provider === "novelai" && Boolean(params.tomoriState.config.api_key)));
  const currentProviderAvailable =
    params.provider !== "novelai" && Boolean(params.tomoriState.config.diffusion_model_id);
  const defaultBackend = currentProviderAvailable ? "current_provider" : novelAiAvailable ? "novelai" : null;

  return {
    currentProvider: currentProviderAvailable,
    novelAi: novelAiAvailable,
    showBackendSelector: currentProviderAvailable && novelAiAvailable,
    defaultBackend,
  };
}

// ─── Quota error reply ────────────────────────────────────────────────────────

async function replyQuotaExceeded(
  replyTarget: ChatInputCommandInteraction | import("discord.js").ModalSubmitInteraction,
  locale: string,
  quotaCheck: ImageQuotaCheckResult,
): Promise<void> {
  const errorTitleKey = "commands.generate.image.quota_exceeded_title";
  let errorDescriptionKey = "commands.generate.image.quota_exceeded_description";
  const descriptionVars: Record<string, string> = {};

  if (quotaCheck.resetTime) {
    const now = new Date();
    const hoursUntilReset = Math.ceil((quotaCheck.resetTime.getTime() - now.getTime()) / (1000 * 60 * 60));

    if (hoursUntilReset < 24) {
      descriptionVars.reset_info = localizer(locale, "commands.generate.image.quota_resets_in_hours", {
        hours: hoursUntilReset.toString(),
      });
    } else {
      descriptionVars.reset_info = localizer(locale, "commands.generate.image.quota_resets_in_days", {
        days: Math.ceil(hoursUntilReset / 24).toString(),
      });
    }
  }

  if (quotaCheck.reason === "user_quota_exceeded") {
    errorDescriptionKey = "commands.generate.image.user_quota_exceeded_description";
  } else if (quotaCheck.reason === "serverwide_quota_exceeded") {
    errorDescriptionKey = "commands.generate.image.serverwide_quota_exceeded_description";
  }

  await replyInfoEmbed(replyTarget, locale, {
    titleKey: errorTitleKey,
    descriptionKey: errorDescriptionKey,
    descriptionVars,
    footerKey: "commands.generate.image.quota_exceeded_footer",
    color: ColorCode.ERROR,
    flags: MessageFlags.Ephemeral,
  });
}

// ─── Command entry point ──────────────────────────────────────────────────────

export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Guild-only guard — the command targets a specific channel.
  if (!interaction.guild || !interaction.channel || !("messages" in interaction.channel)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 2. Resolve bot guild member (required for permission checks).
  const botMember = interaction.guild.members.me;
  if (!botMember) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 3. Validate bot channel permissions.
  const guildChannel = interaction.guild.channels.cache.get(interaction.channel.id) ?? interaction.channel;
  if (!("permissionsFor" in guildChannel)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const permissions = guildChannel.permissionsFor(botMember);
  const requiresThreadSendPermission =
    "isThread" in guildChannel && typeof guildChannel.isThread === "function" && guildChannel.isThread();
  const canSendMessages = requiresThreadSendPermission
    ? permissions?.has(PermissionFlagsBits.SendMessagesInThreads)
    : permissions?.has(PermissionFlagsBits.SendMessages);

  if (
    !permissions?.has(PermissionFlagsBits.ViewChannel) ||
    !permissions?.has(PermissionFlagsBits.ReadMessageHistory) ||
    !permissions?.has(PermissionFlagsBits.AttachFiles) ||
    !canSendMessages
  ) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.bot.generate.image.missing_permissions_title",
      descriptionKey: "commands.bot.generate.image.missing_permissions_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 4. Load server state.
  const baseTomoriState = await personaRepository.loadState(interaction.guild.id);
  if (!baseTomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const { tomoriState } = await applyPersonalProviderSelectionsToTomoriState(baseTomoriState, userData.user_id ?? null);

  // 4a. Load all persona summaries for the sender selector.
  const personaSummaries = await loadServerPersonaSummaries(tomoriState.server_id);
  const invokingMember = interaction.member as import("discord.js").GuildMember | null;

  // 5. Cooldown check.
  const cooldownType = tomoriState.config.cooldown_type ?? CooldownType.OFF;
  const cooldownLength = tomoriState.config.cooldown_length ?? 5;
  const cooldownResult = await cooldownRepository.checkMessageTriggerCooldownWithWhitelist(
    interaction.guild.id,
    interaction.user.id,
    interaction.channel.id,
    cooldownType,
    invokingMember,
  );

  if (cooldownResult.isOnCooldown) {
    if (cooldownResult.blockedByWhitelist) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.message_cooldown_title",
        descriptionKey: "commands.bot.generate.image.channel_not_whitelisted",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const footerKey = cooldownRepository.getCooldownTypeFooterKey(cooldownResult.cooldownType);
    await sendCooldownDM(
      interaction.user,
      locale,
      "general.message_cooldown_title",
      "commands.bot.generate.image.cooldown_active",
      {
        seconds: cooldownResult.remainingSeconds.toString(),
        botName: tomoriState.tomori_nickname,
      },
      footerKey,
      interaction,
      MessageFlags.Ephemeral,
    );
    return;
  }

  const parentChannelId =
    "isThread" in guildChannel && typeof guildChannel.isThread === "function" && guildChannel.isThread()
      ? guildChannel.parent?.id
      : undefined;
  const whitelistStatus = await getCachedWhitelistStatus(
    interaction.guild.id,
    interaction.channel.id,
    invokingMember?.roles.cache.map((role) => role.id),
    parentChannelId,
  );
  const personalSpotlightStatus = userData.user_id
    ? await getCachedPersonalSpotlightStatus(
        tomoriState.server_id,
        userData.user_id,
        parentChannelId ?? interaction.channel.id,
      )
    : null;
  const availablePersonaSummaries = filterPersonasForTrigger(
    personaSummaries,
    whitelistStatus,
    personalSpotlightStatus,
  );

  if (availablePersonaSummaries.length === 0) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.message_cooldown_title",
      descriptionKey: "commands.bot.generate.image.persona_access_blocked",
      color: ColorCode.WARN,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const fallbackPersonaSummary = availablePersonaSummaries[0];

  // 6. Image generation feature flag.
  if (!tomoriState.config.imagegen_enabled) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.generate.image.disabled_title",
      descriptionKey: "commands.generate.image.disabled_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 7. The hidden image agent requires function-calling support on the active model.
  //    Without tool support the model cannot call generate_image / generate_image_nai.
  if (!tomoriState.llm.has_tools) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.bot.generate.image.planner_unavailable_title",
      descriptionKey: "commands.bot.generate.image.planner_unavailable_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 8. API key presence check.
  if (!tomoriState.config.api_key) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.generate.image.no_api_key_title",
      descriptionKey: "commands.generate.image.no_api_key_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 9. Determine which backends are available.
  const provider = tomoriState.llm.llm_provider.toLowerCase();
  const backendAvailability = await resolveSceneImageBackendAvailability({
    provider,
    tomoriState,
    serverId: interaction.guild.id,
  });
  if (!backendAvailability.defaultBackend) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.bot.generate.image.no_backend_title",
      descriptionKey: "commands.bot.generate.image.no_backend_description",
      descriptionVars: {
        current_provider: tomoriState.llm.llm_provider,
      },
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 10. Quota check before showing the modal (avoids wasting user interaction).
  const quotaCheck = await checkImageQuota(tomoriState.server_id, interaction.user.id);
  if (!quotaCheck.allowed) {
    await replyQuotaExceeded(interaction, locale, quotaCheck);
    return;
  }

  // 11. Show the modal (fire-and-forget UX — no public bot response until image posts).
  const defaultPersonaId = availablePersonaSummaries.some((persona) => persona.tomori_id === tomoriState.tomori_id)
    ? (tomoriState.tomori_id ?? fallbackPersonaSummary?.tomori_id ?? -1)
    : (fallbackPersonaSummary?.tomori_id ?? -1);
  const modalResult = await promptWithRawModal(
    interaction,
    locale,
    {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.bot.generate.image.modal.title",
      components: [
        {
          customId: PERSONA_INPUT_ID,
          labelKey: "commands.bot.generate.image.modal.persona_label",
          descriptionKey: "commands.bot.generate.image.modal.persona_description",
          required: true,
          options: getPersonaSelectOptions(availablePersonaSummaries, defaultPersonaId),
        },
        {
          customId: PROMPT_INPUT_ID,
          labelKey: "commands.bot.generate.image.modal.prompt_label",
          descriptionKey: "commands.bot.generate.image.modal.prompt_description",
          placeholder: localizer(locale, "commands.bot.generate.image.modal.prompt_placeholder"),
          required: false,
          style: TextInputStyle.Paragraph,
          maxLength: 1000,
        },
        {
          kind: "radioGroup" as const,
          customId: SETTING_INPUT_ID,
          labelKey: "commands.bot.generate.image.modal.setting_label",
          descriptionKey: "commands.bot.generate.image.modal.setting_description",
          required: true,
          options: getSettingOptions(locale),
        },
        ...(backendAvailability.showBackendSelector
          ? [
              {
                kind: "radioGroup" as const,
                customId: BACKEND_INPUT_ID,
                labelKey: "commands.bot.generate.image.modal.backend_label",
                descriptionKey: "commands.bot.generate.image.modal.backend_description",
                required: true,
                options: getBackendOptions(locale, tomoriState.llm.llm_provider),
              },
            ]
          : []),
      ],
    },
    MessageFlags.Ephemeral,
  );

  if (modalResult.outcome !== "submit" || !modalResult.interaction) {
    return;
  }

  const modalSubmitInteraction = modalResult.interaction;

  try {
    // 12. Read modal values.
    const selectedSetting = (modalResult.values?.[SETTING_INPUT_ID] as SceneSettingId | undefined) ?? "storybeat";
    const settingPreset = SCENE_SETTING_PRESETS[selectedSetting] ?? SCENE_SETTING_PRESETS.storybeat;

    const selectedBackendValue = modalResult.values?.[BACKEND_INPUT_ID] as SceneImageBackend | undefined;
    const selectedBackend: SceneImageBackend | null =
      backendAvailability.showBackendSelector &&
      selectedBackendValue &&
      ((selectedBackendValue === "current_provider" && backendAvailability.currentProvider) ||
        (selectedBackendValue === "novelai" && backendAvailability.novelAi))
        ? selectedBackendValue
        : backendAvailability.defaultBackend;

    if (!selectedBackend) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.bot.generate.image.no_backend_title",
        descriptionKey: "commands.bot.generate.image.no_backend_description",
        descriptionVars: {
          current_provider: tomoriState.llm.llm_provider,
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    const extraDirection = modalResult.values?.[PROMPT_INPUT_ID]?.trim();

    // 13. Resolve the selected sender persona and its webhook identity.
    const selectedPersonaIdStr = modalResult.values?.[PERSONA_INPUT_ID];
    const selectedPersonaId = selectedPersonaIdStr ? Number.parseInt(selectedPersonaIdStr, 10) : tomoriState.tomori_id;
    const selectedPersona =
      availablePersonaSummaries.find((p) => p.tomori_id === selectedPersonaId) ?? fallbackPersonaSummary;

    if (
      !selectedPersona ||
      !isPersonaAllowedForTrigger(whitelistStatus, personalSpotlightStatus, selectedPersona.tomori_id)
    ) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.message_cooldown_title",
        descriptionKey: "commands.bot.generate.image.persona_access_blocked",
        color: ColorCode.WARN,
      });
      return;
    }

    let senderWebhook: import("discord.js").Webhook | undefined;
    let senderPersonaUsername: string | undefined;
    let senderPersonaAvatarUrl: string | undefined;

    if (selectedPersona) {
      senderPersonaUsername = selectedPersona.tomori_nickname;

      // Attempt to get or create the channel webhook for persona-identity posting.
      // Threads and channels without ManageWebhooks permission fall back to a direct bot message.
      const webhookChannel = interaction.guild.channels.cache.get(interaction.channel.id) ?? interaction.channel;

      if ("fetchWebhooks" in webhookChannel) {
        try {
          const webhookResult = await getOrCreateWebhook(webhookChannel as TextChannel | BaseGuildTextChannel);
          if (webhookResult.webhook) {
            senderWebhook = webhookResult.webhook;
            // Resolve avatar URL using the same identity path as normal persona messages.
            const identity = await resolvePersonaWebhookIdentity(
              selectedPersona as unknown as TomoriState,
              interaction.guild,
            );
            senderPersonaAvatarUrl = identity.avatarUrl ?? identity.avatarDataUri;
          }
        } catch (webhookError) {
          log.warn(
            "[/bot generate image] Failed to resolve persona webhook; image will post as bot",
            webhookError as Error,
          );
        }
      }
    }

    log.info(
      `[/bot generate image] Starting hidden image agent for channel ${interaction.channel.id} — backend=${selectedBackend}, preset=${settingPreset.plannerLabel}, sender=${selectedPersona?.tomori_nickname ?? "active"}`,
    );

    // 14. Invoke the hidden image agent turn.
    //     This replaces the old structured-output planner: the model now sees the
    //     full conversation context (persona prompt, users, memories, RAG docs, etc.)
    //     and is directed via a tail directive to call the appropriate image tool.
    // Pass a context override only when the selected persona differs from the active one,
    // so buildContext() prompts the model as the chosen sender persona.
    const contextPersonaOverride =
      selectedPersona && selectedPersona.tomori_id !== tomoriState.tomori_id
        ? {
            tomoriNickname: selectedPersona.tomori_nickname,
            personaPrompt: selectedPersona.persona_prompt,
            tomoriAttributes: selectedPersona.attribute_list,
            personaLineageId: selectedPersona.persona_lineage_id,
          }
        : undefined;

    const agentResult = await runHiddenImageTurn({
      channel: interaction.channel as Parameters<typeof runHiddenImageTurn>[0]["channel"],
      client,
      guild: interaction.guild,
      tomoriState,
      locale,
      interactingUserId: interaction.user.id,
      internalUserId: userData.user_id ?? null,
      backend: selectedBackend,
      presetLabel: settingPreset.plannerLabel,
      presetInstruction: settingPreset.plannerInstruction,
      aspectRatio: settingPreset.aspectRatio,
      naiOrientation: settingPreset.novelAiOrientation,
      extraDirection,
      webhook: senderWebhook,
      personaUsername: senderPersonaUsername,
      personaAvatarUrl: senderPersonaAvatarUrl,
      contextPersonaOverride,
    });

    if (!agentResult.success) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.bot.generate.image.planner_failed_title",
        descriptionKey: "commands.bot.generate.image.planner_failed_description",
        descriptionVars: {
          error: agentResult.error ?? "Unknown image generation error",
        },
        color: ColorCode.ERROR,
      });
      return;
    }

    log.success(
      `[/bot generate image] Hidden image agent completed for channel ${interaction.channel.id} — backend=${selectedBackend}`,
    );

    // 14. Acknowledge the modal submit interaction with an ephemeral success notice.
    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.bot.generate.image.success_title",
      descriptionKey: "commands.bot.generate.image.success_description",
      color: ColorCode.SUCCESS,
    });

    // 15. Record the cooldown entry after confirmed success.
    await cooldownRepository.setMessageTriggerCooldownWithWhitelist(
      interaction.guild.id,
      interaction.user.id,
      interaction.channel.id,
      cooldownType,
      cooldownLength,
      invokingMember,
    );
  } catch (error) {
    log.error("Error in /bot generate image", error as Error, {
      errorType: "BotGenerateImageCommandError",
      metadata: {
        userId: interaction.user.id,
        guildId: interaction.guild.id,
        channelId: interaction.channel.id,
      },
    });

    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.generate.image.error_generation_failed_title",
      descriptionKey: "commands.generate.image.error_generation_failed_description",
      descriptionVars: { error: errorMessage },
      color: ColorCode.ERROR,
    });
  }
}
