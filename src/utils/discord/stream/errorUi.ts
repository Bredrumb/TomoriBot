import { EmbedBuilder, MessageFlags, type ColorResolvable } from "discord.js";
import type { ProviderError, StreamProvider, StreamContext } from "@/types/stream/interfaces";
import { sendStandardEmbed } from "@/utils/discord/embedHelper";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

/**
 * Owns provider and generic stream error reporting to Discord.
 */
export class StreamErrorUi {
  public async handleProviderError(error: unknown, provider: StreamProvider, context: StreamContext): Promise<void> {
    const providerError = error as ProviderError;
    const locale = context.locale;
    const providerDescription = provider.createErrorDescription(providerError, locale);
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
      const { titleKey, tipKey, color } = this.resolveProviderErrorPresentation(providerError, context);
      const hasFallbackModels = (context.tomoriState.fallback_llms?.length ?? 0) > 0;
      const shouldShowModelFallbackHint =
        !hasFallbackModels &&
        (providerError.type === "rate_limit" ||
          providerError.type === "provider_overloaded" ||
          providerError.code === "503");
      const footerText = shouldShowModelFallbackHint
        ? `${localizer(locale, tipKey)}\n${localizer(locale, "genai.stream.model_fallback_hint")}`
        : localizer(locale, tipKey);

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(localizer(locale, titleKey))
        .setDescription(providerDescription)
        .setFooter({
          text: footerText,
        });

      await context.channel
        .send({ embeds: [embed] })
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
      },
    ).catch((e) => log.warn("Stream: Failed to send generic error embed to channel", e));
  }

  private resolveProviderErrorPresentation(
    providerError: ProviderError,
    context: StreamContext,
  ): {
    titleKey: string;
    tipKey: string;
    color: ColorResolvable;
  } {
    switch (providerError.type) {
      case "rate_limit":
        return {
          titleKey: context.rotationKeyRetriesUsed
            ? "genai.stream.rate_limit_title_all_rotation_keys"
            : "genai.stream.rate_limit_title",
          tipKey: "genai.stream.rate_limit_tip",
          color: ColorCode.WARN,
        };
      case "content_blocked":
        return {
          titleKey: "genai.stream.content_blocked_title",
          tipKey: "genai.stream.content_blocked_tip",
          color: ColorCode.ERROR,
        };
      case "timeout":
        return {
          titleKey: "genai.stream.timeout_title",
          tipKey: "genai.stream.timeout_tip",
          color: ColorCode.WARN,
        };
      case "provider_overloaded":
        return {
          titleKey: "genai.stream.provider_overloaded_title",
          tipKey: "genai.stream.provider_overloaded_tip",
          color: ColorCode.WARN,
        };
      default:
        return {
          titleKey: "genai.stream.api_error_title",
          tipKey: "genai.stream.api_error_tip",
          color: providerError.retryable ? ColorCode.WARN : ColorCode.ERROR,
        };
    }
  }
}
