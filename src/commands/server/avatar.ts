import type {
  ChatInputCommandInteraction,
  Client,
  SlashCommandSubcommandBuilder,
  Attachment,
  APIAttachment,
  ModalSubmitInteraction,
} from "discord.js";
import { MessageFlags, EmbedBuilder } from "discord.js";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import { replyInfoEmbed, promptWithPaginatedModal, safeSelectOptionText } from "../../utils/discord/interactionHelper";
import type { UserRow, ErrorContext, TomoriState } from "../../types/db/schema";
import type { SelectOption } from "../../types/discord/modal";
import { safeDownload } from "../../utils/security/safeDownload";
import { memoryGuard, reserveAvatarQuota } from "../../utils/security/rateLimiter";
import { loadAllPersonasForServer } from "../../utils/db/dbRead";
import { sql } from "../../utils/db/client";
import { convertToPNG } from "../../utils/image/imageProcessor";
import { deletePersonaAvatarFromStorage, uploadPersonaAvatarToStorage } from "../../utils/storage/avatarStorage";
import { invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";

const PERSONA_SELECT_MODAL_ID = "server_avatar_persona_modal";
const PERSONA_SELECT_ID = "persona_select";
const FILE_UPLOAD_ID = "avatar_image";

type AvatarAttachment = Attachment | APIAttachment;
/**
 * Configure the avatar subcommand
 * @param subcommand - SlashCommandSubcommandBuilder instance
 * @returns Configured subcommand
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("avatar").setDescription(localizer("en-US", "commands.server.avatar.description"));

/**
 * Validates if the provided attachment is a valid image
 * @param attachment - Discord attachment to validate
 * @returns Object with isValid boolean and error message if invalid
 */
function validateImage(attachment: AvatarAttachment): {
  isValid: boolean;
  error?: string;
} {
  const contentType = "contentType" in attachment ? attachment.contentType : attachment.content_type;
  const filename = "name" in attachment ? attachment.name : attachment.filename;

  // 1. Check file size (Discord's limit is 8MB for bots)
  const maxSize = 8 * 1024 * 1024; // 8MB in bytes
  if (attachment.size > maxSize) {
    return {
      isValid: false,
      error: "FILE_TOO_LARGE",
    };
  }

  // 2. Check content type
  const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/gif"];
  if (!contentType || !allowedTypes.includes(contentType)) {
    return {
      isValid: false,
      error: "INVALID_FORMAT",
    };
  }

  // 3. Check file extension as backup validation
  const allowedExtensions = [".png", ".jpg", ".jpeg", ".gif"];
  const fileExtension = filename?.toLowerCase().split(".").pop();
  if (!fileExtension || !allowedExtensions.includes(`.${fileExtension}`)) {
    return {
      isValid: false,
      error: "INVALID_EXTENSION",
    };
  }

  return { isValid: true };
}

/**
 * Converts an image attachment to a base64 data URI with timeout protection
 * @param attachment - Discord attachment to convert
 * @returns Promise resolving to SafeDownloadResult-like object with dataUri or error
 */
async function attachmentToBase64DataUri(attachment: AvatarAttachment): Promise<{
  success: boolean;
  dataUri?: string;
  buffer?: Buffer;
  error?: "size_exceeded" | "timeout" | "network_error" | "invalid_response";
  details?: string;
}> {
  const contentType = "contentType" in attachment ? attachment.contentType : attachment.content_type;

  // 1. Use safeDownload with 15s timeout and 8MB size limit
  const downloadResult = await safeDownload(attachment.url, {
    maxSizeMB: 8,
    timeoutMs: 15000, // 15 seconds
    knownSize: attachment.size,
  });

  // 2. If download failed, return error
  if (!downloadResult.success) {
    return {
      success: false,
      error: downloadResult.error,
      details: downloadResult.details,
    };
  }

  // 3. Convert buffer to base64 data URI
  const base64 = downloadResult.buffer?.toString("base64");
  const mimeType = contentType || "image/png";
  const dataUri = `data:${mimeType};base64,${base64}`;

  return {
    success: true,
    dataUri,
    buffer: downloadResult.buffer,
  };
}

/**
 * Updates the bot's guild avatar using Discord's raw API with timeout protection
 * @param guildId - Guild ID where to update the avatar
 * @param avatarDataUri - Base64 data URI of the avatar image, or null to remove
 * @returns Promise resolving to object with success status and optional error type
 */
async function updateGuildAvatar(
  guildId: string,
  avatarDataUri: string | null,
): Promise<{
  success: boolean;
  error?: "timeout" | "api_error";
  details?: string;
}> {
  // 1. Setup timeout controller (15s)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    // 2. Prepare the API endpoint
    const endpoint = `https://discord.com/api/v10/guilds/${guildId}/members/@me`;

    // 3. Prepare the payload
    const payload = {
      avatar: avatarDataUri,
    };

    // 4. Make the API call with timeout
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      const context: ErrorContext = {
        errorType: "DiscordApiError",
        metadata: { guildId, httpStatus: response.status, body: errorText },
      };
      await log.error(`Failed to update guild avatar: ${response.status} ${response.statusText}`, undefined, context);
      return {
        success: false,
        error: "api_error",
        details: `${response.status} ${response.statusText}: ${errorText}`,
      };
    }

    return { success: true };
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle abort (timeout)
    if (error instanceof Error && error.name === "AbortError") {
      log.warn("Discord API call timed out after 15s", {
        metadata: { guildId },
      });
      return {
        success: false,
        error: "timeout",
        details: "Discord API call timed out after 15s",
      };
    }

    // Handle other errors
    await log.error("Error updating guild avatar via Discord API", error, {
      errorType: "DiscordApiError",
      metadata: { guildId },
    });
    return {
      success: false,
      error: "api_error",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Sets or removes TomoriBot's custom avatar for the current guild
 * @param client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - Locale of the interaction
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Ensure command is run in a guild
  if (!interaction.guild || !interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  let responseInteraction: ChatInputCommandInteraction | ModalSubmitInteraction = interaction;
  let selectedPersona: TomoriState | null = null;

  try {
    // 2. Load personas and prompt user to choose target persona
    const allPersonas = await loadAllPersonasForServer(interaction.guild.id);
    const personaSelectOptions: SelectOption[] = allPersonas
      .filter((persona) => persona.tomori_id !== undefined)
      .map((persona) => ({
        label: safeSelectOptionText(persona.tomori_nickname),
        value: persona.tomori_id?.toString() ?? "",
        description: persona.is_alter
          ? localizer(locale, "commands.server.avatar.alter_persona_description")
          : localizer(locale, "commands.server.avatar.main_persona_description"),
      }))
      .filter((option) => option.value !== "");
    if (personaSelectOptions.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: PERSONA_SELECT_MODAL_ID,
      modalTitleKey: "commands.server.avatar.persona_modal_title",
      components: [
        {
          customId: PERSONA_SELECT_ID,
          labelKey: "commands.server.avatar.persona_select_label",
          descriptionKey: "commands.server.avatar.persona_select_description",
          placeholder: "commands.server.avatar.persona_select_placeholder",
          required: true,
          options: personaSelectOptions,
        },
        {
          customId: FILE_UPLOAD_ID,
          labelKey: "commands.server.avatar.image_label",
          descriptionKey: "commands.server.avatar.image_description",
          minValues: 0,
          maxValues: 1,
          required: false,
        },
      ],
    });

    if (modalResult.outcome !== "submit") {
      log.info(`Server avatar persona select modal ${modalResult.outcome} for user ${interaction.user.id}`);
      return;
    }

    const modalSubmitInteraction = modalResult.interaction;
    if (!modalSubmitInteraction) {
      return;
    }
    responseInteraction = modalSubmitInteraction;

    const selectedPersonaId = modalResult.values?.[PERSONA_SELECT_ID];
    selectedPersona = allPersonas.find((persona) => persona.tomori_id?.toString() === selectedPersonaId) ?? null;
    if (!selectedPersona?.tomori_id) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 3. Defer the reply to prevent timeout during image processing
    await responseInteraction.deferReply({ flags: MessageFlags.Ephemeral });

    // 4. Memory guard check (defense-in-depth)
    const memCheck = memoryGuard.checkMemory();
    if (memCheck.status === "critical") {
      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "rate_limit.error_memory_critical_title"))
            .setDescription(localizer(locale, "rate_limit.error_memory_critical_description"))
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    // 5. Reserve avatar quota (atomic check+increment for per-server DDoS protection)
    const quotaReserve = reserveAvatarQuota(interaction.guild.id);
    if (!quotaReserve.allowed) {
      const resetTime = quotaReserve.resetAt ? new Date(quotaReserve.resetAt).toLocaleString(locale) : "unknown";

      await responseInteraction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(localizer(locale, "rate_limit.error_quota_exceeded_title"))
            .setDescription(
              localizer(locale, "rate_limit.error_quota_exceeded_description", {
                reset_time: resetTime,
              }),
            )
            .setColor(ColorCode.ERROR),
        ],
      });
      return;
    }

    // 6. Resolve the optional modal upload
    const imageAttachment = modalResult.attachments?.[FILE_UPLOAD_ID];
    const isMainPersona = !selectedPersona.is_alter;

    // 7. Handle avatar removal (no attachment provided)
    if (!imageAttachment) {
      if (isMainPersona) {
        const result = await updateGuildAvatar(interaction.guild.id, null);

        if (result.success) {
          // Quota already reserved at step 5 - no increment needed
          await replyInfoEmbed(responseInteraction, locale, {
            titleKey: "commands.server.avatar.removed_title",
            descriptionKey: "commands.server.avatar.removed_description",
            color: ColorCode.SUCCESS,
          });
        } else if (result.error === "timeout") {
          await replyInfoEmbed(responseInteraction, locale, {
            titleKey: "commands.server.avatar.error_api_timeout",
            descriptionKey: "commands.server.avatar.error_api_timeout",
            color: ColorCode.ERROR,
          });
        } else {
          const baseMsg = localizer(locale, "commands.server.avatar.api_error_description");
          await replyInfoEmbed(responseInteraction, locale, {
            titleKey: "commands.server.avatar.api_error_title",
            description: result.details ? `${baseMsg}\n-# ${result.details}` : baseMsg,
            color: ColorCode.ERROR,
            descriptionVars: { details: result.details ?? "" },
          });
        }
      } else {
        if (selectedPersona.webhook_avatar_url) {
          await deletePersonaAvatarFromStorage(selectedPersona.webhook_avatar_url);
        }

        await sql`
					UPDATE tomoris
					SET webhook_avatar_url = NULL
					WHERE tomori_id = ${selectedPersona.tomori_id}
				`;

        invalidateTomoriStateCache(interaction.guild.id);

        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.server.avatar.removed_title",
          descriptionKey: "commands.server.avatar.removed_alter_description",
          descriptionVars: { persona_name: selectedPersona.tomori_nickname },
          color: ColorCode.SUCCESS,
        });
      }
      return;
    }

    // 8. Validate the image attachment
    const validation = validateImage(imageAttachment);
    if (!validation.isValid) {
      let errorKey = "invalid_image_description";
      switch (validation.error) {
        case "FILE_TOO_LARGE":
          errorKey = "file_too_large_description";
          break;
        case "INVALID_FORMAT":
        case "INVALID_EXTENSION":
          errorKey = "invalid_format_description";
          break;
      }

      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.server.avatar.invalid_image_title",
        descriptionKey: `commands.server.avatar.${errorKey}`,
        color: ColorCode.ERROR,
      });
      return;
    }

    // 9. Convert image to base64 data URI with timeout protection
    const downloadResult = await attachmentToBase64DataUri(imageAttachment);
    if (!downloadResult.success) {
      let errorKey: string;
      if (downloadResult.error === "size_exceeded") {
        errorKey = "commands.server.avatar.file_too_large_description";
      } else if (downloadResult.error === "timeout") {
        errorKey = "commands.server.avatar.error_download_timeout";
      } else {
        errorKey = "commands.server.avatar.conversion_error_description";
      }

      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.server.avatar.invalid_image_title",
        descriptionKey: errorKey,
        color: ColorCode.ERROR,
      });
      return;
    }

    if (isMainPersona) {
      // biome-ignore lint/style/noNonNullAssertion: Download result is checked in success condition
      const avatarDataUri = downloadResult.dataUri!;

      // 10. Update guild avatar for main persona via Discord API with timeout protection
      const updateResult = await updateGuildAvatar(interaction.guild.id, avatarDataUri);

      if (updateResult.success) {
        // Quota already reserved at step 5 - no increment needed
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.server.avatar.success_title",
          descriptionKey: "commands.server.avatar.success_description",
          color: ColorCode.SUCCESS,
        });
      } else if (updateResult.error === "timeout") {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.server.avatar.error_api_timeout",
          descriptionKey: "commands.server.avatar.error_api_timeout",
          color: ColorCode.ERROR,
        });
      } else {
        const baseMsg = localizer(locale, "commands.server.avatar.api_error_description");
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.server.avatar.api_error_title",
          description: updateResult.details ? `${baseMsg}\n-# ${updateResult.details}` : baseMsg,
          color: ColorCode.ERROR,
          descriptionVars: { details: updateResult.details ?? "" },
        });
      }
    } else {
      // 10. Alter persona path:
      // - production: upload avatar to S3 and store URL
      // - non-production: update/create persona webhooks and store permanent webhook avatar URL
      let persistedAvatarUrl: string | null = null;
      // biome-ignore lint/style/noNonNullAssertion: Download result is checked in success condition
      const downloadedBuffer = downloadResult.buffer!;
      let pngBuffer: Buffer;
      try {
        pngBuffer = await convertToPNG(downloadedBuffer);
      } catch (error) {
        log.warn("Failed to convert selected alter avatar image to PNG", error);
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.server.avatar.conversion_error_title",
          descriptionKey: "commands.server.avatar.conversion_error_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      persistedAvatarUrl = await uploadPersonaAvatarToStorage({
        personaId: selectedPersona.tomori_id,
        serverDiscId: interaction.guild.id,
        label: "server avatar",
        buffer: pngBuffer,
      });

      if (!persistedAvatarUrl) {
        await replyInfoEmbed(responseInteraction, locale, {
          titleKey: "commands.server.avatar.api_error_title",
          descriptionKey: "commands.server.avatar.api_error_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      if (persistedAvatarUrl) {
        if (selectedPersona.webhook_avatar_url && selectedPersona.webhook_avatar_url !== persistedAvatarUrl) {
          await deletePersonaAvatarFromStorage(selectedPersona.webhook_avatar_url);
        }

        await sql`
					UPDATE tomoris
					SET webhook_avatar_url = ${persistedAvatarUrl}
					WHERE tomori_id = ${selectedPersona.tomori_id}
				`;
      }

      invalidateTomoriStateCache(interaction.guild.id);

      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.server.avatar.success_title",
        descriptionKey: "commands.server.avatar.success_alter_description",
        descriptionVars: { persona_name: selectedPersona.tomori_nickname },
        color: ColorCode.SUCCESS,
      });
    }
  } catch (error) {
    const context: ErrorContext = {
      errorType: "CommandExecutionError",
      metadata: {
        command: "config avatar",
        guildId: interaction.guild.id,
        personaId: selectedPersona?.tomori_id ?? null,
      },
    };
    await log.error("Error in /config avatar command", error, context);

    const errorReplyInteraction =
      responseInteraction.replied || responseInteraction.deferred
        ? responseInteraction
        : interaction.replied || interaction.deferred
          ? interaction
          : null;
    if (errorReplyInteraction) {
      await replyInfoEmbed(errorReplyInteraction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
    }
  }
}
