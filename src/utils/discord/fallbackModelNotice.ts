import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, type Message, MessageFlags } from "discord.js";
import type { LlmRow } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import { createStandardEmbed, truncateForEmbedDescription } from "@/utils/discord/embedHelper";
import { isNoticeEmbedVisible, routeHiddenToolNotice } from "@/utils/discord/toolProgressNotice";
import { sendWebhookMessageWithIdentity } from "@/utils/discord/webhook/personaDispatch";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

const FALLBACK_DETAILS_BUTTON_ID = "fallback_notice_details";
const DEFAULT_FALLBACK_NOTICE_BUTTON_TIMEOUT_MS = 86_400_000;
const FALLBACK_NOTICE_BUTTON_TIMEOUT_MS = parsePositiveIntegerEnv(
  process.env.FALLBACK_NOTICE_BUTTON_TIMEOUT_MS,
  DEFAULT_FALLBACK_NOTICE_BUTTON_TIMEOUT_MS,
);

export interface FallbackNoticeAttempt {
  modelCodename: string;
  errorDetail: string;
}

interface SendFallbackModelUsageNoticeOptions {
  context: ToolContext;
  failures: FallbackNoticeAttempt[];
  successModel: LlmRow;
}

function parsePositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Characters reserved for the description text wrapping the failure list (slot/model prefix line),
// so the joined list plus that prefix stays within Discord's embed description limit.
const FAILURE_LIST_DESCRIPTION_RESERVE = 256;

function buildFailureList(locale: string, failures: FallbackNoticeAttempt[]): string {
  const failureList = failures
    .map((failure, index) =>
      localizer(locale, "genai.fallback_used_failure_line", {
        index: index + 1,
        model: `\`${failure.modelCodename}\``,
        error_detail: failure.errorDetail,
      }),
    )
    .join("\n");

  // Cap the combined list to Discord's embed description limit; verbose provider messages across
  // several fallback failures can otherwise overflow the embed.
  return truncateForEmbedDescription(failureList, FAILURE_LIST_DESCRIPTION_RESERVE);
}

function resolveFallbackSlot(context: ToolContext, successModel: LlmRow, failures: FallbackNoticeAttempt[]): number {
  const configuredFallbackIndex =
    context.tomoriState.fallback_llms?.findIndex((llm) => llm.llm_id === successModel.llm_id) ?? -1;

  if (configuredFallbackIndex >= 0) {
    return configuredFallbackIndex + 1;
  }

  return Math.max(1, failures.length);
}

function createFallbackDetailsButton(locale: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(FALLBACK_DETAILS_BUTTON_ID)
      .setLabel(localizer(locale, "genai.fallback_used_details_button"))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

export async function sendFallbackModelUsageNotice({
  context,
  failures,
  successModel,
}: SendFallbackModelUsageNoticeOptions): Promise<void> {
  const slot = resolveFallbackSlot(context, successModel, failures);
  const detailsOptions = {
    titleKey: "genai.fallback_used_title",
    descriptionKey: "genai.fallback_used_details_description",
    descriptionVars: {
      slot,
      success_model: successModel.llm_codename,
      failure_list: buildFailureList(context.locale, failures),
    },
    color: ColorCode.INFO,
  } as const;

  if (!isNoticeEmbedVisible(context.tomoriState.config, "fallback_model_usage")) {
    await routeHiddenToolNotice(context, detailsOptions, "Fallback model usage notice");
    return;
  }

  const detailsEmbed = createStandardEmbed(context.locale, {
    ...detailsOptions,
    footerKey: "genai.fallback_used_hide_footer",
  });

  try {
    const buttonRow = createFallbackDetailsButton(context.locale);
    const disabledButtonRow = createFallbackDetailsButton(context.locale, true);

    // Resolve thread ID — webhooks targeting a parent channel need it to post into a thread.
    const threadId =
      "isThread" in context.channel && typeof context.channel.isThread === "function" && context.channel.isThread()
        ? context.channel.id
        : undefined;

    let noticeMessage: Message;

    if (context.webhook && context.personaUsername) {
      // Send through the persona/user-impersonation webhook so the button appears
      // as belonging to the same identity that delivered the AI response.
      noticeMessage = await sendWebhookMessageWithIdentity(
        context.webhook,
        {
          components: [buttonRow],
          ...(threadId ? { threadId } : {}),
        },
        { username: context.personaUsername, avatarUrl: context.personaAvatarUrl },
        threadId ?? context.webhook.channelId ?? context.webhook.id,
      );
    } else {
      noticeMessage = await context.channel.send({ components: [buttonRow] });
    }

    const collector = noticeMessage.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: FALLBACK_NOTICE_BUTTON_TIMEOUT_MS,
      filter: (interaction) => interaction.customId === FALLBACK_DETAILS_BUTTON_ID && !interaction.user.bot,
    });

    collector.on("collect", async (interaction) => {
      try {
        await interaction.reply({
          embeds: [detailsEmbed],
          flags: MessageFlags.Ephemeral,
        });
      } catch (error) {
        log.warn("Fallback model details button reply failed", error as Error);
      }
    });

    collector.on("end", async () => {
      // Webhook messages must be edited via the webhook token, not the bot token.
      if (context.webhook) {
        await context.webhook
          .editMessage(noticeMessage.id, {
            components: [disabledButtonRow],
            ...(threadId ? { threadId } : {}),
          })
          .catch((err: unknown) =>
            log.warn("[FallbackNotice] Failed to disable buttons via webhook after collector end", err),
          );
      } else {
        await noticeMessage
          .edit({ components: [disabledButtonRow] })
          .catch((err: unknown) => log.warn("[FallbackNotice] Failed to disable buttons after collector end", err));
      }
    });
  } catch (error) {
    log.warn("Failed to send compact fallback model notice", error as Error);
  }
}
