import { escapeMarkdown, type BaseGuildTextChannel } from "discord.js";
import type { StandardEmbedOptions } from "@/types/discord/embed";
import type { ToolContext } from "@/types/tool/interfaces";
import type { AssembledServerConfig } from "@/types/db/schema";
import { type ToolNoticeKey, TOOL_NOTICE_DEFINITIONS } from "@/constants/toolNotices";
import { sendStandardEmbed, type WebhookEmbedContext } from "@/utils/discord/embedHelper";
import { getOrCreateWebhook } from "@/utils/discord/webhook/lifecycle";
import { localizer } from "@/utils/text/localizer";
import { log } from "@/utils/misc/logger";

const HIDE_NOTICE_FOOTER_KEY = "tools.tool_notice.hide_footer";
const KILL_HINT_FOOTER_KEY = "tools.tool_notice.hide_footer_with_kill";
const IMAGE_NOTICE_PROMPT_PREVIEW_LENGTH = 700;

function resolveDescription(locale: string, options: StandardEmbedOptions): string {
  const baseDescription = options.description
    ? options.description
    : options.descriptionKey
      ? localizer(locale, options.descriptionKey, options.descriptionVars)
      : "";
  const existingFooter = options.footerKey ? localizer(locale, options.footerKey, options.footerVars) : "";

  return [baseDescription.trim(), existingFooter.trim()].filter((part) => part.length > 0).join(" ");
}

function buildToolNoticeOptions(
  locale: string,
  options: StandardEmbedOptions,
  sourceLine?: string,
  showKillHint?: boolean,
): StandardEmbedOptions {
  const description = resolveDescription(locale, options);
  const sourceDescription = sourceLine
    ? localizer(locale, "genai.thought_log.description", {
        source_line: sourceLine,
      })
    : "";

  return {
    ...options,
    description: [sourceDescription, description].filter((part) => part.length > 0).join("\n\n"),
    footerKey: showKillHint ? KILL_HINT_FOOTER_KEY : HIDE_NOTICE_FOOTER_KEY,
    footerVars: undefined,
  };
}

function getWebhookContext(context: ToolContext) {
  return {
    webhook: context.webhook,
    personaUsername: context.personaUsername,
    personaAvatarUrl: context.personaAvatarUrl,
  };
}

function isDMBasedChannel(channel: ToolContext["channel"]): boolean {
  return "isDMBased" in channel && typeof channel.isDMBased === "function" ? channel.isDMBased() : false;
}

function getSourceLine(context: ToolContext): string {
  return context.message?.url ?? context.channel.toString();
}

function truncateNoticeText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildLabeledGenerationNoticeDescription(
  locale: string,
  baseDescription: string,
  modelLineKey: string,
  promptLineKey: string,
  model: string,
  prompt: string,
  timingLine: string,
  extraLines: string[] = [],
  metadataExtraLines: string[] = [],
): string {
  const safeModel = `\`${escapeMarkdown(model.trim())}\``;
  const safePrompt = `\`${escapeMarkdown(truncateNoticeText(prompt, IMAGE_NOTICE_PROMPT_PREVIEW_LENGTH))}\``;
  const trimmedBaseDescription = baseDescription.trim();
  const trimmedTimingLine = timingLine.trim();
  const baseWithTiming =
    trimmedTimingLine.length === 0
      ? trimmedBaseDescription
      : /[.!?。]$/.test(trimmedBaseDescription)
        ? `${trimmedBaseDescription} ${trimmedTimingLine}`
        : locale.startsWith("ja")
          ? `${trimmedBaseDescription}。${trimmedTimingLine}`
          : `${trimmedBaseDescription}. ${trimmedTimingLine}`;
  const metadataLines = [
    localizer(locale, modelLineKey, { model: safeModel }),
    localizer(locale, promptLineKey, { prompt: safePrompt }),
    ...metadataExtraLines.map((line) => line.trim()).filter((line) => line.length > 0),
  ].filter((line) => line.length > 0);
  const trailingLines = extraLines.map((line) => line.trim()).filter((line) => line.length > 0);

  return [baseWithTiming, metadataLines.join("\n"), trailingLines.join("\n")]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

export function buildImageToolNoticeDescription(
  locale: string,
  baseDescription: string,
  model: string,
  prompt: string,
  timingLine: string,
  extraLines: string[] = [],
  metadataExtraLines: string[] = [],
): string {
  return buildLabeledGenerationNoticeDescription(
    locale,
    baseDescription,
    "tools.image.notice_model_line",
    "tools.image.notice_prompt_line",
    model,
    prompt,
    timingLine,
    extraLines,
    metadataExtraLines,
  );
}

export function buildReferencedMessageUrl(context: ToolContext, messageId: string): string | null {
  const trimmedMessageId = messageId.trim();
  if (!trimmedMessageId) {
    return null;
  }

  if (
    "guildId" in context.channel &&
    typeof context.channel.guildId === "string" &&
    context.channel.guildId.length > 0
  ) {
    return `https://discord.com/channels/${context.channel.guildId}/${context.channel.id}/${trimmedMessageId}`;
  }

  if (
    "isDMBased" in context.channel &&
    typeof context.channel.isDMBased === "function" &&
    context.channel.isDMBased()
  ) {
    return `https://discord.com/channels/@me/${context.channel.id}/${trimmedMessageId}`;
  }

  return null;
}

export function buildVideoToolNoticeDescription(
  locale: string,
  baseDescription: string,
  model: string,
  prompt: string,
  timingLine: string,
  extraLines: string[] = [],
): string {
  return buildLabeledGenerationNoticeDescription(
    locale,
    baseDescription,
    "tools.video.notice_model_line",
    "tools.video.notice_prompt_line",
    model,
    prompt,
    timingLine,
    extraLines,
  );
}

export function isNoticeEmbedVisible(config: AssembledServerConfig, key: ToolNoticeKey): boolean {
  return !(config.tool_notice_hidden_keys ?? []).includes(key);
}

export function isToolNoticeVisible(config: AssembledServerConfig, key: ToolNoticeKey): boolean {
  return isNoticeEmbedVisible(config, key);
}

export async function routeToolNoticeToThoughtLog(
  context: ToolContext,
  options: StandardEmbedOptions,
  logLabel: string,
): Promise<boolean> {
  const thoughtLogChannelId = context.tomoriState.config.thought_log_channel_disc_id;
  if (!thoughtLogChannelId) {
    return false;
  }

  const thoughtLogChannel = await context.client.channels.fetch(thoughtLogChannelId).catch(() => null);
  if (
    !thoughtLogChannel ||
    !("send" in thoughtLogChannel) ||
    typeof thoughtLogChannel.send !== "function" ||
    ("isDMBased" in thoughtLogChannel &&
      typeof thoughtLogChannel.isDMBased === "function" &&
      thoughtLogChannel.isDMBased())
  ) {
    log.warn(`${logLabel}: Thought log channel ${thoughtLogChannelId} is missing or unavailable. Skipping reroute.`);
    return false;
  }

  let rerouteWebhookContext: WebhookEmbedContext | undefined;
  if (context.personaUsername && "fetchWebhooks" in thoughtLogChannel && "createWebhook" in thoughtLogChannel) {
    const webhookResult = await getOrCreateWebhook(thoughtLogChannel as BaseGuildTextChannel);
    if (webhookResult.webhook) {
      rerouteWebhookContext = {
        webhook: webhookResult.webhook,
        personaUsername: context.personaUsername,
        personaAvatarUrl: context.personaAvatarUrl,
      };
    } else if (context.webhook) {
      log.warn(
        `${logLabel}: Failed to get webhook for thought log channel ${thoughtLogChannelId}. Falling back to bot send.`,
      );
    }
  }

  await sendStandardEmbed(
    thoughtLogChannel as BaseGuildTextChannel,
    context.locale,
    buildToolNoticeOptions(context.locale, options, getSourceLine(context), context.showKillHint),
    rerouteWebhookContext,
  );

  return true;
}

export async function sendToolNotice(
  context: ToolContext,
  noticeKey: ToolNoticeKey,
  options: StandardEmbedOptions,
  logLabel: string,
): Promise<void> {
  if (context.suppressProgressNotices) return;
  try {
    const finalOptions = buildToolNoticeOptions(context.locale, options, undefined, context.showKillHint);
    if (isToolNoticeVisible(context.tomoriState.config, noticeKey)) {
      await sendStandardEmbed(context.channel, context.locale, finalOptions, getWebhookContext(context));
      return;
    }

    if (isDMBasedChannel(context.channel)) {
      return;
    }

    const privateChannelIds = context.tomoriState.config.private_channel_ids ?? [];
    // Threads whose parent channel is private must also be suppressed from the thought log.
    const toolNoticeParentId = context.channel.isThread() ? context.channel.parentId : null;
    if (
      privateChannelIds.includes(context.channel.id) ||
      (toolNoticeParentId !== null && privateChannelIds.includes(toolNoticeParentId))
    ) {
      return;
    }

    await routeToolNoticeToThoughtLog(context, options, logLabel);
  } catch (error) {
    log.warn(`${logLabel}: Failed to send tool notice embed`, error as Error);
  }
}

export async function routeHiddenToolNotice(
  context: ToolContext,
  options: StandardEmbedOptions,
  logLabel: string,
): Promise<boolean> {
  if (context.suppressProgressNotices) return false;

  if (isDMBasedChannel(context.channel)) {
    return false;
  }

  const privateChannelIds = context.tomoriState.config.private_channel_ids ?? [];
  const toolNoticeParentId = context.channel.isThread() ? context.channel.parentId : null;
  if (
    privateChannelIds.includes(context.channel.id) ||
    (toolNoticeParentId !== null && privateChannelIds.includes(toolNoticeParentId))
  ) {
    return false;
  }

  try {
    return await routeToolNoticeToThoughtLog(context, options, logLabel);
  } catch (error) {
    log.warn(`${logLabel}: Failed to route hidden tool notice`, error as Error);
    return false;
  }
}

export async function sendToolProgressNotice(
  context: ToolContext,
  noticeKey: ToolNoticeKey,
  options: StandardEmbedOptions,
  logLabel: string,
): Promise<void> {
  await sendToolNotice(context, noticeKey, options, logLabel);
}

export { TOOL_NOTICE_DEFINITIONS };
