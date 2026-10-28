import { resolveProviderErrorPresentation } from "@/utils/provider/providerErrorPresentation";
import { findProviderRequestDeniedError, getProviderRequestFailureCopy } from "@/utils/provider/providerUsage";
import { MessageFlags, PermissionFlagsBits, type ButtonInteraction } from "discord.js";
import type { RestrictedDetailModal } from "@/types/discord/embed";
import type { ProviderError, StreamProvider, StreamContext } from "@/types/stream/interfaces";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { ColorCode, log, redactLogString } from "@/utils/misc/logger";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import {
  getProviderErrorDetail,
  isOperatorActionableProviderError,
  isProviderModelError,
} from "@/utils/provider/providerErrorClassification";
import { localizer } from "@/utils/text/localizer";
import { withProviderOptionCopy, type ProviderOptionCopyContext } from "@/utils/provider/providerOptionRegistry";
import { redactProviderDetail } from "@/utils/provider/providerErrorMetrics";

/** Attributes an internal failure to TomoriBot so users do not debug their provider for it. */
export const TOMORIBOT_ERROR_FOOTER_KEY = "genai.stream.error_footer_tomoribot";

/**
 * Names the provider a failed request ran on, so an upstream refusal or outage is not read as a
 * TomoriBot bug. A personal route names the member's own provider ahead of the DM wording because
 * the member's key failed, not the bot owner's.
 */
export function resolveProviderErrorFooter(args: {
  providerName: string;
  textCredentialSource?: StreamContext["textCredentialSource"];
  isDM?: boolean;
}): { footerKey: string; footerVars: { provider: string } } {
  const footerVars = { provider: getProviderDisplayName(args.providerName) };
  if (args.textCredentialSource === "personal") {
    return { footerKey: "genai.stream.error_footer_personal_provider", footerVars };
  }
  if (args.isDM) {
    return { footerKey: "genai.stream.error_footer_dm_provider", footerVars };
  }
  return { footerKey: "genai.stream.error_footer_server_provider", footerVars };
}

/** Guild channels carry their guild; a DM channel has none, and test doubles need not implement `isDMBased`. */
export function isDirectMessageChannel(channel: object): boolean {
  return !("guild" in channel && channel.guild);
}

function providerCopyContext(context: StreamContext): ProviderOptionCopyContext {
  return {
    surface: "recovery",
    managedProvider: context.usageContext?.credentialProvider ?? null,
    userDiscId: context.triggererDiscId,
    serverId: context.tomoriState.server_id,
    credentialScope:
      context.usageContext?.credentialScope ??
      (context.textCredentialSource === "personal"
        ? "personal"
        : context.textCredentialSource === "server"
          ? "server"
          : undefined),
  };
}

/**
 * Owns provider and generic stream error reporting to Discord.
 */
export class StreamErrorUi {
  public async handleProviderError(
    error: unknown,
    provider: StreamProvider,
    context: StreamContext,
    requestApiKey: string,
  ): Promise<void> {
    const providerError = error as ProviderError;
    const locale = context.locale;
    const denied = findProviderRequestDeniedError(error, context.usageContext);
    const denialCopy = denied ? getProviderRequestFailureCopy(denied, locale) : null;
    const isModelError = isProviderModelError(providerError);
    const providerDescription =
      denialCopy?.description ?? this.resolveProviderDescription(providerError, provider, locale, isModelError);
    const errorMessage =
      providerDescription ||
      localizer(locale, "genai.stream.provider_error_interaction", {
        reason: providerError.type || "unknown",
      });

    const rawDetail = denied ? null : getProviderErrorDetail(providerError);
    const providerDetail = rawDetail ? redactProviderDetail(rawDetail, requestApiKey) : null;
    const operatorDetail = boundOperatorDetail(providerDetail);
    if (!denied && isOperatorActionableProviderError(providerError)) {
      const providerName = provider.getProviderInfo().name;
      // Not awaited: an unacknowledged initialInteraction is replied to below. The raw provider
      // error is the payload because errorMessage is localized for the guild, not the operator.
      void log.error(
        `Provider stream error (${providerName} ${providerError.type}/${providerError.code ?? "unknown"}): ${operatorDetail}`,
        providerError.originalError ?? providerError,
        {
          serverId: context.tomoriState.server_id,
          userId: context.triggererUserId ?? null,
          errorType: "ProviderStreamError",
          metadata: {
            // A personal route ran on the user's own key and endpoint, not the server's provider.
            textCredentialSource: context.textCredentialSource ?? "server",
            provider: providerName,
            providerErrorType: providerError.type,
            providerErrorCode: providerError.code ?? "unknown",
            channelId: context.channel.id,
          },
        },
        { redactValues: [requestApiKey] },
      );
    } else {
      log.warn(
        `Stream error (${providerError.type}/${providerError.code ?? "unknown"}): ${operatorDetail}`,
        error,
        undefined,
        { retain: true, redactValues: [requestApiKey] },
      );
    }

    if (context.initialInteraction) {
      if (!context.initialInteraction.replied && !context.initialInteraction.deferred) {
        await context.initialInteraction
          .reply({ content: errorMessage, flags: MessageFlags.Ephemeral })
          .catch((e) => log.warn("Stream: Failed to reply to initial interaction with error", e));
      } else {
        await context.initialInteraction
          .followUp({ content: errorMessage, flags: MessageFlags.Ephemeral })
          .catch((e) => log.warn("Stream: Failed to followUp initial interaction with error", e));
      }
      return;
    }

    const restrictedDetail = providerDetail ? buildRestrictedErrorDetail(providerDetail, context) : undefined;
    const sourceFooter = resolveProviderErrorFooter({
      providerName: context.tomoriState.llm.llm_provider,
      textCredentialSource: context.textCredentialSource,
      isDM: isDirectMessageChannel(context.channel),
    });

    if (providerDescription) {
      const { titleKey, tipKeys, color } = denialCopy
        ? { titleKey: denialCopy.titleKey, tipKeys: [], color: ColorCode.ERROR }
        : resolveProviderErrorPresentation(providerError, provider.getProviderInfo().name, context);

      await sendStandardEmbed(context.channel, locale, {
        titleKey,
        description: providerDescription,
        color,
        tipKeys: denied ? tipKeys : await withProviderOptionCopy(tipKeys, providerCopyContext(context)),
        restrictedDetail,
        ...sourceFooter,
      }).catch((e) => log.warn("Stream: Failed to send provider error embed to channel", e));
      return;
    }

    await sendStandardEmbed(context.channel, locale, {
      titleKey: "genai.stream.response_stopped_title",
      descriptionKey: "genai.stream.response_stopped_description",
      descriptionVars: {
        reason: providerError.type || "unknown",
      },
      color: ColorCode.ERROR,
      tipKeys: await withProviderOptionCopy(
        [
          "genai.tips.refresh_context",
          context.textCredentialSource === "personal"
            ? "genai.tips.switch_model_provider_personal"
            : "genai.tips.switch_model_provider",
        ],
        providerCopyContext(context),
      ),
      restrictedDetail,
      ...sourceFooter,
    }).catch((e) => log.warn("Stream: Failed to send error embed to channel", e));
  }

  public async handleStreamError(error: Error, context: StreamContext): Promise<void> {
    const denied = findProviderRequestDeniedError(error, context.usageContext);
    if (denied) {
      const copy = getProviderRequestFailureCopy(denied, context.locale);
      if (context.initialInteraction) {
        const payload = { content: copy.description, flags: MessageFlags.Ephemeral } as const;
        const interaction = context.initialInteraction;
        await (interaction.replied || interaction.deferred
          ? interaction.followUp(payload)
          : interaction.reply(payload)
        ).catch((sendError) => log.warn("Failed to send provider request denial", sendError));
      } else {
        await sendStandardEmbed(context.channel, context.locale, { ...copy, color: ColorCode.ERROR }).catch(
          (sendError) => log.warn("Failed to send provider request denial", sendError),
        );
      }
      return;
    }
    // The orchestrator already logged the exception; its text can carry an endpoint's response.
    const errorMessage = localizer(context.locale, "genai.stream.streaming_failed_description");

    if (context.initialInteraction) {
      if (!context.initialInteraction.replied && !context.initialInteraction.deferred) {
        await context.initialInteraction
          .reply({ content: errorMessage, flags: MessageFlags.Ephemeral })
          .catch((e) => log.warn("Stream: Failed to reply to initial interaction with error", e));
      } else {
        await context.initialInteraction
          .followUp({ content: errorMessage, flags: MessageFlags.Ephemeral })
          .catch((e) => log.warn("Stream: Failed to followUp initial interaction with error", e));
      }
      return;
    }

    await sendStandardEmbed(context.channel, context.locale, {
      titleKey: "genai.generic_error_title",
      descriptionKey: "genai.stream.streaming_failed_description",
      color: ColorCode.ERROR,
      tipKeys: await withProviderOptionCopy(["genai.tips.refresh_context"], providerCopyContext(context)),
      footerKey: TOMORIBOT_ERROR_FOOTER_KEY,
    }).catch((e) => log.warn("Stream: Failed to send generic error embed to channel", e));
  }

  /**
   * The provider's localized, classified headline. Upstream response text stays out of the embed:
   * the embed is public, self-debug feeds it back into model context, and an endpoint can echo the
   * bearer value it received in any encoding pattern redaction would miss. The raw text is offered
   * only through {@link buildRestrictedErrorDetail}.
   * @param isModelError - Whether the error classifies as a model-selection error (drives the headline fallback).
   * @returns The headline, or null when no headline can be produced.
   */
  private resolveProviderDescription(
    providerError: ProviderError,
    provider: StreamProvider,
    locale: string,
    isModelError: boolean,
  ): string | null {
    const providerHeadline = provider.createErrorDescription(providerError, locale);
    return providerHeadline || (isModelError ? localizer(locale, "genai.stream.model_error_description") : null);
  }
}

const OPERATOR_ERROR_DETAIL_CHARS = 2000;

/** Response bodies are unbounded, and logger truncation is opt-in per deployment. */
function boundOperatorDetail(detail: string | null): string {
  if (!detail) return "no provider detail";
  return detail.length > OPERATOR_ERROR_DETAIL_CHARS ? `${detail.slice(0, OPERATOR_ERROR_DETAIL_CHARS)}...` : detail;
}

/** One 4000-char text display minus the code fence, so the fence never splits across displays. */
const ERROR_DETAIL_MODAL_CHARS = 3_900;
/** Adapter prefixes are a short label; anything longer is upstream text that must leave room for the body. */
const ERROR_DETAIL_PREFIX_CHARS = 500;
/** Placed between adjacent backticks so provider text cannot close the code fence early. */
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const CODE_FENCE = "```";
const NESTED_JSON_DEPTH = 4;

/**
 * Offers the raw provider error behind a gated modal. A modal reaches only the viewer and never
 * enters channel history, so neither the channel nor self-debug sees it; the remaining exposure
 * is limited to the people who could already replace the failing key.
 */
export function buildRestrictedErrorDetail(
  detail: string,
  context: Pick<StreamContext, "textCredentialSource" | "triggererDiscId">,
): RestrictedDetailModal {
  // A personal route ran on the triggerer's own key and endpoint, which server managers do not own.
  if (context.textCredentialSource === "personal") {
    const ownerDiscId = context.triggererDiscId;
    return {
      content: formatProviderErrorDetail(detail),
      access: {
        canOpen: (interaction) => ownerDiscId !== undefined && interaction.user.id === ownerDiscId,
        deniedKey: "genai.error_detail.personal_only",
      },
    };
  }
  return {
    content: formatProviderErrorDetail(detail),
    access: { canOpen: canManageServerCredentials, deniedKey: "genai.error_detail.manage_server_only" },
  };
}

/** Outside a guild the only person who can press the button is the DM's own user. */
function canManageServerCredentials(interaction: ButtonInteraction): boolean {
  if (!interaction.inGuild()) return true;
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
}

/**
 * Pretty-prints the JSON body an adapter wraps in its own prefix (Google nests a second JSON
 * document inside `error.message`), then redacts the rendered text so unwrapping cannot expose a
 * credential that was escaped in the original.
 */
export function formatProviderErrorDetail(detail: string): string {
  const jsonStart = detail.indexOf("{");
  const parsed = jsonStart === -1 ? undefined : tryParseJson(detail.slice(jsonStart));
  const prefix =
    parsed === undefined
      ? ""
      : boundText(redactLogString(detail.slice(0, jsonStart).trim()), ERROR_DETAIL_PREFIX_CHARS);
  const body = parsed === undefined ? detail : JSON.stringify(unwrapNestedJson(parsed, 0), null, 2);
  const language = parsed === undefined ? "" : "json";
  const escaped = redactLogString(body).replace(/`(?=`)/g, `\`${ZERO_WIDTH_SPACE}`);
  const fenced = boundText(escaped, ERROR_DETAIL_MODAL_CHARS - prefix.length);
  const block = [`${CODE_FENCE}${language}`, fenced, CODE_FENCE].join("\n");
  return prefix ? `${prefix}\n${block}` : block;
}

/** Redact before bounding, so a cut never leaves half a credential the patterns can no longer match. */
function boundText(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function unwrapNestedJson(value: unknown, depth: number): unknown {
  if (depth >= NESTED_JSON_DEPTH) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
    const parsed = tryParseJson(trimmed);
    return parsed === undefined ? value : unwrapNestedJson(parsed, depth + 1);
  }
  if (Array.isArray(value)) return value.map((entry) => unwrapNestedJson(entry, depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, unwrapNestedJson(entry, depth + 1)]));
  }
  return value;
}
