import {
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import { invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import {
  acknowledgeModalSubmitForRefresh,
  promptWithModal,
  replyComponentsV2Status,
  replyInfoEmbed,
  type AvatarSessionCache,
  replyPaginatedPersonaChoicesV2,
} from "../../utils/discord/interactionHelper";
import type { TomoriState, UserRow } from "../../types/db/schema";
import { sql } from "@/utils/db/client";
import { personaRepository } from "@/utils/db/repositories";

// ─── Modal field IDs ───────────────────────────────────────────────────────────
const MODAL_CUSTOM_ID = "nai_attg_modal";
const FIELD_AUTHOR = "nai_attg_author";
const FIELD_TITLE = "nai_attg_title";
const FIELD_TAGS = "nai_attg_tags";
const FIELD_GENRE = "nai_attg_genre";
const FIELD_STARS = "nai_attg_stars";

/**
 * Configure the subcommand for Discord slash command registration.
 *
 * @param subcommand - The subcommand builder to configure
 * @returns Configured subcommand builder
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("attg").setDescription(localizer("en-US", "commands.novelai.attg.description"));

/**
 * Configure per-persona ATTG (Author/Title/Tags/Genre/Stars) metadata
 * that is injected at the top of every Kayra/Erato NovelAI prompt.
 *
 * These fields align with the special formatting tokens that Kayra and Erato
 * were trained on, improving coherence and persona consistency. Stars are
 * Erato-exclusive and are only injected when the model is `llama-3-erato-v1`.
 *
 * Flow:
 * 1. Guild-only guard
 * 2. Load all personas for the server
 * 3. Paginated persona selector (preserves button interaction for modal opening)
 * 4. Five-field modal for Author, Title, Tags, Genre, Stars
 * 5. Validate Stars field (must be 1–5 or empty)
 * 6. All empty → clear ATTG columns for persona (set to NULL)
 * 7. Otherwise → write non-empty values to DB and invalidate cache
 * 8. Reply with success or cleared embed
 *
 * @param _client - Discord client instance (unused)
 * @param interaction - Command interaction from Discord
 * @param userData - User data from database
 * @param locale - User's locale preference
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1. Ensure command is run in a guild
  if (!interaction.guild) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  let personaSelectionInteraction: ButtonInteraction | null = null;
  let modalSubmitInteraction: ModalSubmitInteraction | null = null;
  let selectedPersona: TomoriState | null = null;

  try {
    // 2. Load all personas for the server
    const allPersonas = await personaRepository.loadAllForServer(interaction.guild.id);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 3. Loop: show paginated persona selector, then modal.
    //    After each completed transaction, refresh the picker so the user can continue.
    const avatarSessionCache: AvatarSessionCache = new Map();
    while (true) {
      // 3a. Show paginated persona selector.
      //    preserveSelectedInteraction=true leaves the ButtonInteraction unacknowledged
      //    so we can open a modal as the first response to it.
      const personaResult = await replyPaginatedPersonaChoicesV2(interaction, locale, {
        personas: allPersonas,
        avatarSessionCache,
        titleKey: "commands.novelai.attg.persona_select_title",
        color: ColorCode.INFO,
        preserveSelectedInteraction: true,
        onSelect: async () => {},
      });

      if (!personaResult.success) {
        if (personaResult.reason === "cancelled" || personaResult.reason === "fatal") return;
        continue;
      }
      if (personaResult.selectedIndex === undefined || !personaResult.interaction) {
        return;
      }

      personaSelectionInteraction = personaResult.interaction;
      selectedPersona = allPersonas[personaResult.selectedIndex] ?? null;

      if (!selectedPersona?.tomori_id) {
        await replyInfoEmbed(personaSelectionInteraction, locale, {
          titleKey: "general.errors.invalid_option_title",
          descriptionKey: "general.errors.invalid_option_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      // 4. Open the ATTG five-field modal.
      //    Pre-fill fields from the persona's existing values (may be null).
      const modalResult = await promptWithModal(personaSelectionInteraction, locale, {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.novelai.attg.modal_title",
        components: [
          {
            customId: FIELD_AUTHOR,
            labelKey: "commands.novelai.attg.author_label",
            placeholder: "commands.novelai.attg.author_placeholder",
            style: TextInputStyle.Short,
            required: false,
            maxLength: 256,
            value: selectedPersona.nai_attg_author ?? undefined,
          },
          {
            customId: FIELD_TITLE,
            labelKey: "commands.novelai.attg.title_label",
            placeholder: "commands.novelai.attg.title_placeholder",
            style: TextInputStyle.Short,
            required: false,
            maxLength: 256,
            value: selectedPersona.nai_attg_title ?? undefined,
          },
          {
            customId: FIELD_TAGS,
            labelKey: "commands.novelai.attg.tags_label",
            placeholder: "commands.novelai.attg.tags_placeholder",
            style: TextInputStyle.Short,
            required: false,
            maxLength: 256,
            value: selectedPersona.nai_attg_tags ?? undefined,
          },
          {
            customId: FIELD_GENRE,
            labelKey: "commands.novelai.attg.genre_label",
            placeholder: "commands.novelai.attg.genre_placeholder",
            style: TextInputStyle.Short,
            required: false,
            maxLength: 256,
            value: selectedPersona.nai_attg_genre ?? undefined,
          },
          {
            customId: FIELD_STARS,
            labelKey: "commands.novelai.attg.stars_label",
            placeholder: "commands.novelai.attg.stars_placeholder",
            style: TextInputStyle.Short,
            required: false,
            maxLength: 1,
            value: selectedPersona.nai_attg_stars != null ? selectedPersona.nai_attg_stars.toString() : undefined,
          },
        ],
      });

      if (modalResult.outcome !== "submit") {
        log.info(`ATTG modal ${modalResult.outcome} for user ${userData.user_id}`);
        await replyComponentsV2Status(
          interaction,
          locale,
          "general.pagination.select_persona_title",
          "general.pagination.reloading_persona_picker",
          ColorCode.INFO,
        );
        continue;
      }

      // biome-ignore lint/style/noNonNullAssertion: outcome "submit" guarantees interaction
      modalSubmitInteraction = modalResult.interaction!;
      const values = modalResult.values ?? {};

      // 5. Parse field values — trim and treat empty strings as null
      const author = values[FIELD_AUTHOR]?.trim() || null;
      const title = values[FIELD_TITLE]?.trim() || null;
      const tags = values[FIELD_TAGS]?.trim() || null;
      const genre = values[FIELD_GENRE]?.trim() || null;
      const starsRaw = values[FIELD_STARS]?.trim() || "";

      // 5a. Validate stars: must be empty OR an integer 1–5
      let stars: number | null = null;
      if (starsRaw !== "") {
        const parsed = Number.parseInt(starsRaw, 10);
        if (Number.isNaN(parsed) || parsed < 1 || parsed > 5 || starsRaw !== parsed.toString()) {
          await replyInfoEmbed(modalSubmitInteraction, locale, {
            titleKey: "commands.novelai.attg.invalid_stars_title",
            descriptionKey: "commands.novelai.attg.invalid_stars_description",
            color: ColorCode.ERROR,
          });
          return;
        }
        stars = parsed;
      }

      const personaId = selectedPersona.tomori_id;

      // 6. If all fields are empty → clear all ATTG columns (set to NULL)
      if (!author && !title && !tags && !genre && stars === null) {
        await sql`
				UPDATE tomoris
				SET
					nai_attg_author = NULL,
					nai_attg_title  = NULL,
					nai_attg_tags   = NULL,
					nai_attg_genre  = NULL,
					nai_attg_stars  = NULL
				WHERE tomori_id = ${personaId}
			`;

        // 6a. Invalidate cache so next access gets fresh data
        invalidateTomoriStateCache(interaction.guild.id);

        await acknowledgeModalSubmitForRefresh(modalSubmitInteraction);
        await replyComponentsV2Status(
          interaction,
          locale,
          "commands.novelai.attg.cleared_title",
          "commands.novelai.attg.cleared_description",
          ColorCode.SUCCESS,
          { persona_name: selectedPersona.tomori_nickname },
          "general.pagination.reloading_persona_picker",
        );
        continue;
      }

      // 7. Write non-empty values to DB.
      //    NULL-coalesced with existing values so unmodified fields are preserved.
      await sql`
			UPDATE tomoris
			SET
				nai_attg_author = ${author},
				nai_attg_title  = ${title},
				nai_attg_tags   = ${tags},
				nai_attg_genre  = ${genre},
				nai_attg_stars  = ${stars}
			WHERE tomori_id = ${personaId}
		`;

      // 7a. Invalidate cache after successful write
      invalidateTomoriStateCache(interaction.guild.id);

      // 8. Success reply
      await acknowledgeModalSubmitForRefresh(modalSubmitInteraction);
      await replyComponentsV2Status(
        interaction,
        locale,
        "commands.novelai.attg.success_title",
        "commands.novelai.attg.success_description",
        ColorCode.SUCCESS,
        { persona_name: selectedPersona.tomori_nickname },
        "general.pagination.reloading_persona_picker",
      );
    }
  } catch (error) {
    const context = {
      errorType: "CommandExecutionError",
      metadata: {
        command: "nai attg",
        guildId: interaction.guild?.id ?? null,
        personaId: selectedPersona?.tomori_id ?? null,
      },
    };
    await log.error("Error in /novelai attg command", error, context);

    // Reply to the most recent interaction we have
    const errorInteraction = modalSubmitInteraction ?? personaSelectionInteraction ?? interaction;

    await replyInfoEmbed(errorInteraction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
    });
  }
}
