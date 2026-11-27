import { withProviderOptionCopy } from "@/utils/provider/providerOptionRegistry";
import {
  MessageFlags,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type Client,
  type ComponentInContainerData,
  type Guild,
} from "discord.js";
import {
  SETUP_DRAFT_SCHEMA_VERSION,
  isSetupDraftComplete,
  type SetupDraftContext,
  type SetupDraftProviderAccess,
  type SetupDraftRecord,
} from "@/types/discord/setupWizard";
import type { PanelReceipt } from "@/types/discord/panel";
import { rejectedKeyStatus } from "@/utils/provider/providerPanelOperations";
import { setGuildBotAvatar } from "@/utils/discord/guildIdentity";
import {
  claimSetupDraft,
  consumeSetupDraft,
  readSetupDraft,
  releaseSetupDraftClaim,
  storeSetupDraft,
  updateSetupDraft,
  type SetupDraftReadResult,
} from "@/utils/discord/interactions/setupDraftStore";
import {
  findProviderOption,
  getProviderOptions,
  providerOptionActionOption,
} from "@/utils/provider/providerOptionRegistry";
import {
  buildInteractionRouteId,
  parseInteractionRoute,
  type GlobalInteractionRoute,
  type GlobalRoutableInteraction,
  type ParsedInteractionRoute,
} from "@/utils/discord/interactions/routeRegistry";
import {
  SETUP_ENDPOINT_API_STYLES,
  SETUP_POLICY_CHOICE_VALUES,
  buildSetupByokModal,
  buildSetupByokModalFieldId,
  buildSetupCancelledPayload,
  buildSetupCatalogModal,
  buildSetupCatalogModalFieldId,
  buildSetupCommitFailedPayload,
  buildSetupEndpointConnectionModal,
  buildSetupEndpointConnectionModalFieldId,
  buildSetupEndpointModelModal,
  buildSetupEndpointModelModalFieldId,
  buildSetupExpiredPayload,
  buildSetupInFlightPayload,
  buildSetupPoliciesModal,
  buildSetupPoliciesModalFieldId,
  buildSetupSettingsModal,
  buildSetupSettingsModalFieldId,
  buildSetupSuccessPayload,
  buildSetupWizardPayload,
  getSetupCatalogProviderChoices,
  areSetupSettingsCatalogsRenderable,
  isSetupStartingSettingsResolvable,
  parseSetupHumanizerChoice,
  parseSetupSystemPromptChoice,
  parseSetupTimezoneOffset,
  setupNoticeReceipt,
  toSetupSettingsCatalogs,
  type SetupProviderOptionSummary,
  type SetupSettingsCatalogs,
} from "@/utils/discord/ui/setupPanel";
import { deliverGuardedPanel } from "@/utils/discord/interactions/panelController";
import {
  acknowledgeModalSubmitForRefresh,
  showRoutedRawModal,
  takeRawModalCheckboxGroupValues,
  takeRawModalSelectValue,
} from "@/utils/discord/ui/modals";
import {
  setupCustomEndpointCapabilitySchema,
  setupFeaturesSchema,
  type CustomEndpointApiStyle,
  type SetupConfig,
  type SetupCustomEndpointCapability,
  type SetupProviderAccess,
  type TomoriPresetRow,
} from "@/types/db/schema";
import {
  normalizeCustomEndpointUrlForStorage,
  validateCustomEndpointReachability,
} from "@/utils/provider/customEndpointService";
import { ProviderFactory } from "@/utils/provider/providerFactory";
import { encryptApiKey } from "@/utils/security/crypto";
import { parseNonce } from "@/utils/discord/panelRouteCodec";
import { createNonce, parseLocale } from "@/utils/discord/panelRouteTokens";
import { isHostedPolicyEnvironment } from "@/utils/misc/hostedPolicy";
import { configRepository, llmModelRepo, personaRepository, serverRepository } from "@/utils/db/repositories";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { formatLlmDisplayLabel } from "@/utils/provider/modelDisplay";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { invalidateNaturalNudgeConfigCache } from "@/modules/natural-nudges/runtime/configCache";
import { getCachedPresetAvatar, getPresetAvatarBuffer } from "@/utils/image/avatarHelper";
import { lazySyncGuildEmojis } from "@/utils/cache/emojiLazySync";
import { lazySyncGuildStickers } from "@/utils/cache/stickerLazySync";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import { statusNote } from "@/utils/discord/ui/statusTitle";
import { localizer, getDefaultBotName } from "@/utils/text/localizer";
import { UTC_OFFSET_MAX, UTC_OFFSET_MIN } from "@/constants/utcOffset";
import { escapeDiscordMarkdown } from "@/utils/text/discordMarkdown";
import { recordPanelActionStat } from "@/utils/stats/panelActionMetrics";
import { log, ColorCode } from "@/utils/misc/logger";
import { replyInfoEmbed, replySummaryEmbed } from "@/utils/discord/interactionHelper";
import { buildPanelReceiptMessage, replyPanelReceipt } from "@/utils/discord/ui/panel";

function parseNumCtxField(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) || parsed < 512 ? null : parsed;
}

export const SETUP_ROUTE_NAMESPACE = "setup";
export const SETUP_ROUTE_VERSION = "v1";

type SetupHealthStatus = "ready" | "already-setup" | "broken";

export type SetupWizardAction =
  | "cancel"
  | "policies"
  | "policies-submit"
  | "settings"
  | "settings-submit"
  | "provider-mode"
  | "provider-catalog-submit"
  | "provider-byok-submit"
  | "endpoint-connection"
  | "endpoint-connection-submit"
  | "endpoint-model"
  | "endpoint-model-submit"
  | "option-action"
  | "finish";

const SETUP_WIZARD_ACTIONS = new Set<SetupWizardAction>([
  "cancel",
  "policies",
  "policies-submit",
  "settings",
  "settings-submit",
  "provider-mode",
  "provider-catalog-submit",
  "provider-byok-submit",
  "endpoint-connection",
  "endpoint-connection-submit",
  "endpoint-model",
  "endpoint-model-submit",
  "option-action",
  "finish",
]);

export interface SetupWizardRoute {
  action: SetupWizardAction;
  locale: string;
  nonce: string;
  modalNonce?: string;
}

function buildSetupRouteId(route: SetupWizardRoute): string {
  return buildInteractionRouteId(SETUP_ROUTE_NAMESPACE, SETUP_ROUTE_VERSION, route.action, route.locale, route.nonce);
}

export function parseSetupRoute(input: ParsedInteractionRoute | string): SetupWizardRoute | null {
  const parsed = typeof input === "string" ? parseInteractionRoute(input) : input;
  if (!parsed || parsed.namespace !== SETUP_ROUTE_NAMESPACE || parsed.version !== SETUP_ROUTE_VERSION) {
    return null;
  }
  const [action, rawLocale, rawNonce] = parsed.segments;
  if (!action || !rawLocale || !rawNonce) return null;
  if (!SETUP_WIZARD_ACTIONS.has(action as SetupWizardAction)) return null;

  const locale = parseLocale(rawLocale);
  if (!locale) return null;

  const nonce = parseNonce(rawNonce);
  if (!nonce) return null;

  if (action === "settings-submit") {
    const modalNonce = parseNonce(parsed.segments[3]);
    if (!modalNonce) return null;
    return { action, locale, nonce, modalNonce };
  }

  return { action: action as SetupWizardAction, locale, nonce };
}

export function buildSetupCancelRouteId(input: { locale: string; nonce: string }): string {
  return buildSetupRouteId({ action: "cancel", locale: input.locale, nonce: input.nonce });
}

export function buildSetupPoliciesRouteId(input: { locale: string; nonce: string }): string {
  return buildSetupRouteId({ action: "policies", locale: input.locale, nonce: input.nonce });
}

export function buildSetupPoliciesSubmitRouteId(input: { locale: string; nonce: string }): string {
  return buildSetupRouteId({ action: "policies-submit", locale: input.locale, nonce: input.nonce });
}

export function buildSetupSettingsRouteId(input: { locale: string; nonce: string }): string {
  return buildSetupRouteId({ action: "settings", locale: input.locale, nonce: input.nonce });
}

export function buildSetupSettingsSubmitRouteId(input: { locale: string; nonce: string; modalNonce?: string }): string {
  return buildInteractionRouteId(
    SETUP_ROUTE_NAMESPACE,
    SETUP_ROUTE_VERSION,
    "settings-submit",
    input.locale,
    input.nonce,
    input.modalNonce ?? createNonce(),
  );
}

export function buildSetupProviderModeRouteId(input: { locale: string; nonce: string }): string {
  return buildSetupRouteId({ action: "provider-mode", locale: input.locale, nonce: input.nonce });
}

export function buildSetupProviderCatalogSubmitRouteId(input: { locale: string; nonce: string }): string {
  return buildSetupRouteId({ action: "provider-catalog-submit", locale: input.locale, nonce: input.nonce });
}

export function buildSetupProviderByokSubmitRouteId(input: { locale: string; nonce: string }): string {
  return buildSetupRouteId({ action: "provider-byok-submit", locale: input.locale, nonce: input.nonce });
}

export function buildSetupEndpointConnectionRouteId(input: { locale: string; nonce: string }): string {
  return buildSetupRouteId({ action: "endpoint-connection", locale: input.locale, nonce: input.nonce });
}

export function buildSetupEndpointConnectionSubmitRouteId(input: { locale: string; nonce: string }): string {
  return buildSetupRouteId({ action: "endpoint-connection-submit", locale: input.locale, nonce: input.nonce });
}

export function buildSetupEndpointModelRouteId(input: { locale: string; nonce: string }): string {
  return buildSetupRouteId({ action: "endpoint-model", locale: input.locale, nonce: input.nonce });
}

export function buildSetupEndpointModelSubmitRouteId(input: { locale: string; nonce: string }): string {
  return buildSetupRouteId({ action: "endpoint-model-submit", locale: input.locale, nonce: input.nonce });
}

export function buildSetupOptionActionRouteId(input: { locale: string; nonce: string }): string {
  return buildSetupRouteId({ action: "option-action", locale: input.locale, nonce: input.nonce });
}

export function buildSetupFinishRouteId(input: { locale: string; nonce: string }): string {
  return buildSetupRouteId({ action: "finish", locale: input.locale, nonce: input.nonce });
}

function describeSetupSettingsRejection(rawTimezone: string | undefined, timezoneOffset: number | null): string {
  if (timezoneOffset === null) {
    const typedHours = Number.parseFloat(rawTimezone?.trim() ?? "");
    const isOutOfRange = typedHours < UTC_OFFSET_MIN || typedHours > UTC_OFFSET_MAX;
    return isOutOfRange
      ? "commands.setup.wizard.settings_timezone_out_of_range"
      : "commands.setup.wizard.settings_timezone_invalid";
  }
  return "commands.setup.wizard.settings_persona_stale";
}

// Main-persona checks bypass the cached reader because DB-failure fallback returns stale empty data and would
// misreport an existing workspace as `ready`.
async function readSetupHealth(workspaceKey: string): Promise<SetupHealthStatus> {
  const serverId = await serverRepository.loadServerIdByDiscId(workspaceKey);
  if (!serverId) return "ready";
  if (!(await personaRepository.hasMainPersona(serverId))) return "ready";
  return (await personaRepository.loadState(workspaceKey)) ? "already-setup" : "broken";
}

async function replyWorkspaceAlreadySetup(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
  workspaceKey: string,
): Promise<void> {
  const existingTomoriState = await personaRepository.loadState(workspaceKey);
  const providerAddMention = commandRegistry.getCommandMention("providers");
  const modelTextMention = commandRegistry.getCommandMention("config");
  const userByokToggleMention = commandRegistry.getCommandMention("moderation");
  const helpPersonalProviderMention = commandRegistry.getCommandMention("help");
  const currentModelValue =
    existingTomoriState?.config.llm_id && existingTomoriState.llm
      ? formatLlmDisplayLabel(
          existingTomoriState.llm,
          existingTomoriState.config.custom_model_name,
          existingTomoriState.config.other_model_codename,
        )
      : existingTomoriState?.config.user_byok_mode
        ? localizer(locale, "commands.choices.none_user_byok")
        : localizer(locale, "commands.choices.none");

  await replySummaryEmbed(interaction, locale, {
    titleKey: "commands.setup.already_setup_title",
    descriptionKey: "commands.setup.already_setup_summary_description",
    color: ColorCode.WARN,
    fields: [
      {
        nameKey: "commands.setup.current_provider_field",
        value: currentModelValue,
      },
      {
        nameKey: "commands.setup.current_byok_field",
        value: localizer(
          locale,
          existingTomoriState?.config.user_byok_mode
            ? "commands.setup.current_byok_enabled_value"
            : "commands.setup.current_byok_disabled_value",
          { toggle_command: userByokToggleMention },
        ),
      },
      {
        nameKey: "commands.setup.already_setup_next_steps_field",
        value: localizer(locale, "commands.setup.already_setup_next_steps_value", {
          provider_add_command: providerAddMention,
          model_text_command: modelTextMention,
          byok_toggle_command: userByokToggleMention,
          help_personal_provider: helpPersonalProviderMention,
        }),
      },
    ],
    flags: MessageFlags.Ephemeral,
  });
}

// Broken setup state refuses without clearing data because workspace alters may still be healthy when only the config
// row or its model reference is missing.
async function replyWorkspaceBroken(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  locale: string,
): Promise<void> {
  log.warn("[Setup] Workspace has a main persona row but state validation failed, surfacing repair guidance");
  await replyInfoEmbed(interaction, locale, {
    titleKey: "commands.setup.broken_state_title",
    descriptionKey: "commands.setup.broken_state_description",
    descriptionVars: {
      model_text_command: commandRegistry.getCommandMention("config"),
      provider_add_command: commandRegistry.getCommandMention("providers"),
    },
    color: ColorCode.ERROR,
    flags: MessageFlags.Ephemeral,
  });
}

// Sentinel `undefined` skips reads because no settings are stored yet, whereas `null` signals a failed catalog read
// rather than a missing row.
async function readSetupSettingsCatalogs(
  draft: SetupDraftRecord,
  locale: string,
): Promise<SetupSettingsCatalogs | null | undefined> {
  if (!draft.startingSettings) return undefined;
  return loadSetupSettingsCatalogs(locale);
}

async function loadSetupSettingsCatalogs(locale: string): Promise<SetupSettingsCatalogs | null> {
  const [personaPresets, promptPresets] = await Promise.all([
    configRepository.loadPresetRowsByLocale(locale, { nsfw: false }),
    configRepository.loadSystemPromptPresets(),
  ]);
  return toSetupSettingsCatalogs(personaPresets, promptPresets, locale);
}

async function deliverSetupWizard(
  interaction: ChatInputCommandInteraction | GlobalRoutableInteraction,
  draft: SetupDraftRecord,
  locale: string,
  nonce: string,
  options: {
    method: "update" | "editReply";
    notice?: string;
    receipt?: PanelReceipt;
    settingsCatalogs: SetupSettingsCatalogs | null | undefined;
  },
): Promise<void> {
  const optionRender = await resolveSetupProviderOptionRender(interaction, draft, locale, nonce);
  const payload = buildSetupWizardPayload({
    draft,
    locale,
    isHosted: draft.requiresPolicies,
    nonce,
    notice: options.notice,
    receipt: options.receipt,
    settingsCatalogs: options.settingsCatalogs,
    providerOptions: optionRender.options,
    optionComponents: optionRender.components,
    optionReady: optionRender.ready,
  });
  await deliverGuardedPanel(interaction, payload, { locale, method: options.method, receipt: options.receipt });
}

interface SetupProviderOptionRender {
  options: SetupProviderOptionSummary[];
  components: readonly ComponentInContainerData[];
  ready: boolean;
}

async function resolveSetupProviderOptionRender(
  interaction: ChatInputCommandInteraction | GlobalRoutableInteraction,
  draft: SetupDraftRecord,
  locale: string,
  nonce: string,
): Promise<SetupProviderOptionRender> {
  const render: SetupProviderOptionRender = { options: [], components: [], ready: false };
  const selected = draft.providerAccess?.mode === "option" ? findProviderOption(draft.providerAccess.value) : undefined;
  for (const option of getProviderOptions()) {
    const setup = option.setup;
    if (!setup || (setup.available && !setup.available({ context: draft.context }))) continue;
    render.options.push({
      value: option.value,
      labelKey: setup.optionLabelKey,
      descriptionKey: setup.optionDescriptionKey,
      summaryKey: setup.summaryKey,
    });
    if (option !== selected) continue;
    const context = { locale, draft, interaction, actionRouteId: buildSetupOptionActionRouteId({ locale, nonce }) };
    render.ready = setup.ready ? (await setup.ready(context)).ready : true;
    render.components = (await setup.components?.(context)) ?? [];
  }
  return render;
}

// Repaints must route through here or `deliverSetupWizard` instead of `buildSetupWizardPayload` directly so deleted
// persona or prompt rows are not shown as valid.
async function repaintSetupWizard(
  interaction: ChatInputCommandInteraction | GlobalRoutableInteraction,
  draft: SetupDraftRecord,
  locale: string,
  nonce: string,
  options: { method: "update" | "editReply"; notice?: string; receipt?: PanelReceipt },
): Promise<void> {
  await deliverSetupWizard(interaction, draft, locale, nonce, {
    ...options,
    settingsCatalogs: await readSetupSettingsCatalogs(draft, locale),
  });
}

function providerValidationFailureReceipt(locale: string): PanelReceipt {
  return {
    tone: "error",
    heading: localizer(locale, "commands.setup.wizard.provider_validation_failed_title"),
    detail: localizer(locale, "commands.setup.wizard.provider_validation_failed"),
    reason: "setup_provider_validation_failed",
  };
}

function providerNoBalanceReceipt(locale: string): PanelReceipt {
  return {
    tone: "error",
    heading: localizer(locale, "commands.setup.wizard.provider_validation_failed_title"),
    detail: localizer(locale, "commands.setup.wizard.provider_validation_no_balance"),
    reason: "setup_provider_validation_no_balance",
  };
}

async function withRegistrationFailureCopy(
  receipt: PanelReceipt,
  locale: string,
  actorDiscId: string,
): Promise<PanelReceipt> {
  const keys = await withProviderOptionCopy([], {
    surface: "registration_failed",
    managedProvider: null,
    userDiscId: actorDiscId,
    serverId: undefined,
    credentialScope: "server",
  });
  return keys.length
    ? {
        ...receipt,
        metadata: [receipt.metadata, ...keys.map((key) => localizer(locale, key))].filter(Boolean).join(" "),
      }
    : receipt;
}

function setupFailureReceipt(locale: string, detail: string): PanelReceipt {
  return {
    tone: "error",
    heading: localizer(locale, "commands.setup.wizard.change_failed_title"),
    detail,
    reason: "setup_step_failed",
  };
}

function setupInFlightReceipt(locale: string): PanelReceipt {
  return {
    tone: "info",
    heading: localizer(locale, "commands.setup.wizard.commit_in_progress_title"),
    detail: localizer(locale, "commands.setup.wizard.commit_in_progress"),
  };
}

function customEndpointFailureReceipt(locale: string, detail: string): PanelReceipt {
  return {
    tone: "error",
    heading: localizer(locale, "commands.setup.wizard.custom_endpoint_failed_title"),
    detail,
  };
}

function safeCustomEndpointProbeReason(
  reason: string,
  endpointUrl: string,
  authToken: string | undefined,
): string | null {
  const normalized = reason.replace(/\s+/g, " ").trim();
  if (!normalized || /(?:\b(?:\d{1,3}\.){3}\d{1,3}\b|\blocalhost\b)/i.test(normalized)) return null;

  let sanitized = normalized;
  if (authToken) sanitized = sanitized.split(authToken).join("[redacted]");
  try {
    const endpoint = new URL(endpointUrl);
    sanitized = sanitized.split(endpointUrl).join("[redacted endpoint]");
    sanitized = sanitized.split(endpoint.host).join("[redacted endpoint]");
    sanitized = sanitized.split(endpoint.hostname).join("[redacted endpoint]");
  } catch {
    return null;
  }

  return escapeDiscordMarkdown(sanitized.slice(0, 300));
}

function customEndpointProbeFailureReceipt(
  locale: string,
  probe: { reason: string; credentialsWithheld?: true },
  endpointUrl: string,
  authToken: string | undefined,
): PanelReceipt {
  if (probe.credentialsWithheld) {
    return customEndpointFailureReceipt(
      locale,
      localizer(locale, "commands.providers.endpoint_redirect_credentials_withheld"),
    );
  }
  const safeReason = safeCustomEndpointProbeReason(probe.reason, endpointUrl, authToken);
  return customEndpointFailureReceipt(
    locale,
    safeReason
      ? localizer(locale, "commands.setup.wizard.custom_endpoint_unreachable_detail", { reason: safeReason })
      : localizer(locale, "commands.setup.wizard.custom_endpoint_unreachable"),
  );
}

// Write results drive the reply instead of re-reading (which masks in-flight refusals), and every arm must respond
// because modal submits are already acknowledged.
async function applySetupDraftWrite(
  interaction: ChatInputCommandInteraction | GlobalRoutableInteraction,
  write: SetupDraftReadResult,
  locale: string,
  nonce: string,
  method: "update" | "editReply",
): Promise<void> {
  if (write.status === "in-flight") {
    await deliverGuardedPanel(interaction, buildSetupInFlightPayload(locale), {
      locale,
      method,
      receipt: setupNoticeReceipt(locale, "in-flight"),
    });
    return;
  }
  if (write.status === "missing") {
    await deliverGuardedPanel(interaction, buildSetupExpiredPayload(locale), {
      locale,
      method,
      receipt: setupNoticeReceipt(locale, "expired"),
    });
    return;
  }
  if (write.status === "ok") {
    await repaintSetupWizard(interaction, write.draft, locale, nonce, { method });
  }
}

// Drift scope `provider` or `settings` clears only that step, whereas `none` means the whole workspace or environment
// drifted, so the entire draft is consumed.
type SetupDriftScope = "provider" | "settings" | "none";

interface SetupRevalidation {
  notice: string;
  scope: SetupDriftScope;
}

function isCatalogProviderCurrent(access: SetupDraftProviderAccess): boolean {
  if (access.mode !== "catalog") return false;
  return getSetupCatalogProviderChoices().some((choice) => choice.value === access.provider);
}

// Sentinel `null` means still valid; commit must recheck all gates because catalog rows or workspace state can change
// after panel creation.
async function revalidateSetupCommit(draft: SetupDraftRecord, locale: string): Promise<SetupRevalidation | null> {
  if (isHostedPolicyEnvironment() !== draft.requiresPolicies) {
    return { notice: localizer(locale, "commands.setup.wizard.env_mismatch"), scope: "none" };
  }

  if ((await readSetupHealth(draft.workspaceKey)) !== "ready") {
    return { notice: localizer(locale, "commands.setup.already_setup_description"), scope: "none" };
  }

  const access = draft.providerAccess;
  if (!access) {
    return { notice: localizer(locale, "commands.setup.wizard.provider_invalid"), scope: "provider" };
  }
  if (access.mode === "user-byok" && draft.context === "dm") {
    return { notice: localizer(locale, "commands.setup.wizard.provider_byok_guild_only"), scope: "provider" };
  }
  if (access.mode === "option") {
    const setup = findProviderOption(access.value)?.setup;
    if (!setup || (setup.available && !setup.available({ context: draft.context }))) {
      return { notice: localizer(locale, "commands.setup.wizard.provider_invalid"), scope: "provider" };
    }
    if (setup.ready) {
      const readiness = await setup.ready({ locale, draft });
      if (!readiness.ready) {
        return {
          notice: localizer(locale, readiness.reasonKey ?? "commands.setup.wizard.provider_invalid"),
          scope: "provider",
        };
      }
    }
  }
  if (access.mode === "catalog") {
    if (!isCatalogProviderCurrent(access)) {
      return { notice: localizer(locale, "commands.setup.wizard.provider_invalid"), scope: "provider" };
    }
    if (!(await llmModelRepo.loadDefaultModel(access.provider))) {
      // The transaction falls back to the provider's first non-deprecated model, so a workspace with
      // no text model at all is the only unresolvable case, and it leaves nothing to reply with.
      return { notice: localizer(locale, "commands.setup.wizard.provider_invalid"), scope: "provider" };
    }
  }

  const settings = draft.startingSettings;
  if (!settings) {
    return { notice: localizer(locale, "commands.setup.wizard.settings_persona_stale"), scope: "settings" };
  }
  const catalogs = await loadSetupSettingsCatalogs(locale);
  if (!areSetupSettingsCatalogsRenderable(catalogs)) {
    return { notice: localizer(locale, "commands.setup.wizard.settings_unavailable"), scope: "settings" };
  }
  if (!isSetupStartingSettingsResolvable(settings, catalogs)) {
    return { notice: localizer(locale, "commands.setup.wizard.settings_persona_stale"), scope: "settings" };
  }

  return null;
}

function toSetupProviderAccess(access: SetupDraftProviderAccess): SetupProviderAccess {
  if (access.mode === "catalog") {
    return {
      mode: "catalog",
      provider: access.provider,
      encryptedApiKey: access.encryptedApiKey,
      keyVersion: access.keyVersion,
    };
  }
  if (access.mode === "user-byok") {
    return { mode: "user-byok" };
  }
  if (access.mode === "option") {
    return { mode: "option", value: access.value };
  }
  // A complete custom-endpoint draft always carries both halves: a connection-only draft never
  // passes the completeness gate that guards this path.
  return {
    mode: "custom-endpoint",
    connection: {
      label: access.connection?.label ?? "",
      apiStyle: access.connection?.apiStyle ?? "openai-compatible",
      endpointUrl: access.connection?.endpointUrl ?? "",
      encryptedAuthToken: access.connection?.encryptedAuthToken ?? null,
      keyVersion: access.connection?.keyVersion ?? 1,
    },
    textModel: {
      modelCode: access.textModel?.modelCode ?? "",
      numCtx: access.textModel?.numCtx ?? null,
      capabilities: access.textModel?.capabilities ?? [],
    },
  };
}

// Built-in default writes `null` so `DEFAULT_SYSTEM_PROMPT` evolves at read time, and presets are re-read from the
// catalog at commit to reflect edits.
function resolveSystemPromptText(draft: SetupDraftRecord, catalogs: SetupSettingsCatalogs): string | null {
  const prompt = draft.startingSettings?.systemPrompt;
  if (!prompt || prompt.kind === "built-in") return null;
  return catalogs.promptTexts.get(prompt.presetName) ?? null;
}

// Explicit permission check is needed because Discord serves interaction-token replies even when the bot lacks
// channel send permissions.
function canChatInSetupChannel(interaction: ChatInputCommandInteraction | GlobalRoutableInteraction): boolean {
  const sendFlag = interaction.channel?.isThread()
    ? PermissionsBitField.Flags.SendMessagesInThreads
    : PermissionsBitField.Flags.SendMessages;
  return interaction.appPermissions.has([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.ReadMessageHistory,
    sendFlag,
  ]);
}

function buildSetupReceiptNotes(
  locale: string,
  access: SetupDraftProviderAccess,
  context: SetupDraftContext,
  canChatHere: boolean,
) {
  const notes: Array<{ label: string; detail: string }> = [];

  if (context === "guild" && !canChatHere) {
    notes.push({
      label: statusNote("error", localizer(locale, "commands.setup.channel_access_warning_field")),
      detail: localizer(locale, "commands.setup.channel_access_warning_value"),
    });
  }

  if (access.mode === "catalog" && (access.provider === "zai" || access.provider === "zaicoding")) {
    notes.push({
      label: statusNote("warning", localizer(locale, "commands.setup.zai_tos_warning_field")),
      detail: localizer(locale, "commands.setup.zai_tos_warning_value"),
    });
  }

  if (access.mode === "user-byok") {
    notes.push({
      label: localizer(locale, "commands.setup.byok_bootstrap_field"),
      detail: localizer(locale, "commands.setup.byok_bootstrap_value", {
        toggle_command: commandRegistry.getCommandMention("moderation"),
        help_personal_provider: commandRegistry.getCommandMention("help"),
      }),
    });
  }

  if (context !== "dm") return notes;

  // A DM has no guild member record to update, and the receipt says so rather than showing a
  // success that quietly skipped the avatar.
  return notes;
}

async function syncGuildExpressionsAfterSetup(guild: Guild | null, workspaceKey: string): Promise<void> {
  if (!guild) return;
  try {
    const tomoriState = await personaRepository.loadState(workspaceKey);
    if (!tomoriState) {
      log.warn(`[Setup] Failed to load TomoriState after setup for guild ${workspaceKey}`);
      return;
    }
    log.info(`[Setup] Force syncing emojis/stickers for guild ${guild.name}`);
    await Promise.all([
      lazySyncGuildEmojis(guild, tomoriState.server_id, true),
      lazySyncGuildStickers(guild, tomoriState.server_id, true),
    ]);
    log.success(`[Setup] Successfully synced expressions for guild ${guild.name}`);
  } catch (syncError) {
    // Non-critical: expressions sync on the first message anyway.
    log.warn(`[Setup] Failed to sync expressions during setup (will sync on first message): ${syncError}`);
  }
}

async function applySetupPresetAvatar(
  guild: Guild | null,
  presetRow: TomoriPresetRow | null,
  presetId: number,
  presetName: string,
): Promise<"applied" | "failed" | "skipped"> {
  if (!guild) return "skipped";
  // Skip avatar sync if the preset vanished between validation and commit because no target row remains.
  if (!presetRow) return "skipped";
  try {
    const cachedAvatar = getCachedPresetAvatar(presetId);
    const presetAvatarBuffer = cachedAvatar ? null : await getPresetAvatarBuffer(presetRow);
    const avatarValue =
      cachedAvatar ?? (presetAvatarBuffer ? `data:image/png;base64,${presetAvatarBuffer.toString("base64")}` : null);

    const response = await setGuildBotAvatar(guild.id, avatarValue);

    if (!response.success) {
      return "failed";
    }

    log.info(
      `${avatarValue ? `Set preset avatar for "${presetName}"` : "Reset guild avatar to bot default"} for guild ${guild.id} during setup`,
    );
    // Stamp the applied avatar hash so the background fan-out reconciler skips this freshly-set-up
    // server until the catalog art changes again.
    await personaRepository.markServerMainAvatarSynced(guild.id);
    return "applied";
  } catch (avatarError) {
    log.warn(`Failed to update avatar during setup: ${avatarError}`);
    return "failed";
  }
}

// Non-critical steps report into the receipt without throwing, whereas the boolean return reflects receipt delivery
// so callers know if the wizard UI stayed live.
async function runSetupPostCommitEffects(input: {
  interaction: ChatInputCommandInteraction | GlobalRoutableInteraction;
  draft: SetupDraftRecord;
  locale: string;
  access: SetupDraftProviderAccess;
  presetId: number;
  presetName: string;
  presetRow: TomoriPresetRow | null;
  serverInternalId: number | null;
  modelName: string | null;
  providerLabel: string;
}): Promise<boolean> {
  const { draft, locale, access } = input;
  const guild = "guild" in input.interaction ? (input.interaction.guild ?? null) : null;

  if (draft.context === "guild") {
    await syncGuildExpressionsAfterSetup(guild, draft.workspaceKey);
  }

  const status = await applySetupPresetAvatar(guild, input.presetRow, input.presetId, input.presetName);
  const avatarUpdateFailed = status === "failed";

  const footerKey =
    draft.context === "dm"
      ? "commands.setup.wizard.receipt_footer_avatar_skipped_dm"
      : avatarUpdateFailed
        ? "commands.setup.wizard.receipt_footer_avatar_failed"
        : undefined;

  const payload = buildSetupSuccessPayload({
    locale,
    context: draft.context,
    providerAccess: access,
    modelName: input.modelName,
    providerLabel: input.providerLabel,
    personaName: input.presetName,
    notes: buildSetupReceiptNotes(locale, access, draft.context, canChatInSetupChannel(input.interaction)),
    learnMore: localizer(locale, "commands.setup.wizard.receipt_learn_more", {
      help: commandRegistry.getCommandMention("help"),
    }),
    footerKeys: footerKey ? [footerKey] : [],
    optionReceiptDescriptionKey:
      access.mode === "option" ? findProviderOption(access.value)?.setup?.receiptDescriptionKey : undefined,
  });

  try {
    await deliverGuardedPanel(input.interaction, payload, { locale, method: "editReply" });
  } catch (deliveryError) {
    // Return false because the setup already committed, so showing the open wizard would read as expired on retry.
    log.error("[Setup] Failed to deliver the success receipt for a committed setup:", deliveryError);
    return false;
  }

  if (input.serverInternalId) {
    // Emit one detached metric per completed setup so telemetry failures never convert a committed setup into an error.
    void recordPanelActionStat({
      action: "setup.workspace.setup.complete",
      serverId: input.serverInternalId,
      userDiscId: input.interaction.user.id,
    }).catch((error) => log.warn("[Setup] Failed to record the setup completion action", error));
  }

  return true;
}

type SetupCommitOutcome =
  | { status: "committed" }
  | { status: "in-flight" }
  | { status: "drift"; notice: string; scope: SetupDriftScope }
  | { status: "failed" };

// Strict sequence: defer within 3s before claiming, claim before awaits to block double commits, invalidate caches
// post-commit, and clear credentials in `finally`.
async function finishSetupWizardDraft(
  interaction: ChatInputCommandInteraction | GlobalRoutableInteraction,
  draft: SetupDraftRecord,
  locale: string,
  nonce: string,
): Promise<SetupCommitOutcome> {
  const { actorDiscId, workspaceKey, context } = draft;
  const acknowledged = "deferUpdate" in interaction && !interaction.replied && !interaction.deferred;
  if (acknowledged) {
    await interaction.deferUpdate();
  }

  const claim = claimSetupDraft(nonce, actorDiscId, workspaceKey, context);

  if (claim.status === "in-flight") {
    // Safe to repaint on in-flight because the wizard stays live until the first commit finishes and replaces it.
    await repaintSetupWizard(interaction, draft, locale, nonce, {
      method: "editReply",
      receipt: setupInFlightReceipt(locale),
    });
    return { status: "in-flight" };
  }

  if (claim.status !== "claimed") {
    // Answer missing claims explicitly because a silent return reads as a failed interaction when expired or raced.
    await deliverGuardedPanel(interaction, buildSetupExpiredPayload(locale), {
      locale,
      method: "editReply",
      receipt: setupNoticeReceipt(locale, "expired"),
    });
    return { status: "failed" };
  }

  const claimedDraft = claim.draft;
  // Survives try so catch can distinguish partial failures before DB commit from post-commit ones.
  let committed = false;
  // Drift refusals keep preserved=true because only correctable drift retains the draft across retries.
  let preserved = false;

  try {
    const drift = await revalidateSetupCommit(claimedDraft, locale);

    if (drift) {
      if (drift.scope === "none") {
        await deliverGuardedPanel(interaction, buildSetupExpiredPayload(locale), {
          locale,
          method: "editReply",
          receipt: setupNoticeReceipt(locale, "expired"),
        });
        return { status: "failed" };
      }

      releaseSetupDraftClaim(nonce, actorDiscId, workspaceKey, context);
      const cleared =
        drift.scope === "provider"
          ? updateSetupDraft(nonce, actorDiscId, workspaceKey, context, { providerAccess: null })
          : updateSetupDraft(nonce, actorDiscId, workspaceKey, context, { startingSettings: null });

      if (cleared.status === "ok") {
        await deliverSetupWizard(interaction, cleared.draft, locale, nonce, {
          method: "editReply",
          receipt: setupFailureReceipt(locale, drift.notice),
          settingsCatalogs: await readSetupSettingsCatalogs(cleared.draft, locale),
        });
        preserved = true;
        return { status: "drift", notice: drift.notice, scope: drift.scope };
      }

      await deliverGuardedPanel(interaction, buildSetupExpiredPayload(locale), {
        locale,
        method: "editReply",
        receipt: setupNoticeReceipt(locale, "expired"),
      });
      return { status: "failed" };
    }

    const access = claimedDraft.providerAccess;
    if (!access) {
      // Unreachable behind the completeness gate, and refusing here keeps the write path total rather
      // than asserting a shape the gate is the only thing that guarantees.
      releaseSetupDraftClaim(nonce, actorDiscId, workspaceKey, context);
      await repaintSetupWizard(interaction, claimedDraft, locale, nonce, {
        method: "editReply",
        receipt: setupFailureReceipt(locale, localizer(locale, "commands.setup.wizard.provider_invalid")),
      });
      preserved = true;
      return {
        status: "drift",
        notice: localizer(locale, "commands.setup.wizard.provider_invalid"),
        scope: "provider",
      };
    }

    const catalogs = await loadSetupSettingsCatalogs(locale);
    if (!areSetupSettingsCatalogsRenderable(catalogs)) {
      releaseSetupDraftClaim(nonce, actorDiscId, workspaceKey, context);
      await repaintSetupWizard(interaction, claimedDraft, locale, nonce, {
        method: "editReply",
        receipt: setupFailureReceipt(locale, localizer(locale, "commands.setup.wizard.settings_unavailable")),
      });
      preserved = true;
      return {
        status: "drift",
        notice: localizer(locale, "commands.setup.wizard.settings_unavailable"),
        scope: "settings",
      };
    }

    const startingSettings = claimedDraft.startingSettings;
    const presetId = startingSettings?.presetId;
    const presetRow =
      typeof presetId === "number"
        ? await configRepository
            .loadPresetRowsByLocale(locale, { nsfw: false })
            .then((rows) => rows?.find((row) => row.persona_preset_id === presetId) ?? null)
        : null;

    if (!presetRow || !startingSettings) {
      releaseSetupDraftClaim(nonce, actorDiscId, workspaceKey, context);
      const cleared = updateSetupDraft(nonce, actorDiscId, workspaceKey, context, { startingSettings: null });
      if (cleared.status === "ok") {
        await deliverSetupWizard(interaction, cleared.draft, locale, nonce, {
          method: "editReply",
          receipt: setupFailureReceipt(locale, localizer(locale, "commands.setup.wizard.settings_persona_stale")),
          settingsCatalogs: catalogs,
        });
      } else {
        await deliverGuardedPanel(interaction, buildSetupExpiredPayload(locale), {
          locale,
          method: "editReply",
          receipt: setupNoticeReceipt(locale, "expired"),
        });
      }
      preserved = true;
      return {
        status: "drift",
        notice: localizer(locale, "commands.setup.wizard.settings_persona_stale"),
        scope: "settings",
      };
    }

    const modelName =
      access.mode === "catalog"
        ? ((await llmModelRepo.loadDefaultModel(access.provider))?.llm_codename ?? null)
        : access.mode === "custom-endpoint"
          ? (access.textModel?.modelCode ?? null)
          : null;
    const providerLabel =
      access.mode === "catalog"
        ? getProviderDisplayName(access.provider)
        : access.mode === "custom-endpoint"
          ? (access.connection?.label ?? "")
          : "";

    const setupConfig: SetupConfig = {
      serverId: workspaceKey,
      presetId: presetRow.persona_preset_id,
      humanizer: startingSettings.humanizer,
      tomoriName: getDefaultBotName(locale),
      timezoneOffset: startingSettings.timezoneOffset,
      features: startingSettings.features,
      locale,
      registrationLocale: locale,
      providerAccess: toSetupProviderAccess(access),
      systemPrompt: resolveSystemPromptText(claimedDraft, catalogs),
    };

    let setupResult: Awaited<ReturnType<typeof serverRepository.setup>>;
    try {
      setupResult = await serverRepository.setup(context === "guild" ? (interaction.guild ?? null) : null, setupConfig);
    } catch (error) {
      log.error("[Setup] Setup transaction failed:", error);
      await deliverGuardedPanel(interaction, buildSetupCommitFailedPayload(locale), {
        locale,
        method: "editReply",
        receipt: setupNoticeReceipt(locale, "commit-failed"),
      });
      return { status: "failed" };
    }

    committed = true;
    // Only now, with the rows committed: every reader below this line must see the new workspace.
    invalidateTomoriStateCache(workspaceKey);
    if (setupResult.server.server_id) invalidateNaturalNudgeConfigCache(setupResult.server.server_id);
    if (access.mode === "option") {
      const option = findProviderOption(access.value);
      if (option?.setup?.committed) {
        const serverId = setupResult.server.server_id;
        if (!serverId) throw new Error("Setup did not return a server ID for a registered provider option");
        await option.setup.committed({
          locale,
          draft: claimedDraft,
          interaction,
          serverId,
          workspaceKey,
        });
      }
    }

    let receiptDelivered: boolean;
    try {
      receiptDelivered = await runSetupPostCommitEffects({
        interaction,
        draft: claimedDraft,
        locale,
        access,
        presetId: presetRow.persona_preset_id,
        presetName: presetRow.persona_preset_name,
        presetRow,
        serverInternalId: setupResult.server.server_id ?? null,
        modelName,
        providerLabel,
      });
    } catch (effectsError) {
      // Post-commit throw must never report an uncommitted error because the transaction already landed.
      log.error("[Setup] Post-commit effects failed after a committed setup:", effectsError);
      receiptDelivered = false;
    }

    if (!receiptDelivered) {
      // Still consumed on exit so retries start fresh while telling the user delivery could not confirm.
      try {
        await deliverGuardedPanel(interaction, buildSetupCommitFailedPayload(locale), {
          locale,
          method: "editReply",
          receipt: setupNoticeReceipt(locale, "commit-failed"),
        });
      } catch (noticeError) {
        log.error("[Setup] Failed to deliver the receipt-failure notice:", noticeError);
      }
      return { status: "failed" };
    }

    return { status: "committed" };
  } catch (error) {
    // Separate committed vs uncommitted error logs because only post-commit failures require manual DB cleanup.
    log.error(
      committed
        ? "[Setup] Commit path failed after the transaction committed; the workspace may already be configured:"
        : "[Setup] Setup commit path failed before any write landed:",
      error,
    );
    try {
      await deliverGuardedPanel(interaction, buildSetupCommitFailedPayload(locale), {
        locale,
        method: "editReply",
        receipt: setupNoticeReceipt(locale, "commit-failed"),
      });
    } catch (replyError) {
      log.error("[Setup] Failed to deliver the commit-failure notice:", replyError);
    }
    return { status: "failed" };
  } finally {
    // Always release the claim before consuming the draft so exceptions never strand an encrypted credential.
    releaseSetupDraftClaim(nonce, actorDiscId, workspaceKey, context);
    if (!preserved) {
      consumeSetupDraft(nonce, actorDiscId, workspaceKey, context);
    }
  }
}

export interface SetupWizardDependencies {
  isSetupAuthorized: (interaction: ChatInputCommandInteraction | ButtonInteraction) => boolean;
  checkExistingSetup: (workspaceKey: string) => Promise<SetupHealthStatus>;
  createNonce: () => string;
  isHostedPolicyEnvironment: () => boolean;
  storeSetupDraft: typeof storeSetupDraft;
  locale?: string;
}

export async function startSetupWizard(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  dependencies: Partial<SetupWizardDependencies> = {},
): Promise<void> {
  const locale = dependencies.locale ?? interaction.locale ?? interaction.guildLocale ?? "en-US";
  const workspaceKey = interaction.guildId ?? interaction.user.id;
  const context: SetupDraftContext = interaction.guildId ? "guild" : "dm";

  // Acknowledged before the existing-setup lookup, not after it: Discord drops an interaction that is not
  // acknowledged within three seconds, and that lookup can miss its cache and reach the database.
  if (!interaction.replied && !interaction.deferred) await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const isAuthorized = dependencies.isSetupAuthorized
    ? dependencies.isSetupAuthorized(interaction)
    : !interaction.guildId || (interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) ?? false);

  if (!isAuthorized) {
    await interaction.editReply(
      buildPanelReceiptMessage({
        tone: "error",
        heading: localizer(locale, "commands.config.panel.denied_heading"),
        detail: localizer(locale, "commands.setup.wizard.permission_denied"),
      }),
    );
    return;
  }

  const health = dependencies.checkExistingSetup
    ? await dependencies.checkExistingSetup(workspaceKey)
    : await readSetupHealth(workspaceKey);

  if (health === "already-setup") {
    await replyWorkspaceAlreadySetup(interaction, locale, workspaceKey);
    return;
  }

  if (health === "broken") {
    await replyWorkspaceBroken(interaction, locale);
    return;
  }

  const nonce = (dependencies.createNonce ?? createNonce)();
  const requiresPolicies = (dependencies.isHostedPolicyEnvironment ?? isHostedPolicyEnvironment)();
  const record: SetupDraftRecord = {
    schemaVersion: SETUP_DRAFT_SCHEMA_VERSION,
    actorDiscId: interaction.user.id,
    workspaceKey,
    context,
    providerAccess: null,
    startingSettings: null,
    policiesAccepted: false,
    requiresPolicies,
  };
  (dependencies.storeSetupDraft ?? storeSetupDraft)(nonce, record);

  await repaintSetupWizard(interaction, record, locale, nonce, { method: "editReply" });
}

export const setupInteractionRoute: GlobalInteractionRoute = {
  namespace: SETUP_ROUTE_NAMESPACE,
  version: SETUP_ROUTE_VERSION,
  async execute(_client: Client, interaction: GlobalRoutableInteraction, route: ParsedInteractionRoute): Promise<void> {
    const parsed = parseSetupRoute(route);
    if (!parsed) return;

    const { action, locale, nonce } = parsed;
    const actorDiscId = interaction.user.id;
    const workspaceKey = interaction.guildId ?? interaction.user.id;
    const context: SetupDraftContext = interaction.guildId ? "guild" : "dm";

    const readResult = readSetupDraft(nonce, actorDiscId, workspaceKey, context);
    if (readResult.status === "missing") {
      const expiredPayload = buildSetupExpiredPayload(locale);
      await deliverGuardedPanel(interaction, expiredPayload, {
        locale,
        method: "update",
        receipt: setupNoticeReceipt(locale, "expired"),
      });
      return;
    }

    if (readResult.status === "forbidden") {
      if (!interaction.replied && !interaction.deferred) {
        await replyPanelReceipt(interaction, {
          tone: "error",
          heading: localizer(locale, "commands.config.panel.denied_heading"),
          detail: localizer(locale, "commands.setup.wizard.forbidden"),
        });
      }
      return;
    }

    if (readResult.status === "in-flight") {
      // Refuse actions while committing because the draft is frozen and a repaint would show stale state.
      await deliverGuardedPanel(interaction, buildSetupInFlightPayload(locale), {
        locale,
        method: "update",
        receipt: setupNoticeReceipt(locale, "in-flight"),
      });
      return;
    }

    const draft = readResult.draft;

    if (context === "guild") {
      const isAuthorized = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) ?? false;
      if (!isAuthorized) {
        if (!interaction.replied && !interaction.deferred) {
          await replyPanelReceipt(interaction, {
            tone: "error",
            heading: localizer(locale, "commands.config.panel.denied_heading"),
            detail: localizer(locale, "commands.setup.wizard.permission_denied"),
          });
        }
        return;
      }
    }

    if (isHostedPolicyEnvironment() !== draft.requiresPolicies) {
      if (!interaction.replied && !interaction.deferred) {
        await replyPanelReceipt(interaction, {
          tone: "warning",
          heading: localizer(locale, "commands.config.panel.stale_heading"),
          detail: localizer(locale, "commands.setup.wizard.env_mismatch"),
        });
      }
      return;
    }

    switch (action) {
      case "cancel": {
        consumeSetupDraft(nonce, actorDiscId, workspaceKey, context);
        const cancelledPayload = buildSetupCancelledPayload(locale);
        await deliverGuardedPanel(interaction, cancelledPayload, { locale, method: "update" });
        break;
      }

      case "policies": {
        if (interaction.isModalSubmit()) {
          return;
        }
        // Reply to refuse forged policy clicks because unanswered component interactions fail in Discord.
        if (!draft.requiresPolicies) {
          if (!interaction.replied && !interaction.deferred) {
            await replyPanelReceipt(interaction, {
              tone: "warning",
              heading: localizer(locale, "general.panel_notice.not_available_heading"),
              detail: localizer(locale, "commands.setup.wizard.policies_denied"),
            });
          }
          return;
        }
        const modalPayload = buildSetupPoliciesModal(locale, nonce);
        await showRoutedRawModal(interaction, modalPayload);
        return;
      }

      case "policies-submit": {
        if (!interaction.isModalSubmit()) {
          return;
        }
        await acknowledgeModalSubmitForRefresh(interaction);

        if (!draft.requiresPolicies) {
          await repaintSetupWizard(interaction, draft, locale, nonce, {
            method: "editReply",
            receipt: setupFailureReceipt(locale, localizer(locale, "commands.setup.wizard.policies_denied")),
          });
          return;
        }

        const acceptanceFieldId = buildSetupPoliciesModalFieldId("acceptance", nonce);
        const acceptedChoices = takeRawModalCheckboxGroupValues(interaction.id, acceptanceFieldId) ?? [];

        // Both documents are required and nothing else is an acceptance, so the submitted set has
        // to match exactly rather than merely contain what the modal offered.
        const acceptedEveryDocument =
          acceptedChoices.length === SETUP_POLICY_CHOICE_VALUES.length &&
          SETUP_POLICY_CHOICE_VALUES.every((value) => acceptedChoices.includes(value));

        if (!acceptedEveryDocument) {
          await repaintSetupWizard(interaction, draft, locale, nonce, {
            method: "editReply",
            receipt: setupFailureReceipt(locale, localizer(locale, "commands.setup.wizard.policies_required")),
          });
          return;
        }

        const updated = updateSetupDraft(nonce, actorDiscId, workspaceKey, context, { policiesAccepted: true });
        // Repaint only if updated so expired drafts never show accepted; still answer to confirm modal submission.
        if (updated.status === "ok") {
          await repaintSetupWizard(interaction, updated.draft, locale, nonce, { method: "editReply" });
          return;
        }

        await deliverGuardedPanel(interaction, buildSetupExpiredPayload(locale), {
          locale,
          method: "editReply",
          receipt: setupNoticeReceipt(locale, "expired"),
        });
        return;
      }

      case "settings": {
        if (interaction.isModalSubmit()) {
          return;
        }
        const catalogs = await loadSetupSettingsCatalogs(locale);
        if (!areSetupSettingsCatalogsRenderable(catalogs)) {
          // The catalogs just read are the ones whose unrenderability is being reported, so they are
          // passed straight through rather than read a second time on this path.
          await deliverSetupWizard(interaction, draft, locale, nonce, {
            method: "update",
            receipt: setupFailureReceipt(locale, localizer(locale, "commands.setup.wizard.settings_unavailable")),
            settingsCatalogs: catalogs,
          });
          return;
        }
        const modalPayload = buildSetupSettingsModal(locale, nonce, catalogs, context, draft.startingSettings);
        await showRoutedRawModal(interaction, modalPayload);
        return;
      }

      case "settings-submit": {
        if (!interaction.isModalSubmit() || !parsed.modalNonce) {
          return;
        }
        await acknowledgeModalSubmitForRefresh(interaction);

        const catalogs = await loadSetupSettingsCatalogs(locale);
        if (!areSetupSettingsCatalogsRenderable(catalogs)) {
          await deliverSetupWizard(interaction, draft, locale, nonce, {
            method: "editReply",
            receipt: setupFailureReceipt(locale, localizer(locale, "commands.setup.wizard.settings_unavailable")),
            settingsCatalogs: catalogs,
          });
          return;
        }

        const selectedPersonaId = takeRawModalSelectValue(
          interaction.id,
          buildSetupSettingsModalFieldId("persona", nonce),
        );
        const selectedHumanizer = takeRawModalSelectValue(
          interaction.id,
          buildSetupSettingsModalFieldId("humanizer", nonce),
        );
        // Optional, so it is read defensively like every other optional text input in this file:
        // Discord omits an empty one from the submission and the lookup then throws.
        let rawTimezone: string | undefined;
        try {
          rawTimezone = interaction.fields.getTextInputValue(buildSetupSettingsModalFieldId("timezone", nonce));
        } catch {
          rawTimezone = undefined;
        }
        const selectedSystemPrompt = takeRawModalSelectValue(
          interaction.id,
          buildSetupSettingsModalFieldId("system-prompt", nonce),
        );
        const features = setupFeaturesSchema.safeParse(
          takeRawModalCheckboxGroupValues(
            interaction.id,
            buildSetupSettingsModalFieldId("features", parsed.modalNonce),
          ),
        );

        if (!features.success) {
          await repaintSetupWizard(interaction, draft, locale, nonce, {
            method: "editReply",
            receipt: setupFailureReceipt(locale, localizer(locale, "commands.setup.wizard.settings_features_invalid")),
          });
          return;
        }

        const presetId = Number.parseInt(selectedPersonaId ?? "", 10);
        const humanizer = parseSetupHumanizerChoice(selectedHumanizer);
        const timezoneOffset = parseSetupTimezoneOffset(rawTimezone);
        const systemPrompt = parseSetupSystemPromptChoice(selectedSystemPrompt);

        // A submission is rebuilt from the live catalogs rather than trusted: the row it names may
        // have been removed since the modal opened, and a blank timezone is enforced here too.
        const nextSettings =
          Number.isInteger(presetId) &&
          catalogs.personas.some((persona) => persona.id === presetId) &&
          humanizer !== null &&
          timezoneOffset !== null &&
          systemPrompt !== null
            ? { presetId, humanizer, timezoneOffset, systemPrompt, features: features.data }
            : null;

        if (!nextSettings || !isSetupStartingSettingsResolvable(nextSettings, catalogs)) {
          await repaintSetupWizard(interaction, draft, locale, nonce, {
            method: "editReply",
            receipt: setupFailureReceipt(
              locale,
              localizer(locale, describeSetupSettingsRejection(rawTimezone, timezoneOffset)),
            ),
          });
          return;
        }

        const updated = updateSetupDraft(nonce, actorDiscId, workspaceKey, context, {
          startingSettings: nextSettings,
        });
        if (updated.status === "ok") {
          await deliverSetupWizard(interaction, updated.draft, locale, nonce, {
            method: "editReply",
            settingsCatalogs: catalogs,
          });
          return;
        }

        await deliverGuardedPanel(interaction, buildSetupExpiredPayload(locale), {
          locale,
          method: "editReply",
          receipt: setupNoticeReceipt(locale, "expired"),
        });
        return;
      }

      case "provider-mode": {
        if (!interaction.isStringSelectMenu()) {
          return;
        }
        const selectedMode = interaction.values[0];
        const selectedOption = providerOptionActionOption(selectedMode);
        if (selectedOption) {
          const setup = selectedOption.setup;
          if (!setup || (setup.available && !setup.available({ context }))) {
            if (!interaction.replied && !interaction.deferred) {
              await replyPanelReceipt(interaction, {
                tone: "warning",
                heading: localizer(locale, "general.panel_notice.invalid_heading"),
                detail: localizer(locale, "commands.setup.wizard.provider_invalid"),
              });
            }
            return;
          }
          await interaction.deferUpdate();
          await applySetupDraftWrite(
            interaction,
            updateSetupDraft(nonce, actorDiscId, workspaceKey, context, {
              providerAccess: { mode: "option", value: selectedOption.value },
            }),
            locale,
            nonce,
            "editReply",
          );
          return;
        }
        if (selectedMode === "catalog") {
          const cleared = updateSetupDraft(nonce, actorDiscId, workspaceKey, context, { providerAccess: null });
          if (cleared.status !== "ok") {
            await applySetupDraftWrite(interaction, cleared, locale, nonce, "update");
            return;
          }
          const modalPayload = buildSetupCatalogModal(locale, nonce);
          await showRoutedRawModal(interaction, modalPayload);
          return;
        }
        if (selectedMode === "custom-endpoint") {
          await applySetupDraftWrite(
            interaction,
            updateSetupDraft(nonce, actorDiscId, workspaceKey, context, {
              providerAccess: { mode: "custom-endpoint", connection: null, textModel: null },
            }),
            locale,
            nonce,
            "update",
          );
          return;
        }
        if (selectedMode === "user-byok") {
          if (context === "dm") {
            if (!interaction.replied && !interaction.deferred) {
              await replyPanelReceipt(interaction, {
                tone: "warning",
                heading: localizer(locale, "general.panel_notice.not_available_heading"),
                detail: localizer(locale, "commands.setup.wizard.provider_byok_guild_only"),
              });
            }
            return;
          }
          const modalPayload = buildSetupByokModal(locale, nonce);
          await showRoutedRawModal(interaction, modalPayload);
          return;
        }
        if (!interaction.replied && !interaction.deferred) {
          await replyPanelReceipt(interaction, {
            tone: "warning",
            heading: localizer(locale, "general.panel_notice.invalid_heading"),
            detail: localizer(locale, "commands.setup.wizard.provider_invalid"),
          });
        }
        break;
      }

      case "option-action": {
        if (!interaction.isButton()) return;
        await interaction.deferUpdate();
        const access = draft.providerAccess;
        const setup = access?.mode === "option" ? findProviderOption(access.value)?.setup : undefined;
        if (!setup?.handleAction || (setup.available && !setup.available({ context }))) return;
        const receipt = await setup.handleAction({ locale, draft, interaction });
        await repaintSetupWizard(interaction, draft, locale, nonce, { method: "editReply", receipt });
        return;
      }

      case "provider-catalog-submit": {
        if (!interaction.isModalSubmit()) {
          return;
        }
        await acknowledgeModalSubmitForRefresh(interaction);

        const providerFieldId = buildSetupCatalogModalFieldId("provider", nonce);
        const apiKeyFieldId = buildSetupCatalogModalFieldId("api-key", nonce);

        const selectedProvider = takeRawModalSelectValue(interaction.id, providerFieldId);
        const apiKey = interaction.fields.getTextInputValue(apiKeyFieldId);

        const curatedProviders = new Set(getSetupCatalogProviderChoices().map((choice) => choice.value));

        if (!selectedProvider || !curatedProviders.has(selectedProvider)) {
          await repaintSetupWizard(interaction, draft, locale, nonce, {
            method: "editReply",
            receipt: setupFailureReceipt(locale, localizer(locale, "commands.setup.wizard.provider_invalid")),
          });
          return;
        }

        let providerInstance: Awaited<ReturnType<typeof ProviderFactory.getProviderByName>>;
        try {
          providerInstance = await ProviderFactory.getProviderByName(selectedProvider);
        } catch {
          await repaintSetupWizard(interaction, draft, locale, nonce, {
            method: "editReply",
            receipt: providerValidationFailureReceipt(locale),
          });
          return;
        }

        const validation = await providerInstance.validateApiKey(apiKey, workspaceKey);
        if (!validation.valid) {
          const rejection = rejectedKeyStatus(validation);
          await repaintSetupWizard(interaction, draft, locale, nonce, {
            method: "editReply",
            receipt:
              rejection === "host-restricted" || rejection === "vertex-config-invalid"
                ? setupFailureReceipt(
                    locale,
                    localizer(
                      locale,
                      rejection === "host-restricted"
                        ? "commands.providers.host_restricted"
                        : "commands.providers.vertex_config_invalid",
                    ),
                  )
                : await withRegistrationFailureCopy(
                    rejection === "no-balance"
                      ? providerNoBalanceReceipt(locale)
                      : providerValidationFailureReceipt(locale),
                    locale,
                    actorDiscId,
                  ),
          });
          return;
        }

        const encryption = await encryptApiKey(apiKey);
        await applySetupDraftWrite(
          interaction,
          updateSetupDraft(nonce, actorDiscId, workspaceKey, context, {
            providerAccess: {
              mode: "catalog",
              provider: selectedProvider,
              encryptedApiKey: encryption.encrypted,
              keyVersion: encryption.version,
            },
          }),
          locale,
          nonce,
          "editReply",
        );
        break;
      }

      case "provider-byok-submit": {
        if (!interaction.isModalSubmit()) {
          return;
        }
        await acknowledgeModalSubmitForRefresh(interaction);

        if (context === "dm") {
          await repaintSetupWizard(interaction, draft, locale, nonce, {
            method: "editReply",
            receipt: setupFailureReceipt(locale, localizer(locale, "commands.setup.wizard.provider_byok_guild_only")),
          });
          return;
        }

        const confirmFieldId = buildSetupByokModalFieldId("confirm", nonce);
        const selectedConfirm = takeRawModalSelectValue(interaction.id, confirmFieldId);

        if (selectedConfirm !== "yes" && selectedConfirm !== "no") {
          await repaintSetupWizard(interaction, draft, locale, nonce, {
            method: "editReply",
            receipt: setupFailureReceipt(locale, localizer(locale, "commands.setup.wizard.byok_choice_invalid")),
          });
          return;
        }

        if (selectedConfirm === "yes") {
          await applySetupDraftWrite(
            interaction,
            updateSetupDraft(nonce, actorDiscId, workspaceKey, context, {
              providerAccess: { mode: "user-byok" },
            }),
            locale,
            nonce,
            "editReply",
          );
          return;
        }

        // On no, repaint without updating the draft so any prior access stays intact.
        await repaintSetupWizard(interaction, draft, locale, nonce, {
          method: "editReply",
        });
        return;
      }

      case "endpoint-connection": {
        if (interaction.isModalSubmit()) {
          return;
        }
        if (draft.providerAccess?.mode !== "custom-endpoint") {
          return;
        }
        const modalPayload = buildSetupEndpointConnectionModal(locale, nonce, draft.providerAccess.connection);
        await showRoutedRawModal(interaction, modalPayload);
        return;
      }

      case "endpoint-connection-submit": {
        if (!interaction.isModalSubmit()) {
          return;
        }
        await acknowledgeModalSubmitForRefresh(interaction);

        if (draft.providerAccess?.mode !== "custom-endpoint") {
          return;
        }

        const apiStyleFieldId = buildSetupEndpointConnectionModalFieldId("api-style", nonce);
        const selectedApiStyle = takeRawModalSelectValue(interaction.id, apiStyleFieldId);
        const validStyles = new Set<string>(SETUP_ENDPOINT_API_STYLES);

        if (!selectedApiStyle || !validStyles.has(selectedApiStyle)) {
          await repaintSetupWizard(interaction, draft, locale, nonce, {
            method: "editReply",
            receipt: customEndpointFailureReceipt(
              locale,
              localizer(locale, "commands.setup.wizard.custom_endpoint_api_style_invalid"),
            ),
          });
          return;
        }

        const labelFieldId = buildSetupEndpointConnectionModalFieldId("label", nonce);
        const urlFieldId = buildSetupEndpointConnectionModalFieldId("url", nonce);
        const authTokenFieldId = buildSetupEndpointConnectionModalFieldId("auth-token", nonce);

        const label = interaction.fields.getTextInputValue(labelFieldId)?.trim() ?? "";
        const rawUrl = interaction.fields.getTextInputValue(urlFieldId)?.trim() ?? "";
        let rawToken: string | undefined;
        try {
          rawToken = interaction.fields.getTextInputValue(authTokenFieldId)?.trim();
        } catch {
          rawToken = undefined;
        }

        const normalizedUrl = normalizeCustomEndpointUrlForStorage(selectedApiStyle as CustomEndpointApiStyle, rawUrl);

        const probe = await validateCustomEndpointReachability({
          apiStyle: selectedApiStyle as CustomEndpointApiStyle,
          endpointUrl: normalizedUrl,
          apiKey: rawToken || null,
        });

        if (!probe.ok) {
          await repaintSetupWizard(interaction, draft, locale, nonce, {
            method: "editReply",
            receipt: await withRegistrationFailureCopy(
              customEndpointProbeFailureReceipt(locale, probe, normalizedUrl, rawToken),
              locale,
              actorDiscId,
            ),
          });
          return;
        }

        let encryptedAuthToken: Buffer | null = null;
        let keyVersion = 1;
        if (rawToken) {
          const encryption = await encryptApiKey(rawToken);
          encryptedAuthToken = encryption.encrypted;
          keyVersion = encryption.version;
        }

        // Saving a connection voids any prior text model because compatibility declarations depend on the API style.
        await applySetupDraftWrite(
          interaction,
          updateSetupDraft(nonce, actorDiscId, workspaceKey, context, {
            providerAccess: {
              mode: "custom-endpoint",
              connection: {
                label,
                apiStyle: selectedApiStyle as CustomEndpointApiStyle,
                endpointUrl: normalizedUrl,
                encryptedAuthToken,
                keyVersion,
              },
              textModel: null,
            },
          }),
          locale,
          nonce,
          "editReply",
        );
        break;
      }

      case "endpoint-model": {
        if (interaction.isModalSubmit()) {
          return;
        }
        if (draft.providerAccess?.mode !== "custom-endpoint" || !draft.providerAccess.connection) {
          return;
        }
        const modalPayload = buildSetupEndpointModelModal(locale, nonce, draft.providerAccess.textModel);
        await showRoutedRawModal(interaction, modalPayload);
        return;
      }

      case "endpoint-model-submit": {
        if (!interaction.isModalSubmit()) {
          return;
        }
        await acknowledgeModalSubmitForRefresh(interaction);

        if (draft.providerAccess?.mode !== "custom-endpoint" || !draft.providerAccess.connection) {
          return;
        }

        const modelCodeFieldId = buildSetupEndpointModelModalFieldId("model-code", nonce);
        const numCtxFieldId = buildSetupEndpointModelModalFieldId("num-ctx", nonce);
        const capabilitiesFieldId = buildSetupEndpointModelModalFieldId("capabilities", nonce);

        const modelCode = interaction.fields.getTextInputValue(modelCodeFieldId)?.trim();
        if (!modelCode) {
          await repaintSetupWizard(interaction, draft, locale, nonce, {
            method: "editReply",
            receipt: customEndpointFailureReceipt(
              locale,
              localizer(locale, "commands.setup.wizard.custom_endpoint_model_invalid"),
            ),
          });
          return;
        }

        let rawNumCtx: string | undefined;
        try {
          rawNumCtx = interaction.fields.getTextInputValue(numCtxFieldId);
        } catch {
          rawNumCtx = undefined;
        }
        const numCtx = parseNumCtxField(rawNumCtx);

        const rawCapabilities = takeRawModalCheckboxGroupValues(interaction.id, capabilitiesFieldId) ?? [];
        for (const cap of rawCapabilities) {
          if (!setupCustomEndpointCapabilitySchema.safeParse(cap).success) {
            await repaintSetupWizard(interaction, draft, locale, nonce, {
              method: "editReply",
              receipt: customEndpointFailureReceipt(
                locale,
                localizer(locale, "commands.setup.wizard.custom_endpoint_model_invalid"),
              ),
            });
            return;
          }
        }

        await applySetupDraftWrite(
          interaction,
          updateSetupDraft(nonce, actorDiscId, workspaceKey, context, {
            providerAccess: {
              mode: "custom-endpoint",
              connection: draft.providerAccess.connection,
              textModel: {
                modelCode,
                numCtx,
                capabilities: rawCapabilities as SetupCustomEndpointCapability[],
              },
            },
          }),
          locale,
          nonce,
          "editReply",
        );
        break;
      }

      case "finish": {
        // The routed fan-out has already rechecked the draft's owner, workspace, context, guild
        // permission, and captured environment, so this arm owns only the final-action gates.
        if (!isSetupDraftComplete(draft)) {
          if (!interaction.replied && !interaction.deferred) {
            await replyPanelReceipt(interaction, {
              tone: "warning",
              heading: localizer(locale, "general.panel_notice.not_available_heading"),
              detail: localizer(locale, "commands.setup.wizard.finish_incomplete"),
            });
          }
          return;
        }

        await finishSetupWizardDraft(interaction, draft, locale, nonce);
        break;
      }
    }
  },
};
