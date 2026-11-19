import { resolveProviderErrorPresentation } from "@/utils/provider/providerErrorPresentation";
import { findProviderRequestDeniedError, getProviderRequestFailureCopy } from "@/utils/provider/providerUsage";
import { MessageFlags, PermissionFlagsBits, type ButtonInteraction, type EmbedBuilder } from "discord.js";
import type { RestrictedDetailModal } from "@/types/discord/embed";
import type { ProviderError, StreamProvider, StreamContext } from "@/types/stream/interfaces";
import { createStandardEmbed, sendStandardEmbed } from "@/utils/discord/embedHelper";
import { ColorCode, log, redactLogString } from "@/utils/misc/logger";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { getProviderErrorDetail, isProviderModelError } from "@/utils/provider/providerErrorClassification";
import { localizer } from "@/utils/text/localizer";
import { withProviderOptionCopy, type ProviderOptionCopyContext } from "@/utils/provider/providerOptionRegistry";
import { redactProviderDetail } from "@/utils/provider/providerErrorMetrics";

export const TOMORIBOT_ERROR_FOOTER_KEY = "genai.stream.error_footer_tomoribot";

// Personal credential routes take precedence over DM wording because the member's own key failed rather than the bot
// owner's.
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

async function sendInitialInteractionError(
  interaction: NonNullable<StreamContext["initialInteraction"]>,
  embed: EmbedBuilder,
): Promise<void> {
  const payload = { embeds: [embed], flags: MessageFlags.Ephemeral } as const;
  await (interaction.replied || interaction.deferred
    ? interaction.followUp(payload)
    : interaction.reply(payload)
  ).catch((error) => log.warn("Stream: Failed to send error to the initial interaction", error));
}

// Guild absence is checked instead of isDMBased() because DM channels lack a guild and minimal test doubles need not
// implement isDMBased.
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

// Discord-facing error UI only; operator reporting stays in the orchestrator so failures are not reported twice.
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

    if (context.initialInteraction) {
      await sendInitialInteractionError(
        context.initialInteraction,
        createStandardEmbed(locale, {
          titleKey: denialCopy?.titleKey ?? "genai.generic_error_title",
          description: errorMessage,
          color: ColorCode.ERROR,
        }),
      );
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
        await sendInitialInteractionError(
          context.initialInteraction,
          createStandardEmbed(context.locale, { ...copy, color: ColorCode.ERROR }),
        );
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
      await sendInitialInteractionError(
        context.initialInteraction,
        createStandardEmbed(context.locale, {
          titleKey: "genai.generic_error_title",
          description: errorMessage,
          color: ColorCode.ERROR,
        }),
      );
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

  // Upstream error text stays out of the public embed because self-debug reads it and endpoints can echo bearer
  // tokens in encodings redaction misses.
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

// Sized below Discord's 4000-char TextDisplay limit to leave room for the code fence so the fence never splits across
// displays.
const ERROR_DETAIL_MODAL_CHARS = 3_900;
// Caps adapter prefixes at 500 chars because anything longer is upstream text that would crowd out the formatted
// error body.
const ERROR_DETAIL_PREFIX_CHARS = 500;
// Inserted between backticks so untrusted provider error text cannot close the modal's code fence early.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const CODE_FENCE = "```";
const NESTED_JSON_DEPTH = 4;

// Raw provider errors stay inside a gated modal because modals never enter channel history or self-debug, limiting
// exposure to key managers.
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

// Non-guild interactions are allowed because only the DM's own user can press the button outside a guild.
function canManageServerCredentials(interaction: ButtonInteraction): boolean {
  if (!interaction.inGuild()) return true;
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
}

// Nested JSON (such as Google's error.message) is unwrapped before redacting so pretty-printing cannot unescape a
// credential that escaped redaction.
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

// Callers must redact before calling boundText, because truncating mid-secret leaves a fragment that redaction
// patterns cannot match.
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
