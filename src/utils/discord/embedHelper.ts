import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  type ButtonInteraction,
  type TextChannel,
  type NewsChannel,
  type DMChannel,
  type Message,
  type APIEmbedField,
  type BaseGuildTextChannel,
  type BaseGuildVoiceChannel,
  type AnyThreadChannel,
} from "discord.js";
import { ColorCode, log } from "../misc/logger";
import { localizer } from "../text/localizer";
import type { SendableChannel } from "@/utils/discord/resolveSendableChannel";
import { type PersonaPostContext, recordPersonaDelivery, sendPersonaPost } from "@/utils/discord/webhook/personaPost";
import { resolveAuthoringWebhook } from "@/utils/discord/webhook/fallback";
import { attachTextDisplayModalCollector, buildTextDisplayModalRow } from "./textDisplayModal";
import { withStatusCircle } from "./ui/statusTitle";
import { resolveFooterLines } from "./ui/noticeFooter";
import type { StandardEmbedOptions, SummaryEmbedOptions, TranslationEmbedOptions } from "../../types/discord/embed";
import { TRANSLATOR_COLORS, TranslationProvider } from "../../types/discord/embed";

type Provider = keyof typeof TRANSLATOR_COLORS;

// Constant is 1024 because Discord rejects embed field values exceeding 1024 characters.
const MAX_FIELD_VALUE_LENGTH = 1024;

// Constant is 4096 because Discord rejects embed descriptions exceeding 4096 characters.
const MAX_EMBED_DESCRIPTION_LENGTH = 4096;

const SUPPORT_SERVER_TIP_KEY = "genai.tips.support_server";
const TIP_DETAILS_BUTTON_ID = "error_tip_details";
const ERROR_DETAIL_BUTTON_ID = "error_full_detail";
const TIP_BUTTON_TIMEOUT_MS = 86_400_000;

export function truncateForEmbedDescription(value: string, reservedChars = 0): string {
  const available = Math.max(0, MAX_EMBED_DESCRIPTION_LENGTH - reservedChars);
  if (value.length <= available) {
    return value;
  }
  return available <= 3 ? value.substring(0, available) : `${value.substring(0, available - 3)}...`;
}

export type WebhookEmbedContext = Omit<PersonaPostContext, "channel" | "persona"> & {
  persona?: PersonaPostContext["persona"];
};

function truncateFieldValue(value: string): string {
  if (value.length <= MAX_FIELD_VALUE_LENGTH) {
    return value;
  }
  return `${value.substring(0, MAX_FIELD_VALUE_LENGTH - 3)}...`;
}

export function createStandardEmbed(locale: string, options: StandardEmbedOptions): EmbedBuilder {
  const {
    titleKey,
    titleVars = {},
    descriptionKey,
    description,
    descriptionVars = {},
    color = ColorCode.INFO,
    footerKey,
    footerVars = {},
    configHint,
    thumbnailUrl,
    minimal,
  } = options;

  if (minimal) {
    return new EmbedBuilder().setColor(color).setTitle(withStatusCircle(localizer(locale, titleKey, titleVars), color));
  }

  const descriptionText = description
    ? description
    : descriptionKey
      ? localizer(locale, descriptionKey, descriptionVars)
      : null;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(withStatusCircle(localizer(locale, titleKey, titleVars), color))
    .setDescription(descriptionText);

  const footerLines = resolveFooterLines(locale, footerKey, footerVars, configHint);
  if (footerLines.length > 0) {
    embed.setFooter({
      text: footerLines.join("\n"),
    });
  }

  if (thumbnailUrl) {
    embed.setThumbnail(thumbnailUrl);
  }

  return embed;
}

function createTipText(
  locale: string,
  tipKeys: string[],
  tipVars: Record<string, string | number | boolean> = {},
): string | null {
  const items = tipKeys
    .filter((key) => key !== SUPPORT_SERVER_TIP_KEY)
    .map((key) => localizer(locale, key, tipVars).trim())
    .filter((text) => text.length > 0);
  if (items.length === 0) {
    return null;
  }

  // The support link gives every recovery modal an escape hatch without burdening each caller.
  const supportItem = localizer(locale, SUPPORT_SERVER_TIP_KEY, tipVars).trim();
  if (supportItem.length > 0) {
    items.push(supportItem);
  }

  return items.map((item) => `- ${item}`).join("\n");
}

export function createSummaryEmbed(locale: string, options: SummaryEmbedOptions): EmbedBuilder {
  const {
    titleKey,
    titleVars = {},
    descriptionKey,
    description,
    descriptionVars = {},
    color = ColorCode.INFO,
    footerKey,
    footerVars = {},
    thumbnailUrl,
    timestamp,
    fields,
  } = options;

  const descriptionText = description
    ? description
    : descriptionKey
      ? localizer(locale, descriptionKey, descriptionVars)
      : null;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(withStatusCircle(localizer(locale, titleKey, titleVars), color))
    .setDescription(descriptionText)
    .addFields(
      fields.map((field): APIEmbedField => {
        const name = field.nameKey ? localizer(locale, field.nameKey, field.nameVars) : (field.name ?? "");

        const rawValue = field.valueKey ? localizer(locale, field.valueKey, field.valueVars) : (field.value ?? "");

        const value = truncateFieldValue(rawValue);

        return {
          name,
          value,
          inline: field.inline ?? false,
        };
      }),
    );

  if (footerKey) {
    embed.setFooter({
      text: localizer(locale, footerKey, footerVars),
    });
  }

  if (thumbnailUrl) {
    embed.setThumbnail(thumbnailUrl);
  }

  if (timestamp) {
    embed.setTimestamp();
  }

  return embed;
}

export async function sendStandardEmbed(
  channel: TextChannel | NewsChannel | DMChannel | BaseGuildTextChannel | AnyThreadChannel | BaseGuildVoiceChannel,
  locale: string,
  options: StandardEmbedOptions,
  webhookContext?: WebhookEmbedContext,
): Promise<void> {
  const embed = createStandardEmbed(locale, options);
  const modalButtons = prepareEmbedModalButtons(locale, options, "Error");
  const { disabledRow: disabledModalRow, components } = modalButtons;
  let sentMessage: Message | undefined;
  let sentViaWebhook = false;
  let threadId: string | undefined;

  if (webhookContext?.persona) {
    threadId =
      "isThread" in channel && typeof channel.isThread === "function" && channel.isThread() ? channel.id : undefined;
    const outcome = await sendPersonaPost(
      {
        channel: channel as unknown as SendableChannel,
        persona: webhookContext.persona,
        deliveryMode: webhookContext.deliveryMode,
        webhook: webhookContext.webhook,
        impersonatedIdentity: webhookContext.impersonatedIdentity,
        abortSignal: webhookContext.abortSignal,
        isExecutionCancelled: webhookContext.isExecutionCancelled,
        deliveryReceipts: webhookContext.deliveryReceipts,
        deliveryState: webhookContext.deliveryState,
        holdResponseText: webhookContext.holdResponseText,
      },
      { embeds: [embed], components },
    );
    if (outcome.status !== "sent") {
      log.warn("Failed to send embed through persona delivery", outcome.error, {
        metadata: { outcome: outcome.status, channelId: channel.id },
      });
      return;
    }
    sentMessage = outcome.message;
    sentViaWebhook = outcome.receipt.route === "webhook";
  } else {
    sentMessage = await channel.send({ embeds: [embed], components });
    recordPersonaDelivery({
      messageId: sentMessage.id,
      channelId: sentMessage.channelId,
      route: "bot",
      webhookId: null,
      identity: {
        username: sentMessage.member?.displayName ?? sentMessage.author?.username,
        avatarUrl: sentMessage.member?.displayAvatarURL?.() ?? sentMessage.author?.displayAvatarURL?.(),
      },
      speaker: null,
    });
  }

  if (!sentMessage) return;
  const deliveredMessage = sentMessage;

  if (!disabledModalRow) return;

  const disableButtons = async (): Promise<void> => {
    if (sentViaWebhook) {
      const author = await resolveAuthoringWebhook(channel, deliveredMessage.webhookId, webhookContext?.webhook);
      if (!author) throw new Error("Authoring webhook unavailable for embed button edit");
      await author.editMessage(deliveredMessage.id, {
        embeds: [embed],
        components: [disabledModalRow],
        ...(threadId ? { threadId } : {}),
      });
      return;
    }
    await deliveredMessage.edit({ embeds: [embed], components: [disabledModalRow] });
  };

  modalButtons.attach(deliveredMessage, disableButtons);
}

export function prepareEmbedModalButtons(
  locale: string,
  options: Pick<StandardEmbedOptions, "tipKeys" | "tipVars" | "restrictedDetail">,
  logLabel: string,
): {
  components: ActionRowBuilder<ButtonBuilder>[];
  disabledRow?: ActionRowBuilder<ButtonBuilder>;
  attach(message: Message, disableButtons: () => Promise<void>): void;
} {
  const tipText = options.tipKeys?.length ? createTipText(locale, options.tipKeys, options.tipVars) : null;
  const { restrictedDetail } = options;
  const buttons = [
    ...(tipText ? [{ customId: TIP_DETAILS_BUTTON_ID, label: localizer(locale, "genai.tips.button") }] : []),
    ...(restrictedDetail
      ? [{ customId: ERROR_DETAIL_BUTTON_ID, label: localizer(locale, "genai.error_detail.button") }]
      : []),
  ];
  if (buttons.length === 0) return { components: [], attach: () => undefined };
  return {
    components: [buildTextDisplayModalRow(buttons)],
    disabledRow: buildTextDisplayModalRow(buttons, true),
    attach(message, disableButtons) {
      if (tipText) {
        attachTextDisplayModalCollector({
          message,
          customId: TIP_DETAILS_BUTTON_ID,
          render: (viewerLocale) => ({
            title: localizer(viewerLocale, "genai.tips.title"),
            content: createTipText(viewerLocale, options.tipKeys ?? [], options.tipVars) ?? tipText,
          }),
          timeoutMs: TIP_BUTTON_TIMEOUT_MS,
          logLabel: `${logLabel} tips`,
          onExpire: disableButtons,
        });
      }
      if (restrictedDetail) {
        // Both collectors share one timeout, so only one of them disables the shared row.
        attachTextDisplayModalCollector({
          message,
          customId: ERROR_DETAIL_BUTTON_ID,
          render: (viewerLocale) => ({
            title: localizer(viewerLocale, "genai.error_detail.title"),
            content: restrictedDetail.content,
          }),
          timeoutMs: TIP_BUTTON_TIMEOUT_MS,
          logLabel: `${logLabel} detail`,
          access: restrictedDetail.access,
          onExpire: tipText ? undefined : disableButtons,
        });
      }
    },
  };
}

const TRANSLATION_TIMEOUT = 90000;
export async function sendTranslationEmbed(message: Message, options: TranslationEmbedOptions): Promise<void> {
  const { translations, initialProvider = TranslationProvider.GOOGLE, timeout = TRANSLATION_TIMEOUT } = options;

  const createButtons = (activeProvider: Provider) => {
    const buttons = Object.values(TranslationProvider).map((provider) => {
      return new ButtonBuilder()
        .setLabel(provider.charAt(0).toUpperCase() + provider.slice(1))
        .setStyle(ButtonStyle.Secondary)
        .setCustomId(`${provider}-trans`)
        .setDisabled(provider === activeProvider);
    });
    return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  };

  const embed = new EmbedBuilder()
    .setColor(TRANSLATOR_COLORS[initialProvider])
    .setDescription(translations[initialProvider]);

  const sentMessage = await message.reply({
    embeds: [embed],
    components: [createButtons(initialProvider)],
  });

  const collector = sentMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: timeout,
  });

  collector.on("collect", async (interaction: ButtonInteraction) => {
    const provider = interaction.customId.split("-")[0] as Provider;

    embed.setColor(TRANSLATOR_COLORS[provider]);
    embed.setDescription(translations[provider]);

    await interaction.update({
      embeds: [embed],
      components: [createButtons(provider)],
    });
  });

  collector.on("end", async () => {
    const disabledButtons = createButtons(initialProvider);
    for (const button of disabledButtons.components) {
      button.setDisabled(true);
    }

    await sentMessage.edit({
      embeds: [embed],
      components: [disabledButtons],
    });
  });
}
