import type { ChatInputCommandInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { CustomEndpointApiStyle, CustomEndpointCapability, ErrorContext, UserRow } from "@/types/db/schema";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { promptWithRawModal, replyInfoEmbed } from "@/utils/discord/interactionHelper";
import { log, ColorCode } from "@/utils/misc/logger";
import { validateRemoteMcpUrl } from "@/utils/mcp/mcpUrlSecurity";
import {
  buildCapabilityAddModalComponents,
  capabilityNeedsAddModal,
  ModalFieldId,
  parseCapabilityModalFields,
} from "@/utils/provider/customEndpointCapabilityModal";
import { registerCustomEndpoint, validateCustomEndpointReachability } from "@/utils/provider/customEndpointService";
import { isValidCustomEndpointLabel, normalizeCustomEndpointLabel } from "@/utils/provider/customProviderUtils";
import { IMPORT_LIMITS } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";
import { localizer } from "@/utils/text/localizer";

const WORKFLOW_UPLOAD_ID = "workflow_json";
const WORKFLOW_SUPPORTS_ID = "workflow_supports";
const DEFAULT_WORKFLOW_SUPPORTS = ["txt2img", "img2img"];

/** Download and parse a workflow JSON from a URL returned by Discord's CDN. */
async function loadWorkflowJson(url: string | null): Promise<Record<string, unknown> | null> {
  if (!url) {
    return null;
  }

  const downloadResult = await safeDownload(url, {
    maxSizeMB: IMPORT_LIMITS.MAX_DATA_IMPORT_SIZE_MB,
    timeoutMs: 10_000,
  });
  if (!downloadResult.success || !downloadResult.buffer) {
    throw new Error(`Workflow download failed: ${downloadResult.details ?? downloadResult.error ?? "unknown error"}`);
  }

  return JSON.parse(downloadResult.buffer.toString("utf8")) as Record<string, unknown>;
}

/**
 * Phase 4.5 (updated): slim routing fields only.
 * Capability-specific advanced fields are collected via a follow-up modal.
 * workflow_json is collected in the image/video capability modal (file upload component).
 * Personal endpoints use strict remote URL validation.
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("add")
    .setDescription(localizer("en-US", "commands.personal.custom_models.add.description"))
    .addStringOption((option) =>
      option
        .setName("endpoint_label")
        .setDescription(localizer("en-US", "commands.personal.custom_models.add.label_description"))
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("capability")
        .setDescription(localizer("en-US", "commands.personal.custom_models.add.capability_description"))
        .setRequired(true)
        .addChoices(
          { name: "Text", value: "text" },
          { name: "Embedding", value: "embedding" },
          { name: "Image", value: "image" },
          { name: "Video", value: "video" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("api_style")
        .setDescription(localizer("en-US", "commands.personal.custom_models.add.api_style_description"))
        .setRequired(true)
        .addChoices(
          { name: localizer("en-US", "general.api_styles.openai_compatible"), value: "openai-compatible" },
          { name: localizer("en-US", "general.api_styles.comfyui"), value: "comfyui" },
          { name: localizer("en-US", "general.api_styles.ollama_native"), value: "ollama-native" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("endpoint_url")
        .setDescription(localizer("en-US", "commands.personal.custom_models.add.endpoint_url_description"))
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("auth_token")
        .setDescription(localizer("en-US", "commands.personal.custom_models.add.auth_token_description"))
        .setRequired(false),
    );

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.channel || !userData.user_id) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const rawLabel = interaction.options.getString("endpoint_label", true);
  const label = normalizeCustomEndpointLabel(rawLabel);
  const capability = interaction.options.getString("capability", true) as CustomEndpointCapability;
  const apiStyle = interaction.options.getString("api_style", true) as CustomEndpointApiStyle;
  const endpointUrl = interaction.options.getString("endpoint_url", true).trim();
  const authToken = interaction.options.getString("auth_token");

  if (!isValidCustomEndpointLabel(label)) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.invalid_option_title",
      descriptionKey: "commands.config.custom_models.validation.invalid_label",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Strict validation: personal endpoints must be reachable remote hosts.
  const urlValidation = await validateRemoteMcpUrl(endpointUrl, { strict: true });
  if (!urlValidation.valid) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.custom_endpoint_unreachable_title",
      descriptionKey: "commands.config.custom_models.validation.unreachable",
      descriptionVars: { reason: urlValidation.failureCode ?? "invalid_url" },
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modalCustomId = `personal_endpoint_add_modal_${interaction.id}`;

  // 1a. Capabilities with a detail modal: show it as the primary interaction response.
  if (capabilityNeedsAddModal(capability)) {
    const modalResult = await promptWithRawModal(interaction, locale, {
      modalCustomId,
      modalTitleKey: `commands.config.custom_models.capability_modal.${capability}_title`,
      components: buildCapabilityAddModalComponents(capability, locale),
    });

    if (modalResult.outcome !== "submit") return;

    // biome-ignore lint/style/noNonNullAssertion: submit outcome guarantees interaction exists
    const modalSubmit = modalResult.interaction!;
    await modalSubmit.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const parsed = parseCapabilityModalFields(modalResult.values ?? {}, modalResult.multiValues ?? {}, capability);

      if ((capability === "text" || capability === "embedding") && !parsed.modelName) {
        await replyInfoEmbed(modalSubmit, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "commands.config.custom_models.validation.model_name_required",
          color: ColorCode.ERROR,
        });
        return;
      }

      const reachability = await validateCustomEndpointReachability({
        apiStyle,
        endpointUrl,
        apiKey: authToken,
        strict: true,
      });
      if (!reachability.ok) {
        await replyInfoEmbed(modalSubmit, locale, {
          titleKey: "general.errors.custom_endpoint_unreachable_title",
          descriptionKey: "commands.config.custom_models.validation.unreachable",
          descriptionVars: { reason: reachability.reason },
          color: ColorCode.ERROR,
        });
        return;
      }

      const displayName = parsed.displayName || parsed.modelName || label;

      const registered = await registerCustomEndpoint({
        scope: { kind: "personal", ownerId: userData.user_id, baseConfig: tomoriState.config },
        label,
        capability,
        apiStyle,
        endpointUrl,
        displayName,
        modelName: parsed.modelName,
        authToken,
        numCtx: parsed.numCtx,
        hasTools: parsed.hasTools,
        seesImages: parsed.seesImages,
        supportsStructOutput: parsed.supportsStructOutput,
        extraConfig: {},
      });

      if (!registered) {
        await replyInfoEmbed(modalSubmit, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      await replyInfoEmbed(modalSubmit, locale, {
        titleKey: "commands.personal.custom_models.add.success_title",
        descriptionKey: "commands.personal.custom_models.add.success_description",
        descriptionVars: { display_name: displayName, label, capability },
        color: ColorCode.SUCCESS,
      });
    } catch (error) {
      const context: ErrorContext = {
        userId: userData.user_id,
        serverId: tomoriState.server_id,
        tomoriId: tomoriState.tomori_id,
        errorType: "CommandExecutionError",
        metadata: {
          command: "personal custom-endpoint add",
          guildId: interaction.guild?.id,
          executorDiscordId: interaction.user.id,
        },
      };
      await log.error("Error executing /personal custom-endpoint add (modal path)", error as Error, context);
      await replyInfoEmbed(modalSubmit, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
    }
    return;
  }

  // 1b. Image / video: show a raw modal with model_name, display_name, and workflow_json file upload.
  const imageVideoModalCustomId = `personal_endpoint_add_image_modal_${interaction.id}`;
  const modalResult = await promptWithRawModal(interaction, locale, {
    modalCustomId: imageVideoModalCustomId,
    modalTitleKey: `commands.config.custom_models.capability_modal.${capability}_title`,
    components: [
      {
        customId: ModalFieldId.model_name,
        labelKey: "commands.config.custom_models.capability_modal.model_name_label",
        placeholder: localizer(locale, "commands.config.custom_models.capability_modal.model_name_placeholder"),
        required: false,
        maxLength: 200,
      },
      {
        customId: ModalFieldId.display_name,
        labelKey: "commands.config.custom_models.capability_modal.display_name_label",
        placeholder: localizer(locale, "commands.config.custom_models.capability_modal.display_name_placeholder"),
        required: false,
        maxLength: 100,
      },
      {
        customId: WORKFLOW_UPLOAD_ID,
        labelKey: "commands.config.custom_models.capability_modal.workflow_json_label",
        descriptionKey: "commands.config.custom_models.capability_modal.workflow_json_description",
        minValues: 0,
        maxValues: 1,
        required: false,
      },
      ...(capability === "image" && apiStyle === "comfyui"
        ? [
            {
              kind: "checkboxGroup" as const,
              customId: WORKFLOW_SUPPORTS_ID,
              labelKey: "commands.config.custom_models.capability_modal.workflow_supports_label",
              descriptionKey: "commands.config.custom_models.capability_modal.workflow_supports_description",
              options: [
                {
                  value: "txt2img",
                  label: localizer(locale, "commands.config.custom_models.capability_modal.workflow_support_txt2img"),
                  description: localizer(
                    locale,
                    "commands.config.custom_models.capability_modal.workflow_support_txt2img_description",
                  ),
                  default: true,
                },
                {
                  value: "img2img",
                  label: localizer(locale, "commands.config.custom_models.capability_modal.workflow_support_img2img"),
                  description: localizer(
                    locale,
                    "commands.config.custom_models.capability_modal.workflow_support_img2img_description",
                  ),
                  default: true,
                },
                {
                  value: "inpaint",
                  label: localizer(locale, "commands.config.custom_models.capability_modal.workflow_support_inpaint"),
                  description: localizer(
                    locale,
                    "commands.config.custom_models.capability_modal.workflow_support_inpaint_description",
                  ),
                },
              ],
              minValues: 1,
              maxValues: 3,
              required: true,
            },
          ]
        : []),
    ],
  });

  if (modalResult.outcome !== "submit") {
    return;
  }

  // biome-ignore lint/style/noNonNullAssertion: submit outcome guarantees interaction exists
  const modalSubmit = modalResult.interaction!;

  try {
    await modalSubmit.deferReply({ flags: MessageFlags.Ephemeral });

    const modelName = modalResult.values?.[ModalFieldId.model_name]?.trim() || null;
    const displayName = modalResult.values?.[ModalFieldId.display_name]?.trim() || label;
    const workflowAttachment = modalResult.attachments?.[WORKFLOW_UPLOAD_ID];
    const workflowSupportValues = new Set(modalResult.multiValues?.[WORKFLOW_SUPPORTS_ID] ?? DEFAULT_WORKFLOW_SUPPORTS);

    if ((capability === "image" || capability === "video") && apiStyle === "comfyui" && !workflowAttachment) {
      await replyInfoEmbed(modalSubmit, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "commands.config.custom_models.validation.workflow_required",
        color: ColorCode.ERROR,
      });
      return;
    }

    const reachability = await validateCustomEndpointReachability({
      apiStyle,
      endpointUrl,
      apiKey: authToken,
      strict: true,
    });
    if (!reachability.ok) {
      await replyInfoEmbed(modalSubmit, locale, {
        titleKey: "general.errors.custom_endpoint_unreachable_title",
        descriptionKey: "commands.config.custom_models.validation.unreachable",
        descriptionVars: { reason: reachability.reason },
        color: ColorCode.ERROR,
      });
      return;
    }

    const workflow = workflowAttachment ? await loadWorkflowJson(workflowAttachment.url) : null;
    const workflowSupports =
      capability === "image" && apiStyle === "comfyui"
        ? {
            txt2img: workflowSupportValues.has("txt2img"),
            img2img: workflowSupportValues.has("img2img"),
            inpaint: workflowSupportValues.has("inpaint"),
          }
        : undefined;

    const registered = await registerCustomEndpoint({
      scope: { kind: "personal", ownerId: userData.user_id, baseConfig: tomoriState.config },
      label,
      capability,
      apiStyle,
      endpointUrl,
      displayName,
      modelName,
      authToken,
      extraConfig: {
        ...(workflow ? { workflow } : {}),
        ...(workflowSupports ? { workflow_supports: workflowSupports } : {}),
      },
    });

    if (!registered) {
      await replyInfoEmbed(modalSubmit, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await replyInfoEmbed(modalSubmit, locale, {
      titleKey: "commands.personal.custom_models.add.success_title",
      descriptionKey: "commands.personal.custom_models.add.success_description",
      descriptionVars: { display_name: displayName, label, capability },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState.server_id,
      tomoriId: tomoriState.tomori_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal custom-endpoint add",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /personal custom-endpoint add (image/video path)", error as Error, context);
    await replyInfoEmbed(modalSubmit, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
