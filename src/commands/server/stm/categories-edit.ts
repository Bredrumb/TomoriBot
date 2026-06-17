/**
 * Command: /server stm categories-edit
 * Defines the up-to-5 labeled STM categories for this server. Each modal input holds
 * one category in `label: description` form (e.g. `Goals: The party's current objectives`).
 *
 * Parsing rules:
 *   - An empty input means "no category in that slot".
 *   - A non-empty input must contain a colon, a non-empty label that slugifies to a valid
 *     identifier, and a non-empty description.
 *   - Final positions are renumbered 0..n in the order the non-empty inputs appear.
 *   - If EVERY input is left empty, the default `summary` category is restored so STM never
 *     silently breaks (README decision 9) — this collapses the tool back to today's single
 *     `summary` field.
 *
 * Category definitions are written to `stm_categories` (replace-all in one transaction).
 * Because other-channel memory rendering dumps the cached slug→value map wholesale
 * (memories.ts:formatCategoryLines without a labelMap), changing the slug schema can leave
 * orphaned values rendering stale labels — so we evict this server's cached STM entries
 * after the write succeeds (CLAUDE.md rule 5).
 */
import {
  MessageFlags,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Client,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { ModalInputField } from "@/types/discord/modal";
import type { ErrorContext, UserRow } from "@/types/db/schema";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { STM_MAX_CATEGORIES } from "@/utils/cache/shortTermMemoryCache";
import { shortTermMemoryRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal } from "@/utils/discord/ui/modals";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { slugifyLabel } from "@/utils/text/slugifyLabel";

const MODAL_CUSTOM_ID = "server_stm_categories_edit_modal";
const CATEGORY_INPUT_PREFIX = "stm_category_";
const CATEGORY_INPUT_MAX_LENGTH = 1000;

// Discord modals allow at most 5 action-row components; the STM cap is also 5.
const MAX_CATEGORY_SLOTS = Math.min(STM_MAX_CATEGORIES, 5);

// Mirrors the migration 034 seed + ShortTermMemoryRepository.getStmCategories fallback so
// the restored default is byte-identical to a never-configured server.
const DEFAULT_SUMMARY_LABEL = "summary";
const DEFAULT_SUMMARY_DESCRIPTION = "A running summary of recent events, topics, and context from this conversation.";

type ParsedCategory = { position: number; label: string; description: string };

/**
 * Configure the slash command subcommand metadata.
 * @param subcommand - The subcommand builder provided by the loader
 */
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("categories-edit")
    .setDescription(localizer("en-US", "commands.server.stm.categories-edit.description"));

/**
 * Execute the /server stm categories-edit command.
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
  // 1. Guild-only — categories are server-scoped (validation before try-catch).
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

    // 3. Load current categories to prefill each slot (`label: description`).
    const existing = await shortTermMemoryRepository.getStmCategories(tomoriState.server_id);

    // 4. Build one Paragraph input per slot, prefilled from the current categories by order.
    const components: ModalInputField[] = [];
    for (let i = 0; i < MAX_CATEGORY_SLOTS; i++) {
      const current = existing[i];
      components.push({
        customId: `${CATEGORY_INPUT_PREFIX}${i}`,
        style: TextInputStyle.Paragraph,
        labelKey: `commands.server.stm.categories-edit.slot_${i + 1}_label`,
        // Only the first slot carries the long-form instructions to avoid clutter.
        descriptionKey: i === 0 ? "commands.server.stm.categories-edit.slot_instructions" : undefined,
        placeholder: "commands.server.stm.categories-edit.slot_placeholder",
        required: false,
        maxLength: CATEGORY_INPUT_MAX_LENGTH,
        value: current ? `${current.label}: ${current.description}` : undefined,
      });
    }

    // 5. Show the modal (Pattern 3 — no pre-defer; arg 4 auto-defers the submit).
    const modalResult = await promptWithRawModal(
      interaction,
      locale,
      {
        modalCustomId: MODAL_CUSTOM_ID,
        modalTitleKey: "commands.server.stm.categories-edit.modal_title",
        components,
      },
      MessageFlags.Ephemeral,
    );

    if (modalResult.outcome !== "submit") {
      log.info(`Server STM categories-edit modal ${modalResult.outcome}`);
      return;
    }

    modalSubmitInteraction = modalResult.interaction;
    if (!modalSubmitInteraction) {
      log.error("Server STM categories-edit modal submit interaction is undefined after successful submit");
      return;
    }

    // 6. Parse + validate each non-empty slot in order.
    const categories: ParsedCategory[] = [];
    const usedSlugs = new Set<string>();
    for (let i = 0; i < MAX_CATEGORY_SLOTS; i++) {
      const raw = modalResult.values?.[`${CATEGORY_INPUT_PREFIX}${i}`]?.trim() ?? "";
      if (!raw) continue;

      // 6a. Require the `label: description` shape (split on the FIRST colon only).
      const colonIndex = raw.indexOf(":");
      if (colonIndex === -1) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.server.stm.categories-edit.invalid_format_title",
          descriptionKey: "commands.server.stm.categories-edit.invalid_format_description",
          descriptionVars: { line: raw },
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const label = raw.slice(0, colonIndex).trim();
      const description = raw.slice(colonIndex + 1).trim();
      const slug = slugifyLabel(label);

      // 6b. Label must be present and slugify to a usable identifier; description required.
      if (!label || !slug || !description) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.server.stm.categories-edit.invalid_category_title",
          descriptionKey: "commands.server.stm.categories-edit.invalid_category_description",
          descriptionVars: { line: raw },
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // 6c. Reject colliding slugs so two labels can't map to one tool parameter.
      if (usedSlugs.has(slug)) {
        await replyInfoEmbed(modalSubmitInteraction, locale, {
          titleKey: "commands.server.stm.categories-edit.duplicate_title",
          descriptionKey: "commands.server.stm.categories-edit.duplicate_description",
          descriptionVars: { label },
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      usedSlugs.add(slug);
      categories.push({ position: categories.length, label, description });
    }

    // 7. All slots empty → restore the default `summary` category (README decision 9).
    const isReset = categories.length === 0;
    const toPersist: ParsedCategory[] = isReset
      ? [{ position: 0, label: DEFAULT_SUMMARY_LABEL, description: DEFAULT_SUMMARY_DESCRIPTION }]
      : categories;

    // 8. Replace-all the server's category definitions in one transaction.
    const saved = await shortTermMemoryRepository.upsertStmCategories(tomoriState.server_id, toPersist);
    if (!saved) {
      await replyInfoEmbed(modalSubmitInteraction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 9. Evict this server's cached STM entries AFTER the write (CLAUDE.md rule 5). The slug
    //    schema just changed, and other-channel rendering dumps the cached slug→value map
    //    wholesale, so stale orphaned values would otherwise keep rendering. The scan path
    //    does not re-hydrate from the DB, so evicted entries stay clean until fresh activity.
    for (const entry of shortTermMemoryRepository.getForServer(interaction.guildId)) {
      shortTermMemoryRepository.clearForServerChannel(interaction.guildId, entry.channelId, entry.personaId);
    }

    // 10. Echo the resulting category list.
    const summary = toPersist.map((cat, index) => `${index + 1}. **${cat.label}** — ${cat.description}`).join("\n");
    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: isReset
        ? "commands.server.stm.categories-edit.reset_title"
        : "commands.server.stm.categories-edit.success_title",
      descriptionKey: isReset
        ? "commands.server.stm.categories-edit.reset_description"
        : "commands.server.stm.categories-edit.success_description",
      descriptionVars: { count: toPersist.length.toString(), categories: summary },
      color: ColorCode.SUCCESS,
      flags: MessageFlags.Ephemeral,
    });

    log.success(
      `Updated STM categories for server ${tomoriState.server_id} (${toPersist.length}${isReset ? ", reset to default" : ""}) by ${userData.user_disc_id}`,
    );
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      serverId: tomoriState?.server_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "server stm categories-edit",
        guildId: interaction.guildId,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error in /server stm categories-edit", error as Error, context);

    const replyTarget = modalSubmitInteraction ?? interaction;
    await replyInfoEmbed(replyTarget, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
