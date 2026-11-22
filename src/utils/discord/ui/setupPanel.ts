import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  TextInputStyle,
  type ComponentInContainerData,
  type SelectMenuComponentOptionData,
} from "discord.js";
import {
  isSetupDraftComplete,
  isSetupDraftProviderAccessComplete,
  type SetupDraftContext,
  type SetupDraftEndpointConnection,
  type SetupDraftEndpointModel,
  type SetupDraftProviderAccess,
  type SetupDraftRecord,
  type SetupDraftStartingSettings,
  type SetupDraftSystemPrompt,
} from "@/types/discord/setupWizard";
import { SETUP_FEATURES, type SetupFeature, type SystemPromptPresetRow, type TomoriPresetRow } from "@/types/db/schema";
import {
  buildSetupCancelRouteId,
  buildSetupEndpointConnectionRouteId,
  buildSetupEndpointConnectionSubmitRouteId,
  buildSetupEndpointModelRouteId,
  buildSetupEndpointModelSubmitRouteId,
  buildSetupFinishRouteId,
  buildSetupPoliciesRouteId,
  buildSetupPoliciesSubmitRouteId,
  buildSetupProviderByokSubmitRouteId,
  buildSetupProviderCatalogSubmitRouteId,
  buildSetupProviderModeRouteId,
  buildSetupSettingsRouteId,
  buildSetupSettingsSubmitRouteId,
} from "@/utils/discord/interactions/setupRoutes";
import type { CustomEndpointApiStyle, SetupCustomEndpointCapability } from "@/types/db/schema";
import { buildNoticeContainer, validateAndFallbackPanelPayload } from "@/utils/discord/ui/interactionCore";
import { buildPanelContainer, buildPanelReceiptContainer, withLinePrefix } from "@/utils/discord/ui/panel";
import {
  getAllProviderChoices,
  getProviderAddChoiceDescriptionKey,
  getProviderDisplayName,
} from "@/utils/provider/providerInfoRegistry";
import { safeSelectOptionText } from "@/utils/discord/ui/modals";
import type { PanelReceipt } from "@/types/discord/panel";
import type { RawDiscordComponent } from "@/types/discord/rawApiTypes";
import { ColorCode } from "@/utils/misc/logger";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { statusNote } from "@/utils/discord/ui/statusTitle";
import { localizer, resolveDescription, resolvePresetDisplayName } from "@/utils/text/localizer";
import { formatUTCOffset, formatUtcOffsetInput, parseUtcOffsetInput } from "@/utils/text/timezoneHelper";
import { buildLegalDocUrl } from "@/utils/misc/docsUrl";
import type { ComponentsV2MessagePayload } from "@/utils/discord/ui/componentsV2Limits";

const SETUP_ENDPOINT_STYLE_KEYS: Record<
  (typeof SETUP_ENDPOINT_API_STYLES)[number],
  { label: string; description: string }
> = {
  "openai-compatible": {
    label: "commands.setup.wizard.custom_endpoint_style_openai",
    description: "commands.setup.wizard.custom_endpoint_style_openai_desc",
  },
  "ollama-native": {
    label: "commands.setup.wizard.custom_endpoint_style_ollama",
    description: "commands.setup.wizard.custom_endpoint_style_ollama_desc",
  },
};

const SETUP_ENDPOINT_CAPABILITY_KEYS: Record<
  (typeof SETUP_ENDPOINT_TEXT_CAPABILITIES)[number],
  { label: string; description: string }
> = {
  tools: {
    label: "commands.setup.wizard.custom_endpoint_cap_tools",
    description: "commands.setup.wizard.custom_endpoint_cap_tools_desc",
  },
  vision: {
    label: "commands.setup.wizard.custom_endpoint_cap_vision",
    description: "commands.setup.wizard.custom_endpoint_cap_vision_desc",
  },
  structured_output: {
    label: "commands.setup.wizard.custom_endpoint_cap_structured_output",
    description: "commands.setup.wizard.custom_endpoint_cap_structured_output_desc",
  },
  json: {
    label: "commands.setup.wizard.custom_endpoint_cap_json",
    description: "commands.setup.wizard.custom_endpoint_cap_json_desc",
  },
  strict_role_alternation: {
    label: "commands.setup.wizard.custom_endpoint_cap_strict_role_alternation",
    description: "commands.setup.wizard.custom_endpoint_cap_strict_role_alternation_desc",
  },
  prefix_completion: {
    label: "commands.setup.wizard.custom_endpoint_cap_prefix_completion",
    description: "commands.setup.wizard.custom_endpoint_cap_prefix_completion_desc",
  },
  assistant_prefill: {
    label: "commands.setup.wizard.custom_endpoint_cap_assistant_prefill",
    description: "commands.setup.wizard.custom_endpoint_cap_assistant_prefill_desc",
  },
  verbatim_tool_calling: {
    label: "commands.setup.wizard.custom_endpoint_cap_verbatim_tool_calling",
    description: "commands.setup.wizard.custom_endpoint_cap_verbatim_tool_calling_desc",
  },
};

export interface SetupProviderOptionSummary {
  value: string;
  labelKey: string;
  descriptionKey: string;
  summaryKey: string;
}

export interface SetupWizardPayloadInput {
  draft: SetupDraftRecord;
  locale: string;
  isHosted: boolean;
  nonce: string;
  notice?: string;
  receipt?: PanelReceipt;
  // Three states matter: undefined skips resolution when nothing is stored, null marks a failed read that re-pends
  // the step, and an object holds live catalogs.
  settingsCatalogs?: SetupSettingsCatalogs | null;
  providerOptions?: readonly SetupProviderOptionSummary[];
  optionComponents?: readonly ComponentInContainerData[];
  optionReady?: boolean;
}

export interface SetupSettingsCatalogs {
  personas: Array<{ id: number; name: string; description: string }>;
  prompts: Array<{ name: string; displayName: string; description: string }>;
  // Used only at final commit because prompt text must come from the same live read that verified the preset
  // identity, not a stale draft copy.
  promptTexts: Map<string, string>;
}

const SETUP_MODAL_SELECT_OPTION_LIMIT = 25;

const SETUP_OPTION_VALUE_LIMIT = 100;

// Fails closed for the whole step when either catalog exceeds Discord's 25-option modal select cap because truncating
// could silently drop a stored choice.
export function areSetupSettingsCatalogsRenderable(
  catalogs: SetupSettingsCatalogs | null,
): catalogs is SetupSettingsCatalogs {
  if (!catalogs) return false;
  // The prompt select also carries the synthetic built-in default.
  return (
    catalogs.personas.length <= SETUP_MODAL_SELECT_OPTION_LIMIT &&
    catalogs.prompts.length + 1 <= SETUP_MODAL_SELECT_OPTION_LIMIT
  );
}

const SETUP_FEATURE_KEYS: Record<SetupFeature, { label: string; description: string }> = {
  expressions: {
    label: "commands.setup.wizard.settings_features.expressions.label",
    description: "commands.setup.wizard.settings_features.expressions.description",
  },
  playful_interactions: {
    label: "commands.setup.wizard.settings_features.playful_interactions.label",
    description: "commands.setup.wizard.settings_features.playful_interactions.description",
  },
  danbooru: {
    label: "commands.setup.wizard.settings_features.danbooru.label",
    description: "commands.setup.wizard.settings_features.danbooru.description",
  },
  natural_nudges: {
    label: "commands.setup.wizard.settings_features.natural_nudges.label",
    description: "commands.setup.wizard.settings_features.natural_nudges.description",
  },
  dice_rolls: {
    label: "commands.setup.wizard.settings_features.dice_rolls.label",
    description: "commands.setup.wizard.settings_features.dice_rolls.description",
  },
  self_message_management: {
    label: "commands.setup.wizard.settings_features.self_message_management.label",
    description: "commands.setup.wizard.settings_features.self_message_management.description",
  },
  user_blocking: {
    label: "commands.setup.wizard.settings_features.user_blocking.label",
    description: "commands.setup.wizard.settings_features.user_blocking.description",
  },
  user_info_updates: {
    label: "commands.setup.wizard.settings_features.user_info_updates.label",
    description: "commands.setup.wizard.settings_features.user_info_updates.description",
  },
  short_term_memory: {
    label: "commands.setup.wizard.settings_features.short_term_memory.label",
    description: "commands.setup.wizard.settings_features.short_term_memory.description",
  },
};

const HUMANIZER_KEYS: Record<0 | 1 | 2 | 3, { label: string; description: string }> = {
  0: {
    label: "commands.setup.humanizer_option_none_label",
    description: "commands.setup.humanizer_option_none_desc",
  },
  1: {
    label: "commands.setup.humanizer_option_light_label",
    description: "commands.setup.humanizer_option_light_desc",
  },
  2: {
    label: "commands.setup.humanizer_option_default_label",
    description: "commands.setup.humanizer_option_default_desc",
  },
  3: {
    label: "commands.setup.humanizer_option_heavy_label",
    description: "commands.setup.humanizer_option_heavy_desc",
  },
};

export function toSetupSettingsCatalogs(
  personaPresets: readonly TomoriPresetRow[] | null,
  promptPresets: readonly SystemPromptPresetRow[] | null,
  locale: string,
): SetupSettingsCatalogs | null {
  if (!personaPresets || !promptPresets) return null;
  // Option values are compared verbatim against the stored identity, and Discord caps one option's
  // value length, so a name at the cap would store a value that can never resolve back.
  if (personaPresets.some((preset) => preset.persona_preset_name.length > SETUP_OPTION_VALUE_LIMIT)) return null;
  if (promptPresets.some((preset) => preset.system_prompt_preset_name.length > SETUP_OPTION_VALUE_LIMIT)) return null;

  return {
    personas: personaPresets.map((preset) => ({
      id: preset.persona_preset_id,
      name: preset.persona_preset_name,
      description: preset.persona_preset_desc,
    })),
    prompts: promptPresets.map((preset) => ({
      name: preset.system_prompt_preset_name,
      displayName: resolvePresetDisplayName(preset, locale),
      description: resolveDescription(preset.descriptions, locale) ?? "",
    })),
    promptTexts: new Map(promptPresets.map((preset) => [preset.system_prompt_preset_name, preset.preset_prompt_text])),
  };
}

export function isSetupStartingSettingsResolvable(
  settings: SetupDraftStartingSettings,
  catalogs: SetupSettingsCatalogs,
): boolean {
  const { systemPrompt } = settings;
  if (!catalogs.personas.some((persona) => persona.id === settings.presetId)) return false;
  if (systemPrompt.kind === "built-in") return true;
  return catalogs.prompts.some((prompt) => prompt.name === systemPrompt.presetName);
}

function resolveProviderSummary(draft: SetupDraftRecord, locale: string, optionSummaryKey?: string): string {
  const access = draft.providerAccess;
  if (!access) {
    return `> ${localizer(locale, "commands.setup.wizard.provider_pending")}`;
  }

  if (access.mode === "option") {
    return optionSummaryKey
      ? `> ${localizer(locale, optionSummaryKey)}`
      : `> ${localizer(locale, "commands.setup.wizard.provider_pending")}`;
  }

  if (access.mode === "catalog") {
    const displayName = getProviderDisplayName(access.provider);
    return `> ${displayName}\n> ${localizer(locale, "commands.setup.wizard.provider_catalog_encrypted")}`;
  }

  if (access.mode === "user-byok") {
    return `> ${localizer(locale, "commands.setup.wizard.provider_byok_summary")}`;
  }

  if (access.connection && access.textModel) {
    return withLinePrefix(
      "> ",
      localizer(locale, "commands.setup.wizard.provider_custom_summary", {
        label: access.connection.label,
        model: access.textModel.modelCode,
      }),
    );
  }

  return `> ${localizer(locale, "commands.setup.wizard.provider_custom_pending")}`;
}

function resolveHumanizerLabel(humanizer: number, locale: string): string {
  return localizer(locale, (HUMANIZER_KEYS[humanizer as keyof typeof HUMANIZER_KEYS] ?? HUMANIZER_KEYS[2]).label);
}

function resolveSettingsSummary(
  settings: SetupDraftStartingSettings,
  locale: string,
  catalogs: SetupSettingsCatalogs | null,
): string {
  // A read that failed is not the same claim as a catalog that resolved without the row, so the two
  // get different wording: the first says the value could not be checked, the second says it is gone.
  const unresolvedKey =
    catalogs === null
      ? "commands.setup.wizard.settings_catalog_unavailable"
      : "commands.setup.wizard.settings_persona_unknown";
  const unresolvedPromptKey =
    catalogs === null
      ? "commands.setup.wizard.settings_catalog_unavailable"
      : "commands.setup.wizard.settings_prompt_unknown";

  const personaName =
    catalogs?.personas.find((persona) => persona.id === settings.presetId)?.name ?? localizer(locale, unresolvedKey);
  const { systemPrompt } = settings;
  const promptName =
    systemPrompt.kind === "built-in"
      ? localizer(locale, "commands.setup.wizard.settings_built_in_prompt_summary")
      : (catalogs?.prompts.find((prompt) => prompt.name === systemPrompt.presetName)?.displayName ??
        localizer(locale, unresolvedPromptKey));

  return [
    localizer(locale, "commands.setup.wizard.settings_summary_persona", {
      persona: personaName,
    }),
    localizer(locale, "commands.setup.wizard.settings_summary_reply_style", {
      style: resolveHumanizerLabel(settings.humanizer, locale),
    }),
    localizer(locale, "commands.setup.wizard.settings_summary_timezone", {
      tz: formatUTCOffset(settings.timezoneOffset),
    }),
    localizer(locale, "commands.setup.wizard.settings_summary_system_prompt", {
      prompt: promptName,
    }),
    localizer(locale, "commands.setup.wizard.settings_summary_features", {
      enabled: settings.features.length,
      total: SETUP_FEATURES.length,
    }),
  ]
    .map((row) => `> ${row}`)
    .join("\n");
}

export function buildSetupWizardPayload(
  input: SetupWizardPayloadInput,
): ComponentsV2MessagePayload & { attachments: readonly [] } {
  const { draft, locale, isHosted, nonce, notice, receipt } = input;

  const components: ComponentInContainerData[] = [];
  if (notice) {
    components.push({
      type: ComponentType.TextDisplay,
      content: withLinePrefix("-# ", notice),
    });
  }

  const providerOption = input.providerOptions?.find(
    (option) => draft.providerAccess?.mode === "option" && draft.providerAccess.value === option.value,
  );
  const providerComplete =
    isSetupDraftProviderAccessComplete(draft.providerAccess) &&
    (draft.providerAccess?.mode !== "option" || input.optionReady === true);
  // Revalidate saved IDs against live catalogs because missing rows or failed catalog loads must re-pend the step.
  const settingsComplete =
    draft.startingSettings !== null &&
    input.settingsCatalogs != null &&
    isSetupStartingSettingsResolvable(draft.startingSettings, input.settingsCatalogs);
  const policiesComplete = draft.policiesAccepted;

  // Gate completion on catalog checks as well as draft fields so Primary Finish never enables beside a pending step.
  const isComplete = isSetupDraftComplete(draft) && settingsComplete && providerComplete;

  const total = isHosted ? 3 : 2;
  const done = (isHosted && policiesComplete ? 1 : 0) + (providerComplete ? 1 : 0) + (settingsComplete ? 1 : 0);

  components.push({
    type: ComponentType.TextDisplay,
    content: isComplete
      ? `## ${localizer(locale, "commands.setup.wizard.title")}\n${localizer(locale, "commands.setup.wizard.intro_ready")}\n${localizer(locale, "commands.setup.wizard.progress", { done, total })}`
      : `## ${localizer(locale, "commands.setup.wizard.title")}\n${localizer(locale, "commands.setup.wizard.intro")}\n${localizer(locale, "commands.setup.wizard.progress", { done, total })}`,
  });

  if (isHosted) {
    const policiesStatus = policiesComplete ? "✓" : "○";
    const policiesQuote = policiesComplete
      ? localizer(locale, "commands.setup.wizard.policies_completed")
      : localizer(locale, "commands.setup.wizard.policies_pending");
    const policiesButtonLabel = localizer(
      locale,
      policiesComplete ? "commands.setup.wizard.policies_button_edit" : "commands.setup.wizard.policies_button_start",
    );

    components.push({
      type: ComponentType.TextDisplay,
      content: `### ${policiesStatus} ${localizer(locale, "commands.setup.wizard.policies_name")}\n${localizer(locale, "commands.setup.wizard.policies_description")}\n> ${policiesQuote}`,
    });

    components.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          customId: buildSetupPoliciesRouteId({ locale, nonce }),
          label: policiesButtonLabel,
          disabled: false,
        },
      ],
    });
  }

  const providerStatus = providerComplete ? "✓" : "○";
  const providerSummary = resolveProviderSummary(draft, locale, providerOption?.summaryKey);
  const providerHint = localizer(locale, "commands.setup.wizard.provider_hint", {
    help: commandRegistry.getCommandMention("help"),
  });
  components.push({
    type: ComponentType.TextDisplay,
    content: `### ${providerStatus} ${localizer(locale, "commands.setup.wizard.provider_name")}\n${localizer(locale, "commands.setup.wizard.provider_description")}\n${providerSummary}\n-# ${providerHint}`,
  });

  const providerOptions: SelectMenuComponentOptionData[] = (input.providerOptions ?? []).map((option) => ({
    label: safeSelectOptionText(localizer(locale, option.labelKey), SETUP_OPTION_VALUE_LIMIT),
    description: safeSelectOptionText(localizer(locale, option.descriptionKey), SETUP_OPTION_VALUE_LIMIT),
    value: `option:${option.value}`,
    default: draft.providerAccess?.mode === "option" && draft.providerAccess.value === option.value,
  }));
  providerOptions.push(
    {
      label: localizer(locale, "commands.setup.wizard.provider_option_catalog"),
      description: localizer(locale, "commands.setup.wizard.provider_option_catalog_description"),
      value: "catalog",
      default: draft.providerAccess?.mode === "catalog",
    },
    {
      label: localizer(locale, "commands.setup.wizard.provider_option_custom"),
      description: localizer(locale, "commands.setup.wizard.provider_option_custom_description"),
      value: "custom-endpoint",
      default: draft.providerAccess?.mode === "custom-endpoint",
    },
  );

  if (draft.context !== "dm") {
    providerOptions.push({
      label: localizer(locale, "commands.setup.wizard.provider_option_byok"),
      description: localizer(locale, "commands.setup.wizard.provider_option_byok_description"),
      value: "user-byok",
      default: draft.providerAccess?.mode === "user-byok",
    });
  }

  components.push({
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.StringSelect,
        customId: buildSetupProviderModeRouteId({ locale, nonce }),
        placeholder: localizer(locale, "commands.setup.wizard.provider_select_placeholder"),
        minValues: 1,
        maxValues: 1,
        options: providerOptions,
      },
    ],
  });

  if (draft.providerAccess?.mode === "option" && input.optionComponents?.length) {
    components.push(...input.optionComponents);
  }

  if (draft.providerAccess?.mode === "custom-endpoint") {
    const access = draft.providerAccess;
    const connectionLine = access.connection
      ? localizer(locale, "commands.setup.wizard.custom_endpoint_connection_configured", {
          label: access.connection.label,
        })
      : localizer(locale, "commands.setup.wizard.custom_endpoint_connection_pending");
    const modelLine = access.textModel
      ? localizer(locale, "commands.setup.wizard.custom_endpoint_model_configured", {
          model: access.textModel.modelCode,
        })
      : localizer(locale, "commands.setup.wizard.custom_endpoint_model_pending");

    components.push({
      type: ComponentType.TextDisplay,
      content: `-# ${localizer(locale, "commands.setup.wizard.custom_endpoint_hint")}\n> ${connectionLine}\n> ${modelLine}`,
    });

    const connectionButtonLabel = localizer(
      locale,
      access.connection
        ? "commands.setup.wizard.custom_endpoint_button_connection_edit"
        : "commands.setup.wizard.custom_endpoint_button_connection_start",
    );
    const modelButtonLabel = localizer(
      locale,
      access.textModel
        ? "commands.setup.wizard.custom_endpoint_button_model_edit"
        : "commands.setup.wizard.custom_endpoint_button_model_start",
    );

    components.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          customId: buildSetupEndpointConnectionRouteId({ locale, nonce }),
          label: connectionButtonLabel,
          style: ButtonStyle.Secondary,
        },
        {
          type: ComponentType.Button,
          customId: buildSetupEndpointModelRouteId({ locale, nonce }),
          label: modelButtonLabel,
          style: ButtonStyle.Secondary,
          disabled: !access.connection,
        },
      ],
    });
  }

  const settingsStatus = settingsComplete ? "✓" : "○";
  const settingsSummary = draft.startingSettings
    ? resolveSettingsSummary(draft.startingSettings, locale, input.settingsCatalogs ?? null)
    : `> ${localizer(locale, "commands.setup.wizard.settings_pending")}`;
  const settingsButtonLabel = localizer(
    locale,
    settingsComplete ? "commands.setup.wizard.settings_button_edit" : "commands.setup.wizard.settings_button_start",
  );

  components.push({
    type: ComponentType.TextDisplay,
    content: `### ${settingsStatus} ${localizer(locale, "commands.setup.wizard.settings_name")}\n${localizer(locale, "commands.setup.wizard.settings_description")}\n${settingsSummary}`,
  });

  components.push({
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: buildSetupSettingsRouteId({ locale, nonce }),
        label: settingsButtonLabel,
        disabled: false,
      },
    ],
  });

  components.push({ type: ComponentType.Separator, divider: true, spacing: 1 });
  components.push({
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: buildSetupFinishRouteId({ locale, nonce }),
        label: localizer(locale, "commands.setup.wizard.finish_label"),
        disabled: !isComplete,
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        customId: buildSetupCancelRouteId({ locale, nonce }),
        label: localizer(locale, "commands.setup.wizard.cancel_label"),
        disabled: false,
      },
    ],
  });

  const panelTone = isComplete ? "success" : "error";

  return validateAndFallbackPanelPayload(
    {
      components: [
        buildPanelContainer(components, panelTone),
        ...(receipt ? [buildPanelReceiptContainer(receipt)] : []),
      ],
      attachments: [],
      flags: MessageFlags.IsComponentsV2,
    },
    locale,
  );
}

export function buildSetupCancelledPayload(locale: string): ComponentsV2MessagePayload & { attachments: readonly [] } {
  return validateAndFallbackPanelPayload(
    {
      components: buildNoticeContainer({
        locale,
        color: ColorCode.INFO,
        titleKey: "commands.setup.wizard.cancelled_title",
        descriptionKey: "commands.setup.wizard.cancelled_description",
      }),
      attachments: [],
      flags: MessageFlags.IsComponentsV2,
    },
    locale,
  );
}

export function setupNoticeReceipt(locale: string, notice: "commit-failed" | "expired" | "in-flight"): PanelReceipt {
  switch (notice) {
    case "commit-failed":
      return {
        tone: "error",
        heading: localizer(locale, "commands.setup.wizard.commit_failed_title"),
        detail: localizer(locale, "commands.setup.wizard.commit_failed_description"),
        reason: "setup_commit_failed",
      };
    case "expired":
      return {
        tone: "warning",
        heading: localizer(locale, "commands.setup.wizard.session_ended_title"),
        detail: localizer(locale, "commands.setup.wizard.session_ended_description"),
        reason: "setup_session_expired",
      };
    case "in-flight":
      return {
        tone: "info",
        heading: localizer(locale, "commands.setup.wizard.commit_in_progress_title"),
        detail: localizer(locale, "commands.setup.wizard.commit_in_progress"),
        reason: "setup_commit_in_flight",
      };
  }
}

export function buildSetupCommitFailedPayload(
  locale: string,
): ComponentsV2MessagePayload & { attachments: readonly [] } {
  return validateAndFallbackPanelPayload(
    {
      components: buildNoticeContainer({
        locale,
        color: ColorCode.ERROR,
        titleKey: "commands.setup.wizard.commit_failed_title",
        descriptionKey: "commands.setup.wizard.commit_failed_description",
      }),
      attachments: [],
      flags: MessageFlags.IsComponentsV2,
    },
    locale,
  );
}

export function buildSetupInFlightPayload(locale: string): ComponentsV2MessagePayload & { attachments: readonly [] } {
  return validateAndFallbackPanelPayload(
    {
      components: buildNoticeContainer({
        locale,
        color: ColorCode.INFO,
        titleKey: "commands.setup.wizard.commit_in_progress_title",
        descriptionKey: "commands.setup.wizard.commit_in_progress",
      }),
      attachments: [],
      flags: MessageFlags.IsComponentsV2,
    },
    locale,
  );
}

interface SetupReceiptNote {
  label: string;
  detail: string;
}

interface SetupReceiptInput {
  locale: string;
  context: SetupDraftContext;
  providerAccess: SetupDraftProviderAccess;
  modelName: string | null;
  providerLabel: string;
  personaName: string;
  notes: readonly SetupReceiptNote[];
  learnMore: string;
  footerKeys?: readonly string[];
  optionReceiptDescriptionKey?: string;
}

function resolveReceiptDescriptionKey(input: SetupReceiptInput): string {
  const isDm = input.context === "dm";
  const { providerAccess } = input;

  if (providerAccess.mode === "option") {
    return input.optionReceiptDescriptionKey ?? "commands.setup.wizard.provider_invalid";
  }
  if (providerAccess.mode === "user-byok") {
    return isDm ? "commands.setup.wizard.receipt_desc_byok_dm" : "commands.setup.wizard.receipt_desc_byok";
  }
  if (providerAccess.mode === "custom-endpoint") {
    return isDm
      ? "commands.setup.wizard.receipt_desc_custom_endpoint_dm"
      : "commands.setup.wizard.receipt_desc_custom_endpoint";
  }
  if (!input.modelName) {
    return isDm ? "commands.setup.wizard.receipt_desc_dm" : "commands.setup.wizard.receipt_desc";
  }
  return isDm ? "commands.setup.wizard.receipt_desc_dm_with_model" : "commands.setup.wizard.receipt_desc_with_model";
}

// Discord forbids adding legacy embeds to an existing Components V2 message, so the terminal receipt flattens into V2
// TextDisplay components.
export function buildSetupSuccessPayload(
  input: SetupReceiptInput,
): ComponentsV2MessagePayload & { attachments: readonly [] } {
  const { locale } = input;
  const components: ComponentInContainerData[] = [];

  components.push({
    type: ComponentType.TextDisplay,
    content: `### ${localizer(locale, "commands.setup.wizard.receipt_title")}`,
  });

  components.push({
    type: ComponentType.TextDisplay,
    content: localizer(locale, resolveReceiptDescriptionKey(input), {
      model_name: input.modelName ?? "",
      provider: input.providerLabel,
      endpoint: input.providerLabel,
      persona: input.personaName,
    }),
  });

  if (input.context === "dm") {
    components.push({
      type: ComponentType.TextDisplay,
      content: `**${localizer(locale, "commands.setup.dm_context_explanation_title")}**\n${localizer(locale, "commands.setup.dm_context_explanation")}`,
    });
  }

  components.push({
    type: ComponentType.TextDisplay,
    content: `**${localizer(locale, "commands.setup.next_steps_title")}**\n${localizer(
      locale,
      input.context === "dm"
        ? "commands.setup.wizard.receipt_next_steps_dm"
        : "commands.setup.wizard.receipt_next_steps",
    )}`,
  });

  components.push({
    type: ComponentType.TextDisplay,
    content: `**${localizer(locale, "commands.setup.learn_more_title")}**\n${input.learnMore}`,
  });

  if (input.notes.length > 0) {
    components.push({ type: ComponentType.Separator, divider: true, spacing: 1 });
    components.push({
      type: ComponentType.TextDisplay,
      content: `**${localizer(locale, "commands.setup.heads_up_title")}**\n${input.notes
        .map((note) => `- **${note.label}**\n  - ${note.detail}`)
        .join("\n")}`,
    });
  }

  if (input.footerKeys?.length) {
    components.push({ type: ComponentType.Separator, divider: true, spacing: 1 });
    components.push({
      type: ComponentType.TextDisplay,
      content: withLinePrefix("-# ", input.footerKeys.map((key) => localizer(locale, key)).join("\n")),
    });
  }

  return validateAndFallbackPanelPayload(
    {
      components: [buildPanelContainer(components, "success")],
      attachments: [],
      flags: MessageFlags.IsComponentsV2,
    },
    locale,
  );
}

export function buildSetupExpiredPayload(locale: string): ComponentsV2MessagePayload & { attachments: readonly [] } {
  return validateAndFallbackPanelPayload(
    {
      components: buildNoticeContainer({
        locale,
        color: ColorCode.WARN,
        titleKey: "commands.setup.wizard.session_ended_title",
        descriptionKey: "commands.setup.wizard.session_ended_description",
      }),
      attachments: [],
      flags: MessageFlags.IsComponentsV2,
    },
    locale,
  );
}

export type SetupCatalogModalField = "provider" | "api-key";

export function buildSetupCatalogModalFieldId(field: SetupCatalogModalField, nonce: string): string {
  return `${field}_${nonce}`;
}

export function getSetupCatalogProviderChoices(): Array<{ name: string; value: string }> {
  return getAllProviderChoices().filter((provider) => provider.value !== "custom");
}

export function buildSetupCatalogModal(
  locale: string,
  nonce: string,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  const curatedOptions = getSetupCatalogProviderChoices().map((provider) => {
    const descriptionKey = getProviderAddChoiceDescriptionKey(provider.value);
    return {
      label: safeSelectOptionText(provider.name, 100),
      value: provider.value,
      description: descriptionKey ? safeSelectOptionText(localizer(locale, descriptionKey), 100) : undefined,
    };
  });

  return {
    custom_id: buildSetupProviderCatalogSubmitRouteId({ locale, nonce }),
    title: safeSelectOptionText(localizer(locale, "commands.setup.wizard.catalog_modal_title"), 45),
    components: [
      {
        type: 10,
        content: localizer(locale, "commands.setup.wizard.catalog_api_key_help", {
          help: commandRegistry.getCommandMention("help"),
        }),
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.catalog_provider_label"), 45),
        description: safeSelectOptionText(localizer(locale, "commands.setup.wizard.catalog_provider_description"), 100),
        component: {
          type: 3,
          custom_id: buildSetupCatalogModalFieldId("provider", nonce),
          required: true,
          options: curatedOptions,
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.catalog_api_key_label"), 45),
        description: safeSelectOptionText(localizer(locale, "commands.setup.wizard.catalog_api_key_description"), 100),
        component: {
          type: 4,
          custom_id: buildSetupCatalogModalFieldId("api-key", nonce),
          style: TextInputStyle.Short,
          placeholder: safeSelectOptionText(
            localizer(locale, "commands.setup.wizard.catalog_api_key_placeholder"),
            100,
          ),
          min_length: 10,
          max_length: 500,
          required: true,
        },
      },
    ],
  };
}

export const SETUP_ENDPOINT_API_STYLES = [
  "openai-compatible",
  "ollama-native",
] as const satisfies readonly CustomEndpointApiStyle[];

export type SetupEndpointConnectionModalField = "api-style" | "label" | "url" | "auth-token";

export function buildSetupEndpointConnectionModalFieldId(
  field: SetupEndpointConnectionModalField,
  nonce: string,
): string {
  return `${field}_${nonce}`;
}

export function buildSetupEndpointConnectionModal(
  locale: string,
  nonce: string,
  existing?: SetupDraftEndpointConnection | null,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  return {
    custom_id: buildSetupEndpointConnectionSubmitRouteId({ locale, nonce }),
    title: safeSelectOptionText(localizer(locale, "commands.setup.wizard.custom_endpoint_connection_modal_title"), 45),
    components: [
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.custom_endpoint_api_style_label"), 45),
        description: safeSelectOptionText(
          localizer(locale, "commands.setup.wizard.custom_endpoint_api_style_description"),
          100,
        ),
        component: {
          type: 3,
          custom_id: buildSetupEndpointConnectionModalFieldId("api-style", nonce),
          required: true,
          options: SETUP_ENDPOINT_API_STYLES.map((style) => ({
            label: safeSelectOptionText(localizer(locale, SETUP_ENDPOINT_STYLE_KEYS[style].label), 100),
            value: style,
            description: safeSelectOptionText(localizer(locale, SETUP_ENDPOINT_STYLE_KEYS[style].description), 100),
            default: existing?.apiStyle === style,
          })),
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.custom_endpoint_label_label"), 45),
        description: safeSelectOptionText(
          localizer(locale, "commands.setup.wizard.custom_endpoint_label_description"),
          100,
        ),
        component: {
          type: 4,
          custom_id: buildSetupEndpointConnectionModalFieldId("label", nonce),
          style: TextInputStyle.Short,
          placeholder: safeSelectOptionText(
            localizer(locale, "commands.setup.wizard.custom_endpoint_label_placeholder"),
            100,
          ),
          max_length: 40,
          required: true,
          value: existing?.label,
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.custom_endpoint_url_label"), 45),
        description: safeSelectOptionText(
          localizer(locale, "commands.setup.wizard.custom_endpoint_url_description"),
          100,
        ),
        component: {
          type: 4,
          custom_id: buildSetupEndpointConnectionModalFieldId("url", nonce),
          style: TextInputStyle.Short,
          placeholder: safeSelectOptionText(
            localizer(locale, "commands.setup.wizard.custom_endpoint_url_placeholder"),
            100,
          ),
          max_length: 500,
          required: true,
          value: existing?.endpointUrl,
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.custom_endpoint_auth_token_label"), 45),
        description: safeSelectOptionText(
          localizer(locale, "commands.setup.wizard.custom_endpoint_auth_token_description"),
          100,
        ),
        component: {
          type: 4,
          custom_id: buildSetupEndpointConnectionModalFieldId("auth-token", nonce),
          style: TextInputStyle.Short,
          placeholder: safeSelectOptionText(
            localizer(locale, "commands.setup.wizard.custom_endpoint_auth_token_placeholder"),
            100,
          ),
          max_length: 500,
          required: false,
        },
      },
    ],
  };
}

export const SETUP_ENDPOINT_TEXT_CAPABILITIES = [
  "tools",
  "vision",
  "structured_output",
  "json",
  "strict_role_alternation",
  "prefix_completion",
  "assistant_prefill",
  "verbatim_tool_calling",
] as const satisfies readonly SetupCustomEndpointCapability[];

export type SetupEndpointModelModalField = "model-code" | "num-ctx" | "capabilities";

export function buildSetupEndpointModelModalFieldId(field: SetupEndpointModelModalField, nonce: string): string {
  return `${field}_${nonce}`;
}

export function buildSetupEndpointModelModal(
  locale: string,
  nonce: string,
  existing?: SetupDraftEndpointModel | null,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  return {
    custom_id: buildSetupEndpointModelSubmitRouteId({ locale, nonce }),
    title: safeSelectOptionText(localizer(locale, "commands.setup.wizard.custom_endpoint_model_modal_title"), 45),
    components: [
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.custom_endpoint_model_code_label"), 45),
        description: safeSelectOptionText(
          localizer(locale, "commands.setup.wizard.custom_endpoint_model_code_description"),
          100,
        ),
        component: {
          type: 4,
          custom_id: buildSetupEndpointModelModalFieldId("model-code", nonce),
          style: TextInputStyle.Short,
          placeholder: safeSelectOptionText(
            localizer(locale, "commands.setup.wizard.custom_endpoint_model_code_placeholder"),
            100,
          ),
          max_length: 200,
          required: true,
          value: existing?.modelCode,
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.custom_endpoint_num_ctx_label"), 45),
        description: safeSelectOptionText(
          localizer(locale, "commands.setup.wizard.custom_endpoint_num_ctx_description"),
          100,
        ),
        component: {
          type: 4,
          custom_id: buildSetupEndpointModelModalFieldId("num-ctx", nonce),
          style: TextInputStyle.Short,
          placeholder: safeSelectOptionText(
            localizer(locale, "commands.setup.wizard.custom_endpoint_num_ctx_placeholder"),
            100,
          ),
          max_length: 20,
          required: false,
          value: existing?.numCtx != null ? String(existing.numCtx) : undefined,
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.custom_endpoint_capabilities_label"), 45),
        description: safeSelectOptionText(
          localizer(locale, "commands.setup.wizard.custom_endpoint_capabilities_description"),
          100,
        ),
        component: {
          type: 22,
          custom_id: buildSetupEndpointModelModalFieldId("capabilities", nonce),
          min_values: 0,
          max_values: SETUP_ENDPOINT_TEXT_CAPABILITIES.length,
          required: false,
          options: SETUP_ENDPOINT_TEXT_CAPABILITIES.map((cap) => ({
            value: cap,
            label: safeSelectOptionText(localizer(locale, SETUP_ENDPOINT_CAPABILITY_KEYS[cap].label), 100),
            description: safeSelectOptionText(localizer(locale, SETUP_ENDPOINT_CAPABILITY_KEYS[cap].description), 100),
            default: existing?.capabilities.includes(cap) ?? false,
          })),
        },
      },
    ],
  };
}

export type SetupByokModalField = "confirm";

export function buildSetupByokModalFieldId(field: SetupByokModalField, nonce: string): string {
  return `${field}_${nonce}`;
}

export function buildSetupByokModal(
  locale: string,
  nonce: string,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  return {
    custom_id: buildSetupProviderByokSubmitRouteId({ locale, nonce }),
    title: safeSelectOptionText(localizer(locale, "commands.setup.wizard.byok_modal_title"), 45),
    components: [
      {
        type: 10,
        content: statusNote(
          "warning",
          localizer(locale, "commands.setup.wizard.byok_modal_notice", {
            command: commandRegistry.getCommandMention("personal", "providers"),
          }),
        ),
      },
      {
        // Wrap inside Label (18) because interactionCore only captures modal selections nested under type 18.
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.byok_confirm_label"), 45),
        component: {
          // 21 is RadioGroup, whose submitted value lands in the modal select-value store.
          type: 21,
          custom_id: buildSetupByokModalFieldId("confirm", nonce),
          required: true,
          min_values: 1,
          max_values: 1,
          options: [
            {
              label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.byok_confirm_yes"), 100),
              value: "yes",
            },
            {
              label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.byok_confirm_no"), 100),
              value: "no",
            },
          ],
        },
      },
    ],
  };
}

export type SetupSettingsModalField = "persona" | "humanizer" | "timezone" | "system-prompt" | "features";

export function buildSetupSettingsModalFieldId(field: SetupSettingsModalField, nonce: string): string {
  return `${field}_${nonce}`;
}

// Reserved sentinel identity that writes NULL at commit rather than catalog text, so no catalog preset may share this
// exact name without colliding.
export const SETUP_SYSTEM_PROMPT_BUILT_IN = "built-in-default";

export function parseSetupSystemPromptChoice(value: string | undefined): SetupDraftSystemPrompt | null {
  if (!value) return null;
  if (value === SETUP_SYSTEM_PROMPT_BUILT_IN) return { kind: "built-in" };
  return { kind: "preset", presetName: value };
}

// Bounds check stays strict because an off-enum number would reach the repository as a degree the reply pipeline does
// not implement.
export function parseSetupHumanizerChoice(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= Object.keys(HUMANIZER_KEYS).length) return null;
  return parsed;
}

export function parseSetupTimezoneOffset(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return 0;
  return parseUtcOffsetInput(trimmed);
}

export function buildSetupSettingsModal(
  locale: string,
  nonce: string,
  catalogs: SetupSettingsCatalogs,
  existing?: SetupDraftStartingSettings | null,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  const modalNonce = Date.now().toString(36);
  const humanizerOptions = Object.values(HUMANIZER_KEYS).map((keys, index) => ({
    label: safeSelectOptionText(localizer(locale, keys.label), 100),
    value: String(index),
    description: safeSelectOptionText(localizer(locale, keys.description), 100),
    default: existing?.humanizer === index,
  }));

  // Selects reopen on placeholders by contract, so `default` flags remain hints while only text inputs pre-fill.
  const timezoneValue = existing ? formatUtcOffsetInput(existing.timezoneOffset) : undefined;
  const storedPrompt = existing?.systemPrompt;

  return {
    custom_id: buildSetupSettingsSubmitRouteId({ locale, nonce, modalNonce }),
    title: safeSelectOptionText(localizer(locale, "commands.setup.wizard.settings_modal_title"), 45),
    components: [
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.settings_persona_label"), 45),
        description: safeSelectOptionText(localizer(locale, "commands.setup.wizard.settings_persona_description"), 100),
        component: {
          type: 3,
          custom_id: buildSetupSettingsModalFieldId("persona", nonce),
          required: true,
          placeholder: safeSelectOptionText(
            localizer(locale, "commands.setup.wizard.settings_persona_placeholder"),
            100,
          ),
          options: catalogs.personas.map((persona) => ({
            label: safeSelectOptionText(persona.name, 100),
            value: String(persona.id),
            description: safeSelectOptionText(persona.description, 100),
            default: existing?.presetId === persona.id,
          })),
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.settings_humanizer_label"), 45),
        description: safeSelectOptionText(
          localizer(locale, "commands.setup.wizard.settings_humanizer_description"),
          100,
        ),
        component: {
          type: 3,
          custom_id: buildSetupSettingsModalFieldId("humanizer", nonce),
          required: true,
          placeholder: safeSelectOptionText(
            localizer(locale, "commands.setup.wizard.settings_humanizer_placeholder"),
            100,
          ),
          options: humanizerOptions,
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.settings_timezone_label"), 45),
        description: safeSelectOptionText(
          localizer(locale, "commands.setup.wizard.settings_timezone_description"),
          100,
        ),
        component: {
          type: 4,
          custom_id: buildSetupSettingsModalFieldId("timezone", nonce),
          style: TextInputStyle.Short,
          placeholder: safeSelectOptionText(
            localizer(locale, "commands.setup.wizard.settings_timezone_placeholder"),
            100,
          ),
          max_length: 20,
          required: false,
          value: timezoneValue,
        },
      },
      {
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.settings_system_prompt_label"), 45),
        description: safeSelectOptionText(
          localizer(locale, "commands.setup.wizard.settings_system_prompt_description"),
          100,
        ),
        component: {
          // The built-in default is not a catalog row, so it is offered as a synthetic first option
          // and stored as a sentinel rather than as a copy of the read-time default text.
          type: 3,
          custom_id: buildSetupSettingsModalFieldId("system-prompt", nonce),
          required: true,
          placeholder: safeSelectOptionText(
            localizer(locale, "commands.setup.wizard.settings_system_prompt_placeholder"),
            100,
          ),
          options: [
            {
              label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.settings_built_in_prompt"), 100),
              value: SETUP_SYSTEM_PROMPT_BUILT_IN,
              description: safeSelectOptionText(
                localizer(locale, "commands.setup.wizard.settings_built_in_prompt_description"),
                100,
              ),
              default: storedPrompt?.kind === "built-in",
            },
            ...catalogs.prompts.map((prompt) => ({
              label: safeSelectOptionText(prompt.displayName, 100),
              value: safeSelectOptionText(prompt.name, 100),
              description: safeSelectOptionText(prompt.description, 100),
              default: storedPrompt?.kind === "preset" && storedPrompt.presetName === prompt.name,
            })),
          ],
        },
      },
      {
        type: 18,
        label: localizer(locale, "commands.setup.wizard.settings_features_label"),
        description: localizer(locale, "commands.setup.wizard.settings_features_description"),
        component: {
          type: 22,
          custom_id: buildSetupSettingsModalFieldId("features", modalNonce),
          required: false,
          min_values: 0,
          max_values: SETUP_FEATURES.length,
          options: SETUP_FEATURES.map((feature) => ({
            label: localizer(locale, SETUP_FEATURE_KEYS[feature].label),
            description: localizer(locale, SETUP_FEATURE_KEYS[feature].description),
            value: feature,
            default: existing ? existing.features.includes(feature) : feature !== "short_term_memory",
          })),
        },
      },
    ],
  };
}

export type SetupPoliciesModalField = "acceptance";

export const SETUP_POLICY_CHOICE_VALUES = ["tos", "privacy", "members"] as const;

export function buildSetupPoliciesModalFieldId(field: SetupPoliciesModalField, nonce: string): string {
  return `${field}_${nonce}`;
}

export function buildSetupPoliciesModal(
  locale: string,
  nonce: string,
): { custom_id: string; title: string; components: RawDiscordComponent[] } {
  const acceptance = localizer(locale, "commands.setup.wizard.policies_modal_acceptance", {
    terms_url: buildLegalDocUrl(locale, "terms-of-service"),
    privacy_url: buildLegalDocUrl(locale, "privacy-policy"),
  });

  return {
    custom_id: buildSetupPoliciesSubmitRouteId({ locale, nonce }),
    title: safeSelectOptionText(localizer(locale, "commands.setup.wizard.policies_modal_title"), 45),
    components: [
      {
        type: 10,
        content: `${localizer(locale, "commands.setup.wizard.policies_modal_context")}\n\n${acceptance}`,
      },
      {
        // Keep CheckboxGroup inside a type-18 Label so the raw packet walk records selections instead of empty.
        type: 18,
        label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.policies_modal_choice_label"), 45),
        component: {
          // 22 is CheckboxGroup.
          type: 22,
          custom_id: buildSetupPoliciesModalFieldId("acceptance", nonce),
          min_values: SETUP_POLICY_CHOICE_VALUES.length,
          max_values: SETUP_POLICY_CHOICE_VALUES.length,
          required: true,
          options: [
            {
              label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.policies_choice_terms"), 100),
              value: "tos",
            },
            {
              label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.policies_choice_privacy"), 100),
              value: "privacy",
            },
            {
              label: safeSelectOptionText(localizer(locale, "commands.setup.wizard.policies_choice_members"), 100),
              value: "members",
            },
          ],
        },
      },
    ],
  };
}
