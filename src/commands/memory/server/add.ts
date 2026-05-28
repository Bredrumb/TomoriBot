import type {
  ChatInputCommandInteraction,
  Client,
  SlashCommandSubcommandBuilder,
  ModalSubmitInteraction,
} from "discord.js";
import { MessageFlags, TextInputStyle } from "discord.js";
import { sql } from "@/utils/db/client";
import type { UserRow, ErrorContext, TomoriState } from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed, promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/interactionHelper";
import { isBlacklisted, loadAllPersonasForServer } from "@/utils/db/dbRead";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import type { ModalResult, SelectOption } from "@/types/discord/modal";
import { validateMemoryContent, checkServerMemoryLimit, getMemoryLimits } from "@/utils/db/memoryLimits";
import { addServerMemoryByTomori } from "@/utils/db/dbWrite";
import { dedupeCaseInsensitive, getNonEmptyNumberedLines, readTxtUpload } from "@/utils/teach/batchUploadUtils";

// Rule 20: Constants for modal and input IDs
const MODAL_CUSTOM_ID = "teach_servermemory_add_modal";
const MEMORY_INPUT_ID = "memory_input";
const MEMORY_FILE_UPLOAD_ID = "server_memory_file_upload";
const MEMORY_TAGS_INPUT_ID = "memory_tags_input";

const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 32;

// Get memory limits from environment variables
const memoryLimits = getMemoryLimits();

// Rule 21: Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("add").setDescription(localizer("en-US", "commands.memory.server.add.description"));

/**
 * Rule 1: JSDoc comment for exported function
 * Adds a server memory to Tomori's knowledge for the server by inserting into the server_memories table.
 * @param _client - Discord client instance
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
  // 1. Ensure command is run in a valid channel context (Rule 17)
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Define state and modal result outside try for catch block
  let tomoriState: TomoriState | null = null;
  let selectedPersona: TomoriState | null = null;
  let modalResult: ModalResult | null = null;
  // Define modalSubmitInteraction here to be accessible in catch block
  let modalSubmitInteraction: ModalSubmitInteraction | null = null;

  try {
    // 2. Check if user has Manage Server permission - used for blacklist and teaching restriction bypass
    const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;

    // 3. Check blacklisting only for guild contexts
    // Users with Manage Server permission can bypass blacklist (they can unblacklist themselves anyway)
    if (interaction.guild) {
      const blacklisted = (await isBlacklisted(interaction.guild.id, interaction.user.id)) ?? false;
      if (blacklisted && !hasManagePermission) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "general.errors.user_blacklisted_title",
          descriptionKey: "general.errors.user_blacklisted_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    // 4. Load server's Tomori state (Rule 17) - Still needed for server_id and config checks
    tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);

    // 5. Check if Tomori is set up
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 6. Resolve target persona (default: current main persona)
    const allPersonas = await loadAllPersonasForServer(interaction.guild?.id ?? interaction.user.id);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const personaSelectOptions: SelectOption[] = allPersonas
      .filter((persona) => persona.tomori_id !== undefined)
      .map((persona) => ({
        label: safeSelectOptionText(persona.tomori_nickname),
        value: persona.tomori_id?.toString() ?? "",
        description: persona.is_alter
          ? localizer(locale, "commands.teach.memory.server.alter_persona_description")
          : localizer(locale, "commands.teach.memory.server.main_persona_description"),
      }))
      .filter((option) => option.value !== "");

    // 7. Check if server memory teaching is enabled
    // NOTE: Check the correct config key name from tomori_configs table
    if (
      !tomoriState.config.server_memteaching_enabled && // Assuming this is the correct key
      !hasManagePermission
    ) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.teach.memory.server.teaching_disabled_title",
        descriptionKey: "commands.teach.memory.server.teaching_disabled_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 8. Prompt user with persona selector + memory input in one modal
    modalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.teach.memory.server.modal_title",
      components: [
        {
          customId: "persona_select",
          labelKey: "commands.teach.memory.server.persona_select_label",
          descriptionKey: "commands.teach.memory.server.persona_select_description",
          placeholder: "commands.teach.memory.server.persona_select_placeholder",
          required: true,
          options: personaSelectOptions,
        },
        {
          customId: MEMORY_INPUT_ID,
          labelKey: "commands.teach.memory.server.memory_input_label",
          descriptionKey: "commands.teach.memory.server.memory_input_description",
          placeholder: "commands.teach.memory.server.memory_input_placeholder",
          style: TextInputStyle.Paragraph,
          required: false,
          maxLength: memoryLimits.maxMemoryLength,
        },
        {
          customId: MEMORY_FILE_UPLOAD_ID,
          labelKey: "commands.teach.memory.server.batch_file_label",
          descriptionKey: "commands.teach.memory.server.batch_file_description",
          minValues: 0,
          maxValues: 1,
          required: false,
        },
        {
          customId: MEMORY_TAGS_INPUT_ID,
          labelKey: "Memory Tags",
          descriptionKey:
            "Up to 5 comma-separated case-sensitive tags, use '/memory tagging set' to enable tagged memory",
          placeholder: "mango,drinks,snacks",
          style: TextInputStyle.Short,
          required: false,
          maxLength: MAX_TAGS * (MAX_TAG_LENGTH + 2),
        },
      ],
    });

    // 10. Handle modal outcome
    if (modalResult.outcome !== "submit") {
      log.info(`Server memory add modal ${modalResult.outcome} for user ${userData.user_id}`);
      return;
    }

    // 11. Capture the modal submission interaction - let helper functions manage interaction state
    // biome-ignore lint/style/noNonNullAssertion: Outcome 'submit' guarantees interaction
    modalSubmitInteraction = modalResult.interaction!;

    // 12. Get input from modal
    const typedMemory = modalResult.values?.[MEMORY_INPUT_ID]?.trim() ?? "";
    const uploadedTextFile = modalResult.attachments?.[MEMORY_FILE_UPLOAD_ID];
    const rawTagsInput = modalResult.values?.[MEMORY_TAGS_INPUT_ID]?.trim() ?? "";
    const parsedTags = rawTagsInput
      ? [
          ...new Set(
            rawTagsInput
              .split(",")
              .map((t) => t.trim().replace(/^["']+|["']+$/g, ""))
              .filter((t) => t.length > 0 && t.length <= MAX_TAG_LENGTH),
          ),
        ].slice(0, MAX_TAGS)
      : [];
    const selectedPersonaId = modalResult.values?.persona_select;
    selectedPersona = allPersonas.find((persona) => persona.tomori_id?.toString() === selectedPersonaId) ?? null;
    if (!selectedPersona?.tomori_id) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      });
      return;
    }
    const targetUserId = userData.user_id;
    if (!targetUserId) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.operation_failed_title",
        descriptionKey: "general.errors.operation_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }
    const targetTomoriId = selectedPersona.tomori_id;
    const targetPersonaLineageId = selectedPersona.persona_lineage_id ?? 0;
    const targetServerId = tomoriState.server_id;

    const pendingMemories: string[] = [];
    if (typedMemory) {
      pendingMemories.push(typedMemory);
    }

    if (uploadedTextFile) {
      const uploadResult = await readTxtUpload(uploadedTextFile);
      if (!uploadResult.isValid || !uploadResult.text) {
        const errorKey =
          uploadResult.error === "invalid_format"
            ? "commands.teach.memory.server.invalid_file_description"
            : uploadResult.error === "file_too_large"
              ? "commands.teach.memory.server.file_too_large_description"
              : "commands.teach.memory.server.download_failed_description";

        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.teach.memory.server.invalid_file_title",
          descriptionKey: errorKey,
          descriptionVars: {
            max_size: "1",
          },
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const importedMemories = getNonEmptyNumberedLines(uploadResult.text).map((line) => line.content);
      pendingMemories.push(...importedMemories);
    }

    if (pendingMemories.length === 0) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.teach.memory.server.no_input_title",
        descriptionKey: "commands.teach.memory.server.no_input_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const dedupedMemories = dedupeCaseInsensitive(pendingMemories);

    // 13. Validate memory content lengths
    for (const memory of dedupedMemories) {
      const contentValidation = validateMemoryContent(memory);
      if (!contentValidation.isValid) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.teach.memory.server.content_too_long_title",
          descriptionKey: "commands.teach.memory.server.content_too_long_description",
          descriptionVars: { max_length: memoryLimits.maxMemoryLength },
          color: ColorCode.ERROR,
        });
        return;
      }
    }

    const existingRows = await sql`
			SELECT content
			FROM server_memories
			WHERE server_id = ${targetServerId}
			  AND persona_lineage_id = ${targetPersonaLineageId}
		`;
    const existingMemories = new Set(
      existingRows
        .map((row: { content?: unknown }) => (typeof row.content === "string" ? row.content.trim().toLowerCase() : ""))
        .filter((content: string) => content.length > 0),
    );
    const memoriesToAdd = dedupedMemories.filter((memory) => !existingMemories.has(memory.toLowerCase()));

    if (memoriesToAdd.length === 0) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.teach.memory.server.duplicate_title",
        descriptionKey: "commands.teach.memory.server.duplicate_description",
        descriptionVars: {
          memory: dedupedMemories[0] ?? typedMemory,
        },
        color: ColorCode.WARN,
      });
      return;
    }

    // 13.5 Check server memory limit after final persona resolution
    const serverLimitCheck = await checkServerMemoryLimit(targetServerId, targetPersonaLineageId);
    const currentCount = serverLimitCheck.currentCount ?? existingRows.length;
    const maxAllowed = serverLimitCheck.maxAllowed ?? memoryLimits.maxServerMemories;
    const availableSlots = Math.max(0, maxAllowed - currentCount);
    if (memoriesToAdd.length > availableSlots) {
      const removeCount = memoriesToAdd.length - availableSlots;
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: uploadedTextFile
          ? "commands.teach.memory.server.batch_limit_exceeded_title"
          : "commands.teach.memory.server.limit_exceeded_title",
        descriptionKey: uploadedTextFile
          ? "commands.teach.memory.server.batch_limit_exceeded_description"
          : "commands.teach.memory.server.limit_exceeded_description",
        descriptionVars: uploadedTextFile
          ? {
              current_count: currentCount.toString(),
              max_allowed: maxAllowed.toString(),
              import_count: memoriesToAdd.length.toString(),
              remove_count: removeCount.toString(),
            }
          : {
              current_count: currentCount.toString(),
              max_allowed: maxAllowed.toString(),
            },
        color: ColorCode.ERROR,
      });
      return;
    }

    // 14. Insert into persona-scoped server memories table
    let insertSuccess = true;
    if (memoriesToAdd.length === 1) {
      const insertedMemory = await addServerMemoryByTomori(
        targetServerId,
        targetTomoriId,
        targetPersonaLineageId,
        targetUserId,
        memoriesToAdd[0] ?? "",
        parsedTags,
      );
      insertSuccess = insertedMemory !== null;
    } else {
      try {
        await sql.transaction(async (tx) => {
          for (const memory of memoriesToAdd) {
            await tx`
							INSERT INTO server_memories (server_id, tomori_id, persona_lineage_id, user_id, content, tags)
							VALUES (${targetServerId}, ${targetTomoriId}, ${targetPersonaLineageId}, ${targetUserId}, ${memory}, ${sql.array(parsedTags)})
						`;
          }
        });
      } catch (insertError) {
        insertSuccess = false;
        await log.error("Batch insert failed for server memories", insertError, {
          userId: userData.user_id,
          serverId: targetServerId,
          tomoriId: targetTomoriId,
          errorType: "DatabaseValidationError",
          metadata: {
            command: "teach servermemory",
            insertCount: memoriesToAdd.length,
            targetTomoriId: targetTomoriId,
          },
        });
      }
    }

    if (!insertSuccess) {
      // Rule 22: Log error with context
      const context: ErrorContext = {
        userId: userData.user_id,
        serverId: targetServerId,
        tomoriId: targetTomoriId,
        errorType: "DatabaseValidationError",
        metadata: {
          command: "teach servermemory",
          table: "server_memories",
          operation: "INSERT",
          userDiscordId: interaction.user.id,
          newMemoryContent: memoriesToAdd.join("\n"),
          targetTomoriId: targetTomoriId,
        },
      };
      await log.error("Failed to insert server memory data", new Error("Insert returned null"), context);

      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title", // Re-use generic failure message
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 15. Invalidate cache so next message gets fresh config
    invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

    // 16. Success! Confirm addition (Rule 12, 19)
    const firstMemory = memoriesToAdd[0] ?? "";
    const memoryPreview = firstMemory.length > 96 ? `${firstMemory.slice(0, 96)}...` : firstMemory;

    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey:
        memoriesToAdd.length > 1 || uploadedTextFile
          ? "commands.teach.memory.server.batch_success_title"
          : "commands.teach.memory.server.success_title",
      descriptionKey:
        memoriesToAdd.length > 1 || uploadedTextFile
          ? "commands.teach.memory.server.batch_success_description"
          : "commands.teach.memory.server.success_description",
      descriptionVars:
        memoriesToAdd.length > 1 || uploadedTextFile
          ? {
              added_count: memoriesToAdd.length.toString(),
            }
          : {
              memory: memoryPreview,
            },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    // Rule 22: Log error with context
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      tomoriId: tomoriState?.tomori_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "teach servermemory",
        userDiscordId: interaction.user.id,
        guildId: interaction.guild?.id,
      },
    };
    await log.error("Error in /teach servermemory command", error, context);

    // Rule 12, 19: Reply with unknown error embed
    // Determine which interaction to use (Rule 25)
    const errorReplyInteraction =
      modalSubmitInteraction && (modalSubmitInteraction.replied || modalSubmitInteraction.deferred)
        ? modalSubmitInteraction
        : interaction.replied || interaction.deferred
          ? interaction
          : null;

    if (errorReplyInteraction) {
      try {
        await replyInfoEmbed(errorReplyInteraction, locale, {
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
      } catch (replyError) {
        log.error("Failed to send error reply in servermemory catch block", replyError, {
          ...context,
          errorType: "ErrorReplyFailed",
        });
      }
    } else {
      log.warn(
        "Interaction was not replied or deferred in servermemory catch block, cannot send error message to user.",
        context,
      );
    }
  }
}
