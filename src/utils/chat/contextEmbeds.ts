import type { Embed } from "discord.js";
import type { SimplifiedMessageForContext } from "@/utils/text/contextBuilder";
import {
  checkTargetEmbedTitle,
  formatSystemProducedEmbedHint,
  processLinkEmbed,
} from "@/utils/discord/embedClassifier";
import { ColorCode } from "@/utils/misc/logger";
import { getSupportedLocales, localizer } from "@/utils/text/localizer";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";
import { truncateForSystemContext } from "@/utils/chat/contextDirectives";

const SELF_DEBUG_ERROR_EMBED_MAX_DESCRIPTION_LENGTH = 1200;
const SELF_DEBUG_ERROR_EMBED_MAX_FIELD_COUNT = 6;
const SELF_DEBUG_ERROR_EMBED_MAX_FIELD_VALUE_LENGTH = 280;
const ERROR_EMBED_COLOR_DECIMAL = Number.parseInt(ColorCode.ERROR.replace("#", ""), 16);

export function processEmbedsFromMessage(args: {
  embeds: readonly Embed[];
  content: string;
  imageAttachments: SimplifiedMessageForContext["imageAttachments"];
  isTomoriAuthoredMessage: boolean;
  selfDebugEnabled: boolean;
  tomoriNickname: string | null | undefined;
}): { content: string; processedSystemEmbed: boolean } {
  let content = args.content;
  let processedSystemEmbed = false;

  for (const embed of args.embeds) {
    const embedCheck = checkTargetEmbedTitle(embed.title);
    if (embedCheck.isTarget && embed.description) {
      const embedContent = formatTargetEmbedForContext(embed, embedCheck.type, args.tomoriNickname);
      content = content ? `${content}\n${embedContent}` : embedContent;
      processedSystemEmbed = true;
      continue;
    }

    if (args.selfDebugEnabled && args.isTomoriAuthoredMessage) {
      const diagnosticEmbedContent = formatTomoriSelfDebugEmbedAsSystemMessage(embed);
      if (diagnosticEmbedContent) {
        content = content ? `${content}\n${diagnosticEmbedContent}` : diagnosticEmbedContent;
        processedSystemEmbed = true;
      }
      continue;
    }

    if (!args.isTomoriAuthoredMessage) {
      const linkEmbedData = processLinkEmbed(embed);
      if (!linkEmbedData.isLinkPreview) {
        continue;
      }
      if (linkEmbedData.textContent) {
        content = content ? `${content}\n${linkEmbedData.textContent}` : linkEmbedData.textContent;
      }
      if (linkEmbedData.imageInfo) {
        args.imageAttachments.push(linkEmbedData.imageInfo);
      }
      if (linkEmbedData.thumbnailInfo) {
        args.imageAttachments.push(linkEmbedData.thumbnailInfo);
      }
    }
  }

  return { content, processedSystemEmbed };
}

function formatTargetEmbedForContext(
  embed: Embed,
  embedType: ReturnType<typeof checkTargetEmbedTitle>["type"],
  tomoriNickname: string | null | undefined,
): string {
  if (embedType === "system_injection" || embedType === "compact_summary" || embedType === "compact_refresh") {
    const titleLine =
      (embedType === "compact_summary" || embedType === "compact_refresh") && embed.title ? `## ${embed.title}\n` : "";
    return `[System: ${titleLine}${embed.description}]`;
  }

  let cleanedDescription = embed.description ?? "";
  if (tomoriNickname) {
    const botNamePattern = new RegExp(`^${escapeRegExp(tomoriNickname)}:\\s*`, "i");
    if (botNamePattern.test(cleanedDescription)) {
      cleanedDescription = cleanedDescription.replace(botNamePattern, "").trim();
    }
  }

  const includeTitleInEmbedContent = embedType === "memory_learning" || embedType === "reminder_set";
  const titleLine = includeTitleInEmbedContent && embed.title ? `${embed.title}\n` : "";
  const embedBody = `${titleLine}${cleanedDescription}`;
  return embedType === "memory_learning" || embedType === "reward" || embedType === "punish"
    ? `[System: ${embedBody}]`
    : formatSystemProducedEmbedHint(embedBody);
}

function checkSelfDebugDiagnosticEmbedTitle(embedTitle: string | null): boolean {
  if (!embedTitle) return false;

  for (const supportedLocale of getSupportedLocales()) {
    const diagnosticTitles = [
      localizer(supportedLocale, "genai.fallback_used_title"),
      localizer(supportedLocale, "genai.error_stream_timeout_title"),
      localizer(supportedLocale, "genai.empty_response_title"),
      localizer(supportedLocale, "genai.max_iterations_title"),
      localizer(supportedLocale, "genai.no_response_title"),
    ];
    if (diagnosticTitles.includes(embedTitle)) {
      return true;
    }
  }

  return false;
}

function shouldIncludeSelfDebugEmbed(embed: Embed): boolean {
  return embed.color === ERROR_EMBED_COLOR_DECIMAL || checkSelfDebugDiagnosticEmbedTitle(embed.title);
}

function formatTomoriSelfDebugEmbedAsSystemMessage(embed: Embed): string | null {
  if (!shouldIncludeSelfDebugEmbed(embed)) {
    return null;
  }

  const isErrorEmbed = embed.color === ERROR_EMBED_COLOR_DECIMAL;
  const lines: string[] = [isErrorEmbed ? "Tomori emitted an error embed." : "Tomori emitted a diagnostic embed."];

  if (embed.title?.trim()) {
    lines.push(`Title: ${truncateForSystemContext(embed.title, 160)}`);
  }
  if (embed.description?.trim()) {
    lines.push(
      `Description: ${truncateForSystemContext(embed.description, SELF_DEBUG_ERROR_EMBED_MAX_DESCRIPTION_LENGTH)}`,
    );
  }
  if (embed.author?.name?.trim()) {
    lines.push(`Embed Author: ${truncateForSystemContext(embed.author.name, 120)}`);
  }

  if (embed.fields.length > 0) {
    const fieldSummary = embed.fields
      .slice(0, SELF_DEBUG_ERROR_EMBED_MAX_FIELD_COUNT)
      .map((field) => {
        const fieldName = field.name?.trim() ? field.name : "Field";
        return `${truncateForSystemContext(fieldName, 90)}: ${truncateForSystemContext(field.value, SELF_DEBUG_ERROR_EMBED_MAX_FIELD_VALUE_LENGTH)}`;
      })
      .join(" | ");
    if (fieldSummary) {
      lines.push(`Fields: ${fieldSummary}`);
    }
    if (embed.fields.length > SELF_DEBUG_ERROR_EMBED_MAX_FIELD_COUNT) {
      lines.push(`Additional fields omitted: ${embed.fields.length - SELF_DEBUG_ERROR_EMBED_MAX_FIELD_COUNT}.`);
    }
  }

  if (embed.footer?.text?.trim()) {
    lines.push(`Footer: ${truncateForSystemContext(embed.footer.text, 220)}`);
  }

  return `[System: ${lines.join("\n")}]`;
}
