import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  Client,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { sql } from "@/utils/db/client";
import {
  serverMemorySchema, // Use the correct schema for validation
  type UserRow,
  type ErrorContext,
  type TomoriState,
} from "@/types/db/schema";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import {
  acknowledgeModalSubmitForRefresh,
  replyInfoEmbed,
  replyComponentsV2Status,
  updateButtonComponentsV2Status,
  type AvatarSessionCache,
  replyPaginatedPersonaChoicesV2,
  promptWithPaginatedModal,
  safeSelectOptionText,
} from "@/utils/discord/interactionHelper";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import type { SelectOption } from "@/types/discord/modal";
import { loadAllPersonasForServer } from "@/utils/db/repositories";

// Rule 20: Constants for static values at the top
const MODAL_CUSTOM_ID = "forget_servermemory_modal";
const MEMORY_SELECT_ID = "memory_select";

/**
 * Helper function to perform server memory removal from database
 * @param tomoriState - Current Tomori state
 * @param memoryToDelete - Memory object to delete
 * @param userData - User data
 * @param replyInteraction - Interaction to reply to (can be modal or pagination)
 * @param locale - User locale
 */
async function performServerMemoryRemoval(
  tomoriState: TomoriState,
  memoryToDelete: { server_memory_id: number; content: string },
  userData: UserRow,
  replyInteraction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction,
  locale: string,
  suppressSuccessReply = false,
): Promise<boolean> {
  // Delete the memory from the database using Bun SQL
  const [deletedRow] = await sql`
		DELETE FROM server_memories
		WHERE server_memory_id = ${memoryToDelete.server_memory_id}
		RETURNING *
	`;

  // Validate the returned (deleted) data
  const validatedMemory = serverMemorySchema.safeParse(deletedRow);

  if (!validatedMemory.success || !deletedRow) {
    // Log error specific to this delete failure
    const context: ErrorContext = {
      tomoriId: tomoriState.tomori_id,
      serverId: tomoriState.server_id,
      userId: userData.user_id,
      errorType: "DatabaseDeleteError",
      metadata: {
        command: "forget servermemory",
        table: "server_memories",
        deletedMemoryId: memoryToDelete.server_memory_id,
        validationErrors: validatedMemory.success ? null : validatedMemory.error.flatten(),
      },
    };

    await log.error(
      "Failed to delete or validate server memory from server_memories table",
      validatedMemory.success
        ? new Error("Database delete returned no rows or unexpected data")
        : new Error("Deleted server memory data failed validation"),
      context,
    );

    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return false;
  }

  // Invalidate cache so next message gets fresh config
  if (replyInteraction.guildId) {
    invalidateTomoriStateCache(replyInteraction.guildId);
  }

  // Log success and show success message
  log.success(
    `Deleted server memory "${memoryToDelete.content.slice(0, 30)}..." (ID: ${memoryToDelete.server_memory_id}) for server ${tomoriState.server_id} by user ${userData.user_disc_id}`,
  );

  if (!suppressSuccessReply) {
    await replyInfoEmbed(replyInteraction, locale, {
      titleKey: "commands.forget.memory.server.success_title",
      descriptionKey: "commands.forget.memory.server.success_description",
      descriptionVars: {
        memory:
          memoryToDelete.content.length > 50 ? `${memoryToDelete.content.slice(0, 50)}...` : memoryToDelete.content,
      },
      color: ColorCode.SUCCESS,
    });
  }

  return true;
}

// Rule 21: Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("remove").setDescription(localizer("en-US", "commands.memory.server.remove.description"));

/**
 * Rule 1: JSDoc comment for exported function
 * Removes a server memory from the server_memories table using a paginated embed.
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

  // Define state and result variables outside try for catch block context
  let tomoriState: TomoriState | null = null;
  let selectedPersona: TomoriState | null = null;
  let personaSelectionInteraction: ButtonInteraction | null = null;

  try {
    // 2. Load server's Tomori state (Rule 17) - Needed for server_id and config checks
    tomoriState = await getCachedTomoriState(interaction.guild?.id ?? interaction.user.id);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Select target persona via paginated selector
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

    const avatarSessionCache: AvatarSessionCache = new Map();
    while (true) {
      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        avatarSessionCache,
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        onSelect: async () => {},
      });

      if (!personaSelection.success) {
        if (personaSelection.reason === "cancelled" || personaSelection.reason === "fatal") return;
        continue;
      }
      if (personaSelection.selectedIndex === undefined || !personaSelection.interaction) {
        return;
      }

      personaSelectionInteraction = personaSelection.interaction;
      selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;
      if (!selectedPersona?.tomori_id) {
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "general.errors.invalid_option_title",
          "general.errors.invalid_option_description",
          ColorCode.ERROR,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      // 4. Check permissions and if teaching is enabled
      const hasManagePermission = interaction.memberPermissions?.has("ManageGuild") ?? false;
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

      // 5. Fetch lineage-scoped server memories for the selected persona.
      const targetPersonaLineageId = selectedPersona.persona_lineage_id ?? 0;
      let memoriesQuery = sql`
				SELECT server_memory_id, content, user_id
				FROM server_memories
				WHERE server_id = ${
          // biome-ignore lint/style/noNonNullAssertion: tomoriState check guarantees server_id
          tomoriState.server_id!
        }
				  AND persona_lineage_id = ${targetPersonaLineageId}
			`;

      if (!hasManagePermission) {
        // If user does NOT have ManageGuild permission, only fetch their own memories
        memoriesQuery = sql`${memoriesQuery} AND user_id = ${userData.user_id}`;
      }

      // Add ordering
      memoriesQuery = sql`${memoriesQuery} ORDER BY created_at DESC`;

      // Execute the constructed query
      const memories = await memoriesQuery;

      if (memories.length === 0) {
        // 6. Check if there are any memories to remove (using the potentially filtered list)
        // Use a different message if the list is empty *because* of permissions vs. no memories exist at all
        const descriptionKey = hasManagePermission
          ? "commands.forget.memory.server.no_memories" // No memories on server
          : "commands.forget.memory.server.no_owned_memories"; // User owns no memories
        await updateButtonComponentsV2Status(
          personaSelectionInteraction,
          locale,
          "commands.forget.memory.server.no_memories_title",
          descriptionKey,
          ColorCode.WARN,
          undefined,
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      // 7. Use unified paginated modal system (supports up to 25 items directly, >25 via page selection)
      const memorySelectOptions: SelectOption[] = memories.map((memory: { content: string }, index: number) => ({
        label: safeSelectOptionText(memory.content, 20),
        value: index.toString(), // Use index to avoid truncation issues
        description: safeSelectOptionText(memory.content),
      }));

      const modalResult = await promptWithPaginatedModal(personaSelectionInteraction, locale, {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.forget.memory.server.modal_title",
        components: [
          {
            customId: MEMORY_SELECT_ID,
            labelKey: "commands.forget.memory.server.select_label",
            descriptionKey: "commands.forget.memory.server.select_description",
            placeholder: "commands.forget.memory.server.select_placeholder",
            required: true,
            options: memorySelectOptions,
          },
        ],
      });

      // Handle modal outcome - keep the persona picker loop alive when the modal closes
      if (modalResult.outcome !== "submit") {
        log.info(`Server memory deletion modal ${modalResult.outcome} for user ${userData.user_id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      // Extract values from the modal
      const modalSubmitInteraction = modalResult.interaction;
      const selectedIndex = modalResult.values?.[MEMORY_SELECT_ID];

      // Safety checks (should never be null after submit outcome)
      if (!modalSubmitInteraction || !selectedIndex) {
        log.error("Modal result unexpectedly missing interaction or values");
        return;
      }

      // Get the full memory from the original array
      const selectedMemory = memories[Number.parseInt(selectedIndex, 10)];

      // Validate the selected index
      if (!selectedMemory) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "general.errors.operation_failed_title",
          descriptionKey: "commands.forget.memory.server.memory_not_found",
          color: ColorCode.ERROR,
        });
        return;
      }

      // Perform the database update using the helper function - let helper manage interaction state
      const removalSucceeded = await performServerMemoryRemoval(
        selectedPersona,
        selectedMemory,
        userData,
        modalSubmitInteraction,
        locale,
        true,
      );
      if (!removalSucceeded) {
        return;
      }
      await acknowledgeModalSubmitForRefresh(modalSubmitInteraction);
      await replyComponentsV2Status(
        interaction,
        locale,
        "commands.forget.memory.server.success_title",
        "commands.forget.memory.server.success_description",
        ColorCode.SUCCESS,
        {
          memory:
            selectedMemory.content.length > 50 ? `${selectedMemory.content.slice(0, 50)}...` : selectedMemory.content,
        },
        "general.pagination.reloading_persona_picker",
      );
    }
  } catch (error) {
    // 14. Catch unexpected errors
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      tomoriId: selectedPersona?.tomori_id ?? tomoriState?.tomori_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "forget servermemory",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error(
      `Unexpected error in /forget servermemory for user ${userData.user_disc_id}`,
      error as Error,
      context,
    );

    // 15. Inform user of unknown error, prioritizing unacknowledged button interaction
    const errorReplyTarget =
      personaSelectionInteraction && !personaSelectionInteraction.deferred && !personaSelectionInteraction.replied
        ? personaSelectionInteraction
        : interaction;
    await replyInfoEmbed(errorReplyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
