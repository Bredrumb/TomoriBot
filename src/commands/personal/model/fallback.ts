import type { ChatInputCommandInteraction, ButtonInteraction, Client, SlashCommandSubcommandBuilder } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { createStandardEmbed } from "@/utils/discord/embedHelper";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithRawModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { log, ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import {
  loadAvailableModelsForProvider,
  loadCustomEndpointsForUser,
  getLlmsByIds,
  loadCustomEndpointsByIds,
} from "@/utils/db/repositories";
import type {
  ErrorContext,
  LlmRow,
  UserRow,
  SavedProviderConfigRow,
  FallbackModelRef,
  FallbackEntry,
  CustomEndpointRow,
} from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { upsertUserSavedProviderConfig } from "@/utils/db/repositories";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { replyLegacyOpenRouterOtherModelMoved } from "@/utils/discord/openrouterModelMigrationNotice";
import { loadUserSavedProvidersForCapability } from "@/utils/provider/savedProviderConfig";
import { promptForSavedProvider } from "@/commands/model/providerPicker";
import { isCustomProvider, parseCustomProvider } from "@/utils/provider/customProviderUtils";

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
const CUSTOM_ENDPOINT_VALUE_PREFIX = "ce:";
const ITEMS_PER_PAGE = 24;

function getLocalizedDescription(model: LlmRow, locale: string): string {
  const normalizedLocale = locale.toLowerCase().split("-")[0];
  const description = normalizedLocale === "ja" ? model.ja_description : model.llm_description;
  const baseDescription = description || model.llm_description || `${model.llm_provider} model`;
  const flags: string[] = [];
  if (model.is_free) flags.push("FREE");
  if (model.has_tools) flags.push("TOOLS");
  if (model.sees_images) flags.push("IMG");
  if (model.sees_videos) flags.push("VID");
  if (model.supports_structoutput) flags.push("STRUCT");
  return flags.length > 0 ? `(${flags.join("+")}) ${baseDescription}` : baseDescription;
}

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
    const modelLabel = entry.model.llm_codename;
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

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand.setName("fallback").setDescription(localizer("en-US", "commands.personal.model.fallback.description"));

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  userData: UserRow,
  locale: string,
): Promise<void> {
  if (!interaction.channel) {
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.channel_only_title",
      descriptionKey: "general.errors.channel_only_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!userData.user_id) {
    return;
  }

  try {
    // 1. Load all personal text providers and present the picker.
    //    UserSavedProviderConfigRow shares the `provider` field that promptForSavedProvider reads,
    //    so the cast is safe — the picker only uses that field to build button labels.
    const savedProviders = await loadUserSavedProvidersForCapability(userData.user_id, "text");
    if (savedProviders.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.personal.model.fallback.no_provider_title",
        descriptionKey: "commands.personal.model.fallback.no_provider_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const providerSelection = await promptForSavedProvider(
      interaction,
      locale,
      savedProviders as unknown as SavedProviderConfigRow[],
    );
    if (!providerSelection) return;

    const selectedProvider = providerSelection.provider;
    const responseInteraction = providerSelection.interaction;

    // 2. Find the selected provider's config row to read existing fallback_model_refs
    const selectedConfig = savedProviders.find((p) => p.provider.toLowerCase() === selectedProvider) ?? null;
    const existingRefs = selectedConfig?.fallback_model_refs ?? [];

    // 3. Resolve existing refs into a typed fallback chain for placeholder display
    const llmRefIds = existingRefs.filter((r) => r.type === "llm").map((r) => r.id);
    const epRefIds = existingRefs.filter((r) => r.type === "custom_endpoint").map((r) => r.id);
    const [refLlms, refEndpoints] = await Promise.all([
      llmRefIds.length > 0 ? getLlmsByIds(llmRefIds) : Promise.resolve([]),
      epRefIds.length > 0 ? loadCustomEndpointsByIds(epRefIds) : Promise.resolve([]),
    ]);
    const llmMap = new Map(refLlms.map((m) => [m.llm_id as number, m]));
    const epMap = new Map(refEndpoints.map((e) => [e.custom_endpoint_id as number, e]));
    const existingChain: FallbackEntry[] = existingRefs
      .map((ref) => {
        if (ref.type === "llm") {
          const model = llmMap.get(ref.id);
          return model ? ({ kind: "llm", model } as FallbackEntry) : null;
        }
        const endpoint = epMap.get(ref.id);
        return endpoint ? ({ kind: "custom_endpoint", endpoint } as FallbackEntry) : null;
      })
      .filter((e): e is FallbackEntry => e !== null);

    // 4. Load model options for the selected provider
    let availableModels: LlmRow[] = [];
    let availableEndpoints: CustomEndpointRow[] = [];
    let allModelOptions: SelectOption[];

    if (isCustomProvider(selectedProvider)) {
      const parsed = parseCustomProvider(selectedProvider);
      const label = parsed?.label ?? null;
      const allEndpoints = await loadCustomEndpointsForUser(userData.user_id);
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
      availableModels =
        (await loadAvailableModelsForProvider(selectedProvider, false, {
          kind: "personal",
          ownerId: userData.user_id,
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

      allModelOptions = selectableModels.map((model) => ({
        label: safeSelectOptionText(model.llm_codename),
        value: safeSelectOptionText(model.llm_codename),
        description: safeSelectOptionText(getLocalizedDescription(model, userData.language_pref)),
      }));
    }

    // 5. Build per-slot placeholders
    const currentFallbackPlaceholders = SLOT_IDS.map((_, index) =>
      buildSlotPlaceholder(locale, existingChain[index] ?? null, existingRefs[index] ?? null, selectedProvider),
    );

    const clearOption: SelectOption = {
      label: safeSelectOptionText(localizer(locale, "commands.model.fallback.clear_option_label")),
      value: CLEAR_SLOT_VALUE,
      description: safeSelectOptionText(localizer(locale, "commands.model.fallback.clear_option_description")),
    };

    // 6. Pagination if needed
    let optionsForModal = allModelOptions;
    let modalInteraction: ChatInputCommandInteraction | ButtonInteraction = responseInteraction;

    if (allModelOptions.length > ITEMS_PER_PAGE) {
      const totalPages = Math.ceil(allModelOptions.length / ITEMS_PER_PAGE);
      const pageButtons = Array.from({ length: Math.min(totalPages, 9) }, (_, index) =>
        new ButtonBuilder()
          .setCustomId(`personal_fallback_page_${index + 1}`)
          .setLabel((index + 1).toString())
          .setStyle(ButtonStyle.Primary),
      );

      const pageSelectEmbed = createStandardEmbed(locale, {
        titleKey: "general.pagination.select_page_title",
        descriptionKey: "general.pagination.select_page_description",
        descriptionVars: { totalItems: allModelOptions.length, totalPages },
        color: ColorCode.INFO,
      });

      const pageSelectMessage = providerSelection.pickerInteraction
        ? await (responseInteraction as ButtonInteraction).editReply({
            embeds: [pageSelectEmbed],
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...pageButtons)],
          })
        : await interaction.reply({
            embeds: [pageSelectEmbed],
            components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...pageButtons)],
            flags: MessageFlags.Ephemeral,
          });

      try {
        const pageButtonInteraction = await pageSelectMessage.awaitMessageComponent({
          filter: (componentInteraction) =>
            componentInteraction.user.id === interaction.user.id &&
            componentInteraction.customId.startsWith("personal_fallback_page_"),
          time: 300000,
        });
        const selectedPage = Number.parseInt(pageButtonInteraction.customId.replace("personal_fallback_page_", ""), 10);
        const startIndex = (selectedPage - 1) * ITEMS_PER_PAGE;
        optionsForModal = [clearOption, ...allModelOptions.slice(startIndex, startIndex + ITEMS_PER_PAGE)];
        modalInteraction = pageButtonInteraction as ButtonInteraction;
      } catch {
        await interaction.editReply({ embeds: [], components: [] }).catch(() => {});
        return;
      }
    }

    if (allModelOptions.length <= ITEMS_PER_PAGE) {
      optionsForModal = [clearOption, ...allModelOptions];
    }

    const modalResult = await promptWithRawModal(
      modalInteraction,
      locale,
      {
        modalCustomId: `personal_model_fallback_modal_${interaction.id}`,
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

    if (modalResult.outcome !== "submit" || !modalResult.interaction) {
      return;
    }

    const values = modalResult.values ?? {};

    // 7. Build lookup maps
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

    // 8. Per-slot merge: blank = keep existing, __none__ = clear, value = update
    const mergedRefs: FallbackModelRef[] = [];
    for (let i = 0; i < 5; i++) {
      const raw = (values[SLOT_IDS[i]] ?? "").trim();

      if (raw === "") {
        if (existingRefs[i]) mergedRefs.push(existingRefs[i]);
      } else if (raw === CLEAR_SLOT_VALUE) {
        // Explicit clear — skip
      } else if (raw.startsWith(CUSTOM_ENDPOINT_VALUE_PREFIX)) {
        const epId = Number.parseInt(raw.slice(CUSTOM_ENDPOINT_VALUE_PREFIX.length), 10);
        if (!Number.isNaN(epId)) mergedRefs.push({ type: "custom_endpoint", id: epId });
      } else {
        if (selectedProvider === "openrouter" && raw === "other-model") {
          await replyLegacyOpenRouterOtherModelMoved(modalResult.interaction, locale, "personal");
          return;
        }
        const match = availableModels.find((model) => model.llm_codename === raw);
        if (match?.llm_id !== undefined) mergedRefs.push({ type: "llm", id: match.llm_id });
      }
    }

    // 9. Deduplicate by type+id
    const seen = new Set<string>();
    const finalRefs: FallbackModelRef[] = [];
    for (const ref of mergedRefs) {
      const key = `${ref.type}:${ref.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        finalRefs.push(ref);
      }
    }

    // 10. Validate: no fallback can duplicate the primary model of the selected provider config
    const primaryLlmId = selectedConfig?.llm_id ?? null;
    if (primaryLlmId && finalRefs.some((r) => r.type === "llm" && r.id === primaryLlmId)) {
      const primaryModel = resolvedModelMap.get(primaryLlmId);
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "commands.model.fallback.primary_conflict_title",
        descriptionKey: "commands.model.fallback.primary_conflict_description",
        descriptionVars: { model: primaryModel?.llm_codename ?? `#${primaryLlmId}` },
        color: ColorCode.ERROR,
      });
      return;
    }

    if (!selectedConfig) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "general.errors.unknown_error_title",
        descriptionKey: "general.errors.unknown_error_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 11. Write — update only fallback refs on the selected provider config
    const llmOnlyIds = finalRefs.filter((r) => r.type === "llm").map((r) => r.id);
    const writeOk = await upsertUserSavedProviderConfig(userData.user_id, {
      ...selectedConfig,
      fallback_model_refs: finalRefs,
      fallback_llm_ids: llmOnlyIds,
    });
    if (!writeOk) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    // 12. Success embed
    if (finalRefs.length === 0) {
      await replyInfoEmbed(modalResult.interaction, locale, {
        titleKey: "commands.personal.model.fallback.cleared_title",
        descriptionKey: "commands.personal.model.fallback.cleared_description",
        descriptionVars: { provider: getProviderDisplayName(selectedProvider) },
        color: ColorCode.SUCCESS,
      });
      return;
    }

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

    await replyInfoEmbed(modalResult.interaction, locale, {
      titleKey: "commands.personal.model.fallback.success_title",
      descriptionKey: "commands.personal.model.fallback.success_description",
      descriptionVars: {
        model_list: modelList,
        provider: getProviderDisplayName(selectedProvider),
      },
      color: ColorCode.SUCCESS,
    });
  } catch (error) {
    const context: ErrorContext = {
      userId: userData.user_id,
      errorType: "CommandExecutionError",
      metadata: {
        command: "personal model fallback",
        guildId: interaction.guild?.id,
        executorDiscordId: interaction.user.id,
      },
    };
    await log.error("Error executing /personal model fallback", error as Error, context);
    await replyInfoEmbed(interaction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
