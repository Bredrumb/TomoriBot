/**
 * Command: /server stm prompt-edit
 * Exposes the three user-customizable STM prompt strings (README decision 7):
 *   - tool description  → what the update-STM tool advertises to the model
 *   - create-nudge      → injected when no STM exists yet but enough crude turns accrued
 *   - update-nudge      → injected (cadence-gated) to prompt a refresh of existing STM
 *
 * Each field is an OVERRIDE: leaving a box empty stores NULL, which makes the runtime
 * fall back to the systemPrompts.ts seed default for that field. Stored overrides flow
 * through macro expansion ({short_term_memory_tool} etc.) and
 * sanitizeUnknownTemplatePlaceholders at injection time, so unknown {placeholders} are
 * stripped rather than leaking. The structure/wrapper template is intentionally NOT
 * editable here.
 */
import {
  MessageFlags,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, ServerStmConfigRow, UserRow } from "@/types/db/schema";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { shortTermMemoryRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

const MODAL_CUSTOM_ID = "server_stm_prompt_edit_modal";
const TOOL_DESCRIPTION_ID = "stm_tool_description";
const CREATE_NUDGE_ID = "stm_create_nudge";
const UPDATE_NUDGE_ID = "stm_update_nudge";
const PROMPT_MAX_LENGTH = 4000; // Discord text input character limit

/**
 * Configure the slash command subcommand metadata.
 * @param subcommand - The subcommand builder provided by the loader
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("prompt-edit").setDescription(localizer("en-US", "commands.server.stm.prompt-edit.description"));

/**
 * Execute the /server stm prompt-edit command.
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
  // 1. Guild-only — STM prompts are server-scoped config (validation before try-catch).
  if (!interaction.guild || !interaction.guildId) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let tomoriState: Awaited<ReturnType<typeof getCachedTomoriState>> = null;
  let modalSubmitInteraction: ModalSubmitInteraction | undefined;
  try {
    // 2. Resolve the internal numeric server_id (cached, stays within the 3s window).
    tomoriState = await getCachedTomoriState(interaction.guildId);
    if (!tomoriState) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 3. Load any existing overrides to prefill the modal. We prefill ONLY with a stored
    //    override (never the seed default) — that keeps "empty box == reset to default".
    const existing = await shortTermMemoryRepository.getStmConfig(tomoriState.server_id);

    // 4. Show the modal — three optional Paragraph inputs. Do NOT deferReply first
    //    (Pattern 3); arg 4 auto-defers the submit interaction.
    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.server.stm.prompt-edit.modal_title",
        components: [
          {
            customId: TOOL_DESCRIPTION_ID,
            style: TextInputStyle.Paragraph,
            labelKey: "commands.server.stm.prompt-edit.tool_description_label",
            descriptionKey: "commands.server.stm.prompt-edit.tool_description_description",
            placeholder: "commands.server.stm.prompt-edit.reset_placeholder",
            required: false,
            maxLength: PROMPT_MAX_LENGTH,
            value: existing?.tool_description_override || undefined,
          },
          {
            customId: CREATE_NUDGE_ID,
            style: TextInputStyle.Paragraph,
            labelKey: "commands.server.stm.prompt-edit.create_nudge_label",
            descriptionKey: "commands.server.stm.prompt-edit.create_nudge_description",
            placeholder: "commands.server.stm.prompt-edit.reset_placeholder",
            required: false,
            maxLength: PROMPT_MAX_LENGTH,
            value: existing?.create_nudge_override || undefined,
          },
          {
            customId: UPDATE_NUDGE_ID,
            style: TextInputStyle.Paragraph,
            labelKey: "commands.server.stm.prompt-edit.update_nudge_label",
            descriptionKey: "commands.server.stm.prompt-edit.update_nudge_description",
            placeholder: "commands.server.stm.prompt-edit.reset_placeholder",
            required: false,
            maxLength: PROMPT_MAX_LENGTH,
            value: existing?.update_nudge_override || undefined,
          },
        ],
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") {
      log.info(`Server STM prompt-edit modal ${modalResult.outcome}`);
      return;
    }

    // 5. ASSIGN (not declare) modalSubmitInteraction; safety check after.
    modalSubmitInteraction = modalResult.interaction;
    if (!modalSubmitInteraction) {
      log.error("Server STM prompt-edit modal submit interaction is undefined after successful submit");
      return;
    }

    // 6. Build the patch. Empty (after trim) → null = reset to seed default; non-empty → override.
    const toolDescription = modalResult.values?.[TOOL_DESCRIPTION_ID]?.trim() || null;
    const createNudge = modalResult.values?.[CREATE_NUDGE_ID]?.trim() || null;
    const updateNudge = modalResult.values?.[UPDATE_NUDGE_ID]?.trim() || null;

    const patch: Partial<Omit<ServerStmConfigRow, "server_id">> = {
      tool_description_override: toolDescription,
      create_nudge_override: createNudge,
      update_nudge_override: updateNudge,
    };

    // 7. Upsert (INSERT … ON CONFLICT) — see parameters.ts for why upsert over UPDATE.
    const saved = await shortTermMemoryRepository.upsertStmConfig(tomoriState.server_id, patch);
    if (!saved) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 8. No cache invalidation needed — STM prompt overrides are read fresh from the DB
    //    each turn by memories.ts; they are not held in any cache.

    // 9. Report which fields are now custom vs. using the seed default.
    const customCount = [toolDescription, createNudge, updateNudge].filter((value) => value !== null).length;
    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.server.stm.prompt-edit.success_title",
      descriptionKey: "commands.server.stm.prompt-edit.success_description",
      descriptionVars: {
        custom_count: customCount.toString(),
        default_count: (3 - customCount).toString(),
      },
      color: ColorCode.SUCCESS,
      flags: MessageFlags.Ephemeral,
    });

    log.success(
      `Updated STM prompt overrides for server ${tomoriState.server_id} (${customCount} custom) by ${userData.user_disc_id}`,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server stm prompt-edit",
        guildId: interaction.guildId,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error in /server stm prompt-edit", error as Error, context);

    const replyTarget = modalSubmitInteraction ?? interaction;
    await replyInfoEmbed(replyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
