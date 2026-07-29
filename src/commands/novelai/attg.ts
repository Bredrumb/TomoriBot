import {
  MessageFlags,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ErrorContext, TomoriState, UserRow } from "@/types/db/schema";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { replyInfoEmbed } from "@/utils/discord/interactionHelper";
import {
  buildPersonaWorkflowNotice,
  completePersonaWorkflow,
  retryPersonaWorkflow,
  runPersonaPickerWorkflow,
  type PersonaWorkflowMessageController,
} from "@/utils/discord/ui/personaWorkflow";
import { personaRepository } from "@/utils/db/repositories";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

const MODAL_CUSTOM_ID = "nai_attg_modal";
const FIELD_AUTHOR = "nai_attg_author";
const FIELD_TITLE = "nai_attg_title";
const FIELD_TAGS = "nai_attg_tags";
const FIELD_GENRE = "nai_attg_genre";
const FIELD_STARS = "nai_attg_stars";

/**
 * Configure the subcommand for Discord slash command registration.
 *
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
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.guild) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.guild_only_title",
      descriptionKey: "general.errors.guild_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }
  const guildId = interaction.guild.id;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const workflowState: {
    message: PersonaWorkflowMessageController | null;
    selectedPersona: TomoriState | null;
  } = { message: null, selectedPersona: null };

  try {
    const allPersonas = await personaRepository.loadAllForServer(guildId);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    await runPersonaPickerWorkflow(interaction, locale, {
      personas: allPersonas,
      titleKey: "commands.novelai.attg.persona_select_title",
      color: ColorCode.INFO,
      async onSelected(selection) {
        workflowState.message = selection.message;
        const selectedPersona = selection.persona;
        workflowState.selectedPersona = selectedPersona;

        if (!selectedPersona.persona_id) {
          const work = await selection.beginInPlaceWork();
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.errors.invalid_option_title",
              descriptionKey: "general.errors.invalid_option_description",
              footerKey: "general.pagination.reloading_persona_picker",
              color: ColorCode.ERROR,
            }),
          );
          return retryPersonaWorkflow();
        }

        const modalResult = await selection.openModal({
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
              value: selectedPersona.nai_attg_stars?.toString(),
            },
          ],
        });

        if (modalResult.outcome !== "submitted") {
          log.info(`ATTG modal ${modalResult.outcome} for user ${userData.user_id}`);
          return modalResult.outcome === "fatal" ? completePersonaWorkflow() : retryPersonaWorkflow();
        }

        const work = await modalResult.phase.beginInPlaceWork();
        const values = modalResult.phase.values;
        const author = values[FIELD_AUTHOR]?.trim() || null;
        const title = values[FIELD_TITLE]?.trim() || null;
        const tags = values[FIELD_TAGS]?.trim() || null;
        const genre = values[FIELD_GENRE]?.trim() || null;
        const starsRaw = values[FIELD_STARS]?.trim() || "";
        let stars: number | null = null;
        if (starsRaw !== "") {
          const parsed = Number.parseInt(starsRaw, 10);
          if (Number.isNaN(parsed) || parsed < 1 || parsed > 5 || starsRaw !== parsed.toString()) {
            await work.message.replace(
              buildPersonaWorkflowNotice({
                locale,
                titleKey: "commands.novelai.attg.invalid_stars_title",
                descriptionKey: "commands.novelai.attg.invalid_stars_description",
                footerKey: "general.pagination.reloading_persona_picker",
                color: ColorCode.ERROR,
              }),
            );
            return retryPersonaWorkflow();
          }
          stars = parsed;
        }

        const isClearing = !author && !title && !tags && !genre && stars === null;
        const updated = await personaRepository.setNaiAttg(selectedPersona.persona_id, {
          nai_attg_author: author,
          nai_attg_title: title,
          nai_attg_tags: tags,
          nai_attg_genre: genre,
          nai_attg_stars: stars,
        });
        if (!updated) {
          // setNaiAttg may materialize a pointer persona before a later ATTG
          // upsert fails, so a false result can still include a committed write.
          invalidateTomoriStateCache(guildId);
          const context: ErrorContext = {
            userId: userData.user_id,
            serverId: selectedPersona.server_id,
            personaId: selectedPersona.persona_id,
            errorType: "DatabaseUpdateError",
            metadata: {
              command: "novelai attg",
              guildId,
              isClearing,
              targetTable: "persona_configs",
            },
          };
          await log.error(
            "Failed to update NovelAI ATTG metadata",
            new Error("Database update returned false"),
            context,
          );
          await work.message.replace(
            buildPersonaWorkflowNotice({
              locale,
              titleKey: "general.errors.update_failed_title",
              descriptionKey: "general.errors.update_failed_description",
              color: ColorCode.ERROR,
            }),
          );
          return completePersonaWorkflow();
        }

        selectedPersona.nai_attg_author = author;
        selectedPersona.nai_attg_title = title;
        selectedPersona.nai_attg_tags = tags;
        selectedPersona.nai_attg_genre = genre;
        selectedPersona.nai_attg_stars = stars;
        invalidateTomoriStateCache(guildId);

        await work.message.replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: isClearing ? "commands.novelai.attg.cleared_title" : "commands.novelai.attg.success_title",
            descriptionKey: isClearing
              ? "commands.novelai.attg.cleared_description"
              : "commands.novelai.attg.success_description",
            descriptionVars: { persona_name: selectedPersona.persona_nickname },
            footerKey: "general.pagination.reloading_persona_picker",
            color: ColorCode.SUCCESS,
          }),
        );
        return retryPersonaWorkflow();
      },
    });
  } catch (error) {
    const context = {
      errorType: "CommandExecutionError",
      metadata: {
        command: "nai attg",
        guildId,
        personaId: workflowState.selectedPersona?.persona_id ?? null,
      },
    };
    await log.error("Error in /novelai attg command", error, context);

    if (workflowState.message) {
      await workflowState.message.replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        }),
      );
    } else {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
    }
  }
}
