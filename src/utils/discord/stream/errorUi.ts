import { EmbedBuilder, MessageFlags, type ColorResolvable } from "discord.js";
import type { ProviderError, StreamProvider, StreamContext } from "@/types/stream/interfaces";
import { createTipEmbed, sendStandardEmbed, truncateForEmbedDescription } from "@/utils/discord/embedHelper";
import { ColorCode, log } from "@/utils/misc/logger";
import { getProviderErrorDetail, isProviderModelError } from "@/utils/provider/providerErrorClassification";
import { localizer } from "@/utils/text/localizer";

/**
 * Owns provider and generic stream error reporting to Discord.
 */
export class StreamErrorUi {
  public async handleProviderError(error: unknown, provider: StreamProvider, context: StreamContext): Promise<void> {
    const providerError = error as ProviderError;
    const locale = context.locale;
    const isModelError = isProviderModelError(providerError);
    const providerDescription = this.resolveProviderDescription(providerError, provider, locale, isModelError);
    const errorMessage =
      providerDescription ||
      localizer(locale, "genai.stream.provider_error_interaction", {
        reason: providerError.type || "unknown",
      });

    log.warn(`Stream error: ${errorMessage}`, error);

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

    if (providerDescription) {
      const { titleKey, tipKeys, color } = this.resolveProviderErrorPresentation(providerError, provider, context);

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(localizer(locale, titleKey))
        .setDescription(providerDescription);

      // Actionable tips now ride in a separate green Tip embed (footers cannot render the hyperlinks
      // that tips like the OpenRouter model list need).
      const tipEmbed = createTipEmbed(locale, tipKeys);
      const embeds = tipEmbed ? [embed, tipEmbed] : [embed];

      await context.channel
        .send({ embeds })
        .catch((e) => log.warn("Stream: Failed to send provider error embed to channel", e));
      return;
    }

    await sendStandardEmbed(context.channel, locale, {
      titleKey: "genai.stream.response_stopped_title",
      descriptionKey: "genai.stream.response_stopped_description",
      descriptionVars: {
        reason: providerError.type || "unknown",
      },
      color: ColorCode.ERROR,
      tipKeys: ["genai.tips.refresh_context", "genai.tips.switch_model_provider"],
    }).catch((e) => log.warn("Stream: Failed to send error embed to channel", e));
  }

  public async handleStreamError(error: Error, context: StreamContext): Promise<void> {
    const errorMessage = `An error occurred while streaming: ${error.message}`;

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

    await sendStandardEmbed(
      context.channel,
      "guild" in context.channel ? context.channel.guild.preferredLocale : "en-US",
      {
        titleKey: "genai.generic_error_title",
        descriptionKey: "genai.generic_error_description",
        descriptionVars: { error_message: error.message },
        color: ColorCode.ERROR,
        tipKeys: ["genai.tips.refresh_context", "genai.tips.report_support"],
      },
    ).catch((e) => log.warn("Stream: Failed to send generic error embed to channel", e));
  }

  /**
   * Resolves the title, tip-item keys, and color for a provider error embed.
   *
   * Tips are composed from atomic keys so conditional items stay declarative:
   * - `model_fallback` is only offered when the server has no fallback chain configured yet.
   * - OpenRouter-specific items (free-model list / model list) are appended only for that provider.
   * @param providerError - The normalized provider error.
   * @param provider - The active stream provider (used to detect OpenRouter for conditional tips).
   * @param context - The stream context (fallback config + rotation state drive tip/title choices).
   * @returns The title key, ordered tip-item keys, and embed color.
   */
  private resolveProviderErrorPresentation(
    providerError: ProviderError,
    provider: StreamProvider,
    context: StreamContext,
  ): {
    titleKey: string;
    tipKeys: string[];
    color: ColorResolvable;
  } {
    // 1. Detect OpenRouter and whether a fallback chain already exists — both gate conditional tips.
    const isOpenRouter = provider.getProviderInfo().name === "openrouter";
    const hasFallbackModels = (context.tomoriState.fallback_llms?.length ?? 0) > 0;
    const modelFallbackTip = hasFallbackModels ? [] : ["genai.tips.model_fallback"];

    // 2. Model errors (unsupported/unknown/deprecated model IDs) — steer toward a supported model.
    if (isProviderModelError(providerError)) {
      return {
        titleKey: "genai.stream.model_error_title",
        tipKeys: ["genai.tips.choose_supported_model", ...(isOpenRouter ? ["genai.tips.openrouter_models"] : [])],
        color: ColorCode.ERROR,
      };
    }

    switch (providerError.type) {
      case "rate_limit":
        return {
          titleKey: context.rotationKeyRetriesUsed
            ? "genai.stream.rate_limit_title_all_rotation_keys"
            : "genai.stream.rate_limit_title",
          tipKeys: [
            "genai.tips.wait_and_retry",
            "genai.tips.api_key_rotation",
            ...modelFallbackTip,
            ...(isOpenRouter ? ["genai.tips.openrouter_free_models"] : []),
          ],
          color: ColorCode.WARN,
        };
      case "content_blocked":
        return {
          titleKey: "genai.stream.content_blocked_title",
          tipKeys: [
            "genai.tips.nsfw_jailbreaks",
            "genai.tips.review_messages",
            "genai.tips.review_memories",
            "genai.tips.blacklist_member",
            "genai.tips.switch_model_provider",
          ],
          color: ColorCode.ERROR,
        };
      case "timeout":
        return {
          titleKey: "genai.stream.timeout_title",
          tipKeys: ["genai.tips.shorten_message", "genai.tips.refresh_context"],
          color: ColorCode.WARN,
        };
      case "provider_overloaded":
        return {
          titleKey: "genai.stream.provider_overloaded_title",
          tipKeys: ["genai.tips.provider_overloaded_wait", ...modelFallbackTip],
          color: ColorCode.WARN,
        };
      default:
        return {
          titleKey: "genai.stream.api_error_title",
          tipKeys: [
            "genai.tips.verify_api_key",
            "genai.tips.switch_model_provider",
            ...(isOpenRouter ? ["genai.tips.openrouter_models"] : []),
            "genai.tips.report_support",
          ],
          color: providerError.retryable ? ColorCode.WARN : ColorCode.ERROR,
        };
    }
  }

  /**
   * Builds the embed description for a provider error: a friendly, localized headline followed by
   * the raw provider detail. The detail is appended for ALL error types — not just model errors —
   * so providers that map known codes to hardcoded locale strings (e.g. OpenRouter) no longer hide
   * the actual provider message from the user.
   * @param providerError - The normalized provider error.
   * @param provider - The active stream provider (supplies the localized headline).
   * @param locale - The resolved user locale.
   * @param isModelError - Whether the error classifies as a model-selection error (drives the headline fallback).
   * @returns The composed description, or null when no headline can be produced.
   */
  private resolveProviderDescription(
    providerError: ProviderError,
    provider: StreamProvider,
    locale: string,
    isModelError: boolean,
  ): string | null {
    // 1. Headline: the provider's friendly, localized message. Model errors fall back to a generic
    //    headline when the provider does not supply one.
    const providerHeadline = provider.createErrorDescription(providerError, locale);
    const headline =
      providerHeadline || (isModelError ? localizer(locale, "genai.stream.model_error_description") : null);
    if (!headline) {
      return null;
    }

    // 2. Raw provider detail. Skip when absent or already embedded in the headline (a provider may
    //    have appended it itself) so we never duplicate the "Details" section.
    const detail = getProviderErrorDetail(providerError);
    if (!detail || headline.includes(detail)) {
      return headline;
    }

    // 3. Append the detail, truncated so the combined description stays within Discord's embed limit.
    const detailsLabel = "\n\n**Details:**\n";
    const truncatedDetail = truncateForEmbedDescription(detail, headline.length + detailsLabel.length);
    if (!truncatedDetail) {
      return headline;
    }
    return `${headline}${detailsLabel}${truncatedDetail}`;
  }
}
