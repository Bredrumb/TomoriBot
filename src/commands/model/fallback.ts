import type { ChatInputCommandInteraction, ButtonInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags, ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { getCachedTomoriState } from "@/utils/cache/tomoriStateCache";
import { llmModelRepo, llmOverrideRepo, llmProviderRepo } from "@/utils/db/repositories";

import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { safeReply } from "@/utils/discord/safeReply";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import type { LlmRow, UserRow, FallbackModelRef, FallbackEntry, CustomEndpointRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { replyLegacyOpenRouterOtherModelMoved } from "@/utils/discord/openrouterModelMigrationNotice";
import { loadSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { promptForSavedProvider } from "@/utils/discord/providerPicker";
import { isCustomProvider, parseCustomProvider } from "@/utils/provider/customProviderUtils";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";

// Modal field identifiers
// Note: MODAL_CUSTOM_ID is generated per-invocation (see execute()) to prevent stale
// awaitModalSubmit listeners from a previous run resolving on the same submission.
const SLOT_IDS = [
  "fallback_slot_1",
  "fallback_slot_2",
  "fallback_slot_3",
  "fallback_slot_4",
  "fallback_slot_5",
] as const;

const SLOT_LABEL_KEYS = [
  "commands.model.fallback.slot_1_label",
  "commands.model.fallback.slot_2_label",
  "commands.model.fallback.slot_3_label",
  "commands.model.fallback.slot_4_label",
  "commands.model.fallback.slot_5_label",
] as const;
const CLEAR_SLOT_VALUE = "__none__";
// Prefix used to distinguish custom endpoint values from LLM codenames in modal select values
const CUSTOM_ENDPOINT_VALUE_PREFIX = "ce:";

// One select option is reserved for the explicit "None" / clear choice.
const ITEMS_PER_PAGE = 24;
const FALLBACK_DEBUG_ENABLED = new Set(["1", "true", "yes", "on"]).has(
  (process.env.FALLBACK_DEBUG_ENABLED ?? "").trim().toLowerCase(),
);

/**
 * Returns a localized description string for a given LLM model, with capability flags prepended.
 *
 * @param model - The LLM model row from the database
 * @param locale - User's preferred locale (e.g., "ja", "en-US")
 * @returns Localized description string with flags prefix
 */
function getLocalizedDescription(model: LlmRow, locale: string): string {
  const normalizedLocale = locale.toLowerCase().split("-")[0];
  const description = normalizedLocale === "ja" ? model.ja_description : model.llm_description;
  const baseDescription = description || model.llm_description || `${model.llm_provider} model`;

  if (model.llm_codename === "other-model") return baseDescription;

  const flags: string[] = [];
  if (model.is_free && !isCustomProvider(model.llm_provider)) flags.push("FREE");
  if (model.has_tools) flags.push("TOOLS");
  if (model.sees_images) flags.push("IMG");
  if (model.sees_videos) flags.push("VID");
  if (model.supports_structoutput) flags.push("STRUCT");

  const flagPrefix = flags.length > 0 ? `(${flags.join("+")}) ` : "";
  return `${flagPrefix}${baseDescription}`;
}

/**
 * Returns a capability flags string for a custom endpoint (e.g. "(TOOLS+IMG)").
 *
 * @param ep - The custom endpoint row
 * @returns Flag prefix string or empty string if no flags
 */
function getEndpointFlagPrefix(ep: CustomEndpointRow): string {
  const flags: string[] = [];
  if (ep.has_tools) flags.push("TOOLS");
  if (ep.sees_images) flags.push("IMG");
  if (ep.sees_videos) flags.push("VID");
  if (ep.supports_structoutput) flags.push("STRUCT");
  return flags.length > 0 ? `(${flags.join("+")}) ` : "";
}

function truncatePlaceholderValue(value: string): string {
  return value.length > 90 ? `${value.slice(0, 87)}...` : value;
}

/**
 * Builds a human-readable label for one slot in the fallback chain.
 * Includes the provider name in parentheses when the entry is from a different provider than selected.
 *
 * @param locale - User locale
 * @param entry - Resolved fallback entry for this slot, or null if empty
 * @param rawRef - Raw ref from config (for unknown/unresolved IDs)
 * @param selectedProvider - The provider currently being configured (to decide if provider suffix is needed)
 */
function buildSlotPlaceholder(
  locale: string,
  entry: FallbackEntry | null,
  rawRef: FallbackModelRef | null,
  selectedProvider: string,
): string {
  if (!entry) {
    if (rawRef !== null) {
      return localizer(locale, "commands.model.fallback.current_placeholder", {
        model: truncatePlaceholderValue(`${localizer(locale, "general.unknown")} (#${rawRef.id})`),
      });
    }
    return localizer(locale, "commands.model.fallback.current_placeholder", {
      model: localizer(locale, "general.none"),
    });
  }

  if (entry.kind === "llm") {
    const modelLabel =
      entry.model.llm_codename === "other-model"
        ? `other-model -> ${entry.model.llm_codename}`
        : entry.model.llm_codename;

    // Show provider in parentheses when different from the one currently being configured
    const entryProvider = entry.model.llm_provider.toLowerCase();
    if (!isCustomProvider(selectedProvider) && entryProvider !== selectedProvider.toLowerCase()) {
      return localizer(locale, "commands.model.fallback.current_placeholder_with_provider", {
        model: truncatePlaceholderValue(modelLabel),
        provider: getProviderDisplayName(entryProvider),
      });
    }
    return localizer(locale, "commands.model.fallback.current_placeholder", {
      model: truncatePlaceholderValue(modelLabel),
    });
  }

  // Custom endpoint
  const epLabel = `${entry.endpoint.label}:${entry.endpoint.model_name ?? entry.endpoint.label}`;
  const parsed = parseCustomProvider(selectedProvider);
  const selectedLabel = parsed?.label ?? null;
  if (selectedLabel !== entry.endpoint.label) {
    return localizer(locale, "commands.model.fallback.current_placeholder_with_provider", {
      model: truncatePlaceholderValue(epLabel),
      provider: localizer(locale, "commands.model.fallback.custom_provider_label"),
    });
  }
  return localizer(locale, "commands.model.fallback.current_placeholder", {
    model: truncatePlaceholderValue(epLabel),
  });
}

// Configure the subcommand
export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("fallback").setDescription(localizer("en-US", "commands.model.fallback.description"));

/**
 * Handles the /model fallback command.
 * Allows server admins to configure up to 5 ordered fallback models for automatic failover.
 * Supports mixing models from different providers and custom endpoints.
 *
 * @param _client - Discord client instance (unused)
 * @param interaction - The slash command interaction
 * @param userData - Invoking user's database record
 * @param locale - User's preferred locale
 */
export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  // 1a. Scope modal custom ID to this invocation so stale awaitModalSubmit listeners
  //     from earlier (un-submitted) runs don't also resolve on this submission.
  const MODAL_CUSTOM_ID = `config_model_fallback_modal_${interaction.id}`;

  // 1b. Ensure the command is run in a channel context
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, userData.language_pref, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // 2. Load the Tomori state for this server
  const serverDiscId = interaction.guild?.id ?? interaction.user.id;
  const tomoriState = await getCachedTomoriState(serverDiscId);
  if (!tomoriState) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.tomori_not_setup_title",
      descriptionKey: "general.errors.tomori_not_setup_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (FALLBACK_DEBUG_ENABLED) {
    log.info(
      `[FallbackDebug][/model fallback] server_disc_id=${serverDiscId} server_id=${tomoriState.server_id} current_chain=${JSON.stringify(tomoriState.config.fallback_model_refs)}`,
    );
  }

  // 3. Load saved providers and show provider picker (includes custom providers)
  const savedProviders = await loadSavedProvidersForCapability(tomoriState.server_id, "text");
  if (savedProviders.length === 0) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "commands.model.fallback.no_providers_title",
      descriptionKey: "commands.model.fallback.no_providers_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const providerSelection = await promptForSavedProvider(interaction, locale, savedProviders);
  if (!providerSelection) return;

  const selectedProvider = providerSelection.provider;
  const responseInteraction = providerSelection.interaction;

  // 4. Load model options for the selected provider
  let availableModels: LlmRow[] = [];
  let availableEndpoints: CustomEndpointRow[] = [];
  let allModelOptions: SelectOption[];

  if (isCustomProvider(selectedProvider)) {
    // Custom endpoint path — enumerate registered endpoints for this label
    const parsed = parseCustomProvider(selectedProvider);
    const label = parsed?.label ?? null;
    const allEndpoints = await llmProviderRepo.loadCustomEndpointsForServer(tomoriState.server_id);
    availableEndpoints = label ? allEndpoints.filter((ep) => ep.label === label && ep.capability === "text") : [];

    if (availableEndpoints.length === 0) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.model.fallback.no_models_title",
        descriptionKey: "commands.model.fallback.no_models_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    allModelOptions = availableEndpoints.map((ep) => ({
      label: safeSelectOptionText(`${ep.label}:${ep.model_name ?? ep.label}`),
      value: `${CUSTOM_ENDPOINT_VALUE_PREFIX}${ep.custom_endpoint_id}`,
      description: safeSelectOptionText(`${getEndpointFlagPrefix(ep)}${ep.model_name ?? ep.label}`),
    }));
  } else {
    // Standard provider path
    availableModels =
      (await llmModelRepo.loadAvailableModelsForProvider(selectedProvider, false, {
        kind: "server",
        ownerId: tomoriState.server_id,
      })) ?? [];

    if (availableModels.length === 0) {
      await replyInfoEmbed(responseInteraction, locale, {
        titleKey: "commands.model.fallback.no_models_title",
        descriptionKey: "commands.model.fallback.no_models_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const selectableModels =
      selectedProvider === "openrouter"
        ? availableModels.filter((model) => model.llm_codename !== "other-model")
        : availableModels;

    allModelOptions = selectableModels.map((m) => ({
      label: safeSelectOptionText(m.llm_codename),
      value: safeSelectOptionText(m.llm_codename),
      description: safeSelectOptionText(getLocalizedDescription(m, userData.language_pref)),
    }));
  }

  // 5. Build per-slot placeholders from the existing fallback_chain (cross-provider aware)
  const existingRefs = tomoriState.config.fallback_model_refs ?? [];
  const existingChain = tomoriState.fallback_chain ?? [];
  const currentFallbackPlaceholders = SLOT_IDS.map((_, index) =>
    buildSlotPlaceholder(locale, existingChain[index] ?? null, existingRefs[index] ?? null, selectedProvider),
  );

  const clearOption: SelectOption = {
    label: safeSelectOptionText(localizer(locale, "commands.model.fallback.clear_option_label")),
    value: CLEAR_SLOT_VALUE,
    description: safeSelectOptionText(localizer(locale, "commands.model.fallback.clear_option_description")),
  };

  // 6. Handle pagination when models exceed Discord's 25-option limit per select
  let optionsForModal = allModelOptions;
  let modalInteraction: ChatInputCommandInteraction | ButtonInteraction = responseInteraction;

  if (allModelOptions.length > ITEMS_PER_PAGE) {
    const totalPages = Math.ceil(allModelOptions.length / ITEMS_PER_PAGE);

    // 6a. Build page-selection embed with numbered buttons
    const pageSelectEmbed = createStandardEmbed(locale, {
      titleKey: "general.pagination.select_page_title",
      descriptionKey: "general.pagination.select_page_description",
      descriptionVars: {
        totalItems: allModelOptions.length,
        totalPages,
      },
      color: ColorCode.INFO,
    });

    const maxButtons = Math.min(totalPages, 9);
    const pageButtons = Array.from({ length: maxButtons }, (_, i) =>
      new ButtonBuilder()
        .setCustomId(`fallback_page_${i + 1}`)
        .setLabel((i + 1).toString())
        .setStyle(ButtonStyle.Primary),
    );

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(...pageButtons);

    // 6b. Reply (or update picker) with page selector
    const pageSelectMessage = providerSelection.pickerInteraction
      ? await (responseInteraction as ButtonInteraction).editReply({
          embeds: [pageSelectEmbed],
          components: [actionRow],
        })
      : await interaction.reply({
          embeds: [pageSelectEmbed],
          components: [actionRow],
          flags: MessageFlags.Ephemeral,
        });

    try {
      // 6c. Wait for user to select a page
      const pageButtonInteraction = await pageSelectMessage.awaitMessageComponent({
        filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith("fallback_page_"),
        time: 300_000,
      });

      // 6d. Slice the options to the selected page
      const selectedPage = Number.parseInt(pageButtonInteraction.customId.replace("fallback_page_", ""), 10);
      const startIndex = (selectedPage - 1) * ITEMS_PER_PAGE;
      const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, allModelOptions.length);
      optionsForModal = [clearOption, ...allModelOptions.slice(startIndex, endIndex)];
      modalInteraction = pageButtonInteraction as ButtonInteraction;
    } catch {
      // Timeout — clean up and exit
      await safeReply(interaction.editReply({ embeds: [], components: [] }), "fallback model timeout cleanup");
      return;
    }
  }

  if (allModelOptions.length <= ITEMS_PER_PAGE) {
    optionsForModal = [clearOption, ...allModelOptions];
  }

  // 7. Show modal with 5 select fields (one per fallback slot)
  const modalResult = await promptWithRawModal(
    modalInteraction,
    locale,
    {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.model.fallback.modal_title",
      components: SLOT_IDS.map((customId, index) => ({
        customId,
        labelKey: SLOT_LABEL_KEYS[index],
        placeholder: currentFallbackPlaceholders[index],
        required: false,
        options: optionsForModal,
      })),
    },
    MessageFlags.Ephemeral,
  );

  if (modalResult.outcome !== "submit") {
    log.info(`Fallback model modal ${modalResult.outcome} for user ${userData.user_id}`);
    return;
  }

  if (!modalResult.interaction || !modalResult.values) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modalSubmitInteraction = modalResult.interaction;
  const values = modalResult.values;

  // 8. Build fast lookup maps for the current provider's options and existing chain
  const resolvedModelMap = new Map<number, LlmRow>();
  for (const m of availableModels) {
    if (m.llm_id !== undefined) resolvedModelMap.set(m.llm_id, m);
  }
  for (const entry of existingChain) {
    if (entry.kind === "llm" && entry.model.llm_id !== undefined) {
      resolvedModelMap.set(entry.model.llm_id, entry.model);
    }
  }
  const resolvedEndpointMap = new Map<number, CustomEndpointRow>();
  for (const ep of availableEndpoints) {
    if (ep.custom_endpoint_id !== undefined) resolvedEndpointMap.set(ep.custom_endpoint_id, ep);
  }
  for (const entry of existingChain) {
    if (entry.kind === "custom_endpoint" && entry.endpoint.custom_endpoint_id !== undefined) {
      resolvedEndpointMap.set(entry.endpoint.custom_endpoint_id, entry.endpoint);
    }
  }

  // 9. Per-slot merge: blank = keep existing, __none__ = clear, value = update
  const mergedRefs: FallbackModelRef[] = [];
  for (let i = 0; i < 5; i++) {
    const raw = (values[SLOT_IDS[i]] ?? "").trim();

    if (raw === "") {
      // User didn't touch this slot — preserve existing ref
      if (existingRefs[i]) mergedRefs.push(existingRefs[i]);
    } else if (raw === CLEAR_SLOT_VALUE) {
      // Explicit clear — skip (no push)
    } else if (raw.startsWith(CUSTOM_ENDPOINT_VALUE_PREFIX)) {
      // Custom endpoint selection
      const epId = Number.parseInt(raw.slice(CUSTOM_ENDPOINT_VALUE_PREFIX.length), 10);
      if (!Number.isNaN(epId)) mergedRefs.push({ type: "custom_endpoint", id: epId });
    } else {
      // LLM codename selection
      if (selectedProvider === "openrouter" && raw === "other-model") {
        await replyLegacyOpenRouterOtherModelMoved(modalSubmitInteraction, locale, "server");
        return;
      }
      const match = availableModels.find((m) => m.llm_codename === raw);
      if (match?.llm_id !== undefined) mergedRefs.push({ type: "llm", id: match.llm_id });
    }
  }

  // 10. Deduplicate by type+id, preserving order
  const seen = new Set<string>();
  const finalRefs: FallbackModelRef[] = [];
  for (const ref of mergedRefs) {
    const key = `${ref.type}:${ref.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      finalRefs.push(ref);
    }
  }

  // 11. Validate: no fallback can duplicate the primary model
  const primaryLlmId = tomoriState.config.llm_id;
  if (primaryLlmId && finalRefs.some((r) => r.type === "llm" && r.id === primaryLlmId)) {
    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.model.fallback.primary_conflict_title",
      descriptionKey: "commands.model.fallback.primary_conflict_description",
      descriptionVars: { model: tomoriState.llm.llm_codename },
      color: ColorCode.ERROR,
    });
    return;
  }

  if (FALLBACK_DEBUG_ENABLED) {
    log.info(`[FallbackDebug][/model fallback] server_disc_id=${serverDiscId} final_refs=${JSON.stringify(finalRefs)}`);
  }

  // 12. Write to database
  const writeOk = await llmOverrideRepo.setFallbackModelRefs(tomoriState.server_id, finalRefs, { serverDiscId });
  if (!writeOk) {
    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "general.errors.update_failed_title",
      descriptionKey: "general.errors.update_failed_description",
      color: ColorCode.ERROR,
    });
    return;
  }

  // 13. Reply with success — modalSubmitInteraction is already deferred and handles both picker and direct flows
  if (finalRefs.length === 0) {
    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.model.fallback.cleared_title",
      descriptionKey: "commands.model.fallback.cleared_description",
      color: ColorCode.SUCCESS,
    });
  } else {
    const modelList = finalRefs
      .map((ref, i) => {
        if (ref.type === "llm") {
          const m = resolvedModelMap.get(ref.id);
          const codename = m?.llm_codename ?? `#${ref.id}`;
          const provider = m?.llm_provider ? ` (${getProviderDisplayName(m.llm_provider)})` : "";
          return `${i + 1}. \`${codename}\`${provider}`;
        }
        const ep = resolvedEndpointMap.get(ref.id);
        const label = ep ? `${ep.label}:${ep.model_name ?? ep.label}` : `#${ref.id}`;
        return `${i + 1}. \`${label}\` (Custom)`;
      })
      .join("\n");

    await replyInfoEmbed(modalSubmitInteraction, locale, {
      titleKey: "commands.model.fallback.success_title",
      descriptionKey: "commands.model.fallback.success_description",
      descriptionVars: { model_list: modelList },
      color: ColorCode.SUCCESS,
    });
  }
}
