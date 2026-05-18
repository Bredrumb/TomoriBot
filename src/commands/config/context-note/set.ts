/**
 * Command: /config context-note set
 * Allows users to set an author's note injected into conversation history
 * at a configurable depth to combat context drift.
 *
 * Scopes:
 * - persona: Bound to a specific persona (persona picker shown first)
 * - global:  Server-wide fallback used when the active persona has no note
 *
 * At inference, the active persona's note takes priority over the global note.
 * Submitting a blank note clears (removes) the stored value.
 */

import type { ButtonInteraction, ChatInputCommandInteraction, Client, ModalSubmitInteraction } from "discord.js";
import { MessageFlags, TextInputStyle } from "discord.js";
import type { TomoriState, UserRow } from "@/types/db/schema";
import { getCachedTomoriState, invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { configRepository, personaRepository } from "@/utils/db/repositories";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { replyPaginatedPersonaChoicesV2 } from "@/utils/discord/ui/personaPagination";

const MODAL_CUSTOM_ID = "config_context_note_modal";
const CONTEXT_NOTE_MAX_LENGTH = 2000;
const CONTEXT_NOTE_DEPTH_MAX = 100;

/**
 * Configure the /config context-note set subcommand metadata.
 * The commandLoader auto-localizes descriptions, option descriptions, and choice labels
 * from the keys at commands.config.context-note.set.* in the locale files.
 * @param subcommand - Builder provided by commandLoader
 * @returns Configured builder
 */
export const configureSubcommand = (subcommand: import("discord.js").SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("set")
    .setDescription(localizer("en-US", "commands.config.context-note.set.description"))
    .addStringOption((option) =>
      option
        .setName("scope")
        .setDescription(localizer("en-US", "commands.config.context-note.set.scope_description"))
        .setRequired(true)
        .addChoices(
          {
            name: localizer("en-US", "commands.config.context-note.set.persona_option"),
            value: "persona",
          },
          {
            name: localizer("en-US", "commands.config.context-note.set.global_option"),
            value: "global",
          },
        ),
    );

/**
 * Execute /config context-note set.
 * @param _client - Discord client (unused)
 * @param interaction - Chat input command interaction
 * @param _userData - User row (unused)
 * @param locale - User's locale for localization
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Channel guard
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 2. Resolve server identity and fetch cached state
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

  // 3. Read required scope option
  const scope = interaction.options.getString("scope", true) as "persona" | "global";

  // 4. Declare interaction handles outside try-catch for fallback error replies
  let modalHost: ChatInputCommandInteraction | ButtonInteraction = interaction;
  let modalSubmitInteraction: ModalSubmitInteraction | undefined;
  let selectedPersona: TomoriState | null = null;

  try {
    // 5. Persona scope: show paginated persona picker first
    if (scope === "persona") {
      const allPersonas = await personaRepository.loadAllForServer(interaction.guild?.id ?? interaction.user.id);

      if (allPersonas.length === 0) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.config.context-note.set.no_personas_title",
          descriptionKey: "commands.config.context-note.set.no_personas_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // 5a. Display paginated persona picker; preserveSelectedInteraction=true
      //     returns the unacknowledged ButtonInteraction so we can show a modal on it.
      const personaSelection = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        onSelect: async () => {},
      });

      if (!personaSelection.success || !personaSelection.interaction || personaSelection.selectedIndex === undefined) {
        return;
      }

      // 5b. Hand the ButtonInteraction to promptWithRawModal instead of ChatInputCommandInteraction
      modalHost = personaSelection.interaction;
      selectedPersona = allPersonas[personaSelection.selectedIndex] ?? null;

      if (!selectedPersona?.persona_id) {
        return;
      }
    }

    // 6. Load existing values for pre-fill
    let existingNote: string | null | undefined;
    let existingDepth: number;

    if (scope === "persona" && selectedPersona) {
      existingNote = selectedPersona.context_note;
      existingDepth = selectedPersona.context_note_depth ?? 0;
    } else {
      existingNote = tomoriState.config.context_note;
      existingDepth = tomoriState.config.context_note_depth ?? 0;
    }

    // 7. Show modal with note text + depth fields, pre-filled with existing values
    const modalResult = await promptWithRawModal(
      modalHost,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.config.context-note.set.modal_title",
        components: [
          {
            customId: "context_note_text",
            style: TextInputStyle.Paragraph,
            labelKey: "commands.config.context-note.set.text_label",
            placeholder: "commands.config.context-note.set.text_placeholder",
            required: false,
            maxLength: CONTEXT_NOTE_MAX_LENGTH,
            value: existingNote || undefined,
          },
          {
            customId: "context_note_depth",
            style: TextInputStyle.Short,
            labelKey: "commands.config.context-note.set.depth_label",
            placeholder: "commands.config.context-note.set.depth_placeholder",
            required: true,
            maxLength: 3,
            value: String(existingDepth),
          },
        ],
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") {
      log.info(`Context note modal ${modalResult.outcome}`);
      return;
    }

    // 8. Assign (not declare) after successful submit
    modalSubmitInteraction = modalResult.interaction;

    if (!modalSubmitInteraction) {
      log.error("Modal submit interaction is undefined after successful submit");
      return;
    }

    // 9. Parse and validate the submitted values
    const rawNote = (modalResult.values?.context_note_text ?? "").trim();
    const rawDepth = (modalResult.values?.context_note_depth ?? "0").trim();
    const parsedDepth = Number.parseInt(rawDepth, 10);

    if (Number.isNaN(parsedDepth) || parsedDepth < 0 || parsedDepth > CONTEXT_NOTE_DEPTH_MAX) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.config.context-note.set.invalid_depth_title",
        descriptionKey: "commands.config.context-note.set.invalid_depth_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 10. Blank text = remove the note (NULL + reset depth to 0)
    const noteToStore = rawNote || null;
    const depthToStore = rawNote ? parsedDepth : 0;
    const isRemoving = !rawNote;

    // 11. Persist to the appropriate table
    const persisted =
      scope === "persona" && selectedPersona?.persona_id
        ? await personaRepository.setContextNote(selectedPersona.persona_id, noteToStore, depthToStore)
        : await configRepository.updateChatConfig(tomoriState.server_id, {
            context_note: noteToStore,
            context_note_depth: depthToStore,
          });

    if (!persisted) {
      throw new Error("Failed to persist context note");
    }

    // 12. Invalidate cache AFTER the successful write
    invalidateTomoriStateCache(serverId);

    // 13. Reply with scoped success message
    const scopeLabel =
      scope === "persona" && selectedPersona
        ? selectedPersona.persona_nickname
        : localizer(locale, "commands.config.context-note.set.global_option");

    if (isRemoving) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.config.context-note.set.success_removed_title",
        descriptionKey: "commands.config.context-note.set.success_removed_description",
        descriptionVars: { scope: scopeLabel },
        color: ColorCode.SUCCESS,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      const preview = (noteToStore ?? "").substring(0, 200);
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "commands.config.context-note.set.success_set_title",
        descriptionKey: "commands.config.context-note.set.success_set_description",
        descriptionVars: { scope: scopeLabel, depth: String(depthToStore), preview },
        color: ColorCode.SUCCESS,
        flags: MessageFlags.Ephemeral,
      });
    }

    log.info(
      `Context note ${isRemoving ? "cleared" : "updated"} for server ${serverId} scope=${scope}${selectedPersona ? ` persona=${selectedPersona.persona_id}` : ""} depth=${depthToStore}`,
    );
  } catch (error) {
    log.error("Failed to set context note:", error as Error);

    // 14. Use the most specific available interaction for the error reply
    const replyTarget = modalSubmitInteraction ?? modalHost;

    await replyInfoEmbed(replyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
