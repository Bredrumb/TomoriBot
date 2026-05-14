/**
 * Shared embed classification and link-preview extraction utilities.
 *
 * Mirrors the local helpers in `src/events/messageCreate/tomoriChat.ts`
 * (`checkTargetEmbedTitle`, `processLinkEmbed`, `formatSystemProducedEmbedHint`)
 * so they can be reused by offline/debug consumers like `/tool prompt snapshot`
 * without duplicating the locale-scanning logic.
 *
 * The canonical runtime usage still lives inline in tomoriChat.ts — these
 * helpers are feature-parity copies of that behavior.
 */

import type { Embed } from "discord.js";
import { localizer, getSupportedLocales, getLocaleSubKeys } from "@/utils/text/localizer";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";

/** Target embed classifications recognized by the chat pipeline. */
export type TargetEmbedType =
  | "memory_learning"
  | "reset"
  | "reminder_set"
  | "system_injection"
  | "compact_summary"
  | "compact_refresh"
  | "reward"
  | "punish";

export type TargetEmbedCheck = { isTarget: true; type: TargetEmbedType } | { isTarget: false; type: null };

/**
 * Returns true when the localized template matches the given title literally,
 * or (when the template contains `{placeholder}` slots) when the title matches
 * the regex form of the template. Used for reminder titles which embed names.
 */
function matchesLocalizedTitleTemplate(template: string, actualTitle: string): boolean {
  if (!template.includes("{")) {
    return actualTitle === template;
  }
  const pattern = new RegExp(`^${escapeRegExp(template).replace(/\\\{[^}]+\\\}/g, ".+?")}$`);
  return pattern.test(actualTitle);
}

/**
 * Classifies an embed title against the set of bot-produced titles (memory
 * learning, reset, reminder-set, system injection, compact summary/refresh,
 * reward, punish). Scans across ALL supported locales so cross-locale servers
 * still detect bot-produced embeds correctly.
 *
 * @param embedTitle - The embed title to check
 * @returns An object with isTarget and the matched type
 */
export function checkTargetEmbedTitle(embedTitle: string | null | undefined): TargetEmbedCheck {
  if (!embedTitle) return { isTarget: false, type: null };

  for (const supportedLocale of getSupportedLocales()) {
    // 1. Memory learning titles (server + personal, all CRUD variants)
    const memoryLearningTitles = [
      localizer(supportedLocale, "genai.self_teach.server_memory_learned_title"),
      localizer(supportedLocale, "genai.self_teach.server_memory_updated_title"),
      localizer(supportedLocale, "genai.self_teach.server_memory_deleted_title"),
      localizer(supportedLocale, "genai.self_teach.personal_memory_learned_title"),
      localizer(supportedLocale, "genai.self_teach.personal_memory_updated_title"),
      localizer(supportedLocale, "genai.self_teach.personal_memory_deleted_title"),
    ];

    const reminderSetTitles = [
      localizer(supportedLocale, "reminders.reminder_set_title"),
      localizer(supportedLocale, "reminders.recurring_task_set_title"),
      localizer(supportedLocale, "reminders.task_set_title"),
    ];

    if (memoryLearningTitles.some((t) => matchesLocalizedTitleTemplate(t, embedTitle))) {
      return { isTarget: true, type: "memory_learning" };
    }

    // 2. Reset and system-injection titles
    if (embedTitle === localizer(supportedLocale, "commands.tool.refresh.title")) {
      return { isTarget: true, type: "reset" };
    }
    if (embedTitle === localizer(supportedLocale, "commands.bot.impersonate.system_title")) {
      return { isTarget: true, type: "system_injection" };
    }

    // 3. Reward/punish titles — dynamically discovered from locale sub-keys
    //    so new reward/punish commands are automatically recognized
    const rewardNames = getLocaleSubKeys(supportedLocale, "commands.reward");
    const rewardTitles = rewardNames
      .map((name) => localizer(supportedLocale, `commands.reward.${name}.embed_title`))
      .filter((t) => !t.includes("."));
    if (rewardTitles.some((t) => embedTitle === t)) {
      return { isTarget: true, type: "reward" };
    }

    const punishNames = getLocaleSubKeys(supportedLocale, "commands.punish");
    const punishTitles = punishNames
      .map((name) => localizer(supportedLocale, `commands.punish.${name}.embed_title`))
      .filter((t) => !t.includes("."));
    if (punishTitles.some((t) => embedTitle === t)) {
      return { isTarget: true, type: "punish" };
    }

    // 4. Compact summary (conversation + scene) and compact refresh variants
    const compactSummaryTitle = localizer(supportedLocale, "commands.tool.compact.summary_title");
    const compactSummaryRefreshed = localizer(supportedLocale, "commands.tool.compact.summary_title_refreshed");
    const compactSceneTitle = localizer(supportedLocale, "commands.tool.compact.roleplay_scene_title");
    const compactSceneRefreshed = localizer(supportedLocale, "commands.tool.compact.roleplay_scene_title_refreshed");
    const compactCharacterPrefix = localizer(supportedLocale, "commands.tool.compact.roleplay_character_title_prefix");

    if (embedTitle === compactSummaryTitle || embedTitle === compactSceneTitle) {
      return { isTarget: true, type: "compact_summary" };
    }
    if (embedTitle === compactSummaryRefreshed || embedTitle === compactSceneRefreshed) {
      return { isTarget: true, type: "compact_refresh" };
    }
    if (compactCharacterPrefix && embedTitle.startsWith(compactCharacterPrefix)) {
      return { isTarget: true, type: "compact_summary" };
    }

    // 5. Reminder/task set confirmations
    if (reminderSetTitles.some((t) => matchesLocalizedTitleTemplate(t, embedTitle))) {
      return { isTarget: true, type: "reminder_set" };
    }
  }

  return { isTarget: false, type: null };
}

export type LinkPreviewImageInfo = {
  url: string;
  proxyUrl: string;
  mimeType: string | null;
  filename: string;
};

export type LinkPreviewResult = {
  isLinkPreview: boolean;
  textContent: string | null;
  imageInfo: LinkPreviewImageInfo | null;
  thumbnailInfo: LinkPreviewImageInfo | null;
};

/**
 * Extracts text + image content from an auto-generated Discord link preview
 * embed (e.g., Twitter, YouTube, article card). Returns `isLinkPreview: false`
 * for empty embeds or for embeds already classified as bot-produced (per
 * `checkTargetEmbedTitle`).
 *
 * Kept byte-for-byte consistent with `processLinkEmbed` in tomoriChat.ts so
 * snapshot output matches live-chat conversion.
 */
export function processLinkEmbed(embed: Embed): LinkPreviewResult {
  // 1. Skip entirely empty embeds
  const hasContent = embed.url || embed.title || embed.description || embed.author?.name || embed.fields.length > 0;
  if (!hasContent) {
    return { isLinkPreview: false, textContent: null, imageInfo: null, thumbnailInfo: null };
  }

  // 2. Skip bot-produced system embeds — those are handled separately
  const embedCheck = checkTargetEmbedTitle(embed.title);
  if (embedCheck.isTarget) {
    return { isLinkPreview: false, textContent: null, imageInfo: null, thumbnailInfo: null };
  }

  // 3. Assemble text content from available fields
  const contentParts: string[] = [];
  if (embed.author?.name) contentParts.push(embed.author.name);
  if (embed.title) contentParts.push(embed.title);
  if (embed.description) {
    const maxDescLength = 500;
    contentParts.push(
      embed.description.length > maxDescLength
        ? `${embed.description.substring(0, maxDescLength)}...`
        : embed.description,
    );
  }
  if (embed.fields.length > 0) {
    for (const field of embed.fields) {
      if (field.name || field.value) {
        contentParts.push(field.name && field.value ? `${field.name}: ${field.value}` : field.name || field.value);
      }
    }
  }

  const textContent =
    contentParts.length > 0 ? `[System: Link preview embed content: ${contentParts.join(" - ")}]` : "";

  // 4. Derive image info from embed.image (preferred) or embed.thumbnail (fallback)
  const imageInfo = embed.image?.url ? deriveEmbedImageInfo(embed.image.url, embed.image.proxyURL ?? null) : null;
  const thumbnailInfo =
    !imageInfo && embed.thumbnail?.url
      ? deriveEmbedImageInfo(embed.thumbnail.url, embed.thumbnail.proxyURL ?? null)
      : null;

  return {
    isLinkPreview: true,
    textContent: textContent.trim() || null,
    imageInfo,
    thumbnailInfo,
  };
}

function deriveEmbedImageInfo(rawUrl: string, proxyUrl: string | null): LinkPreviewImageInfo | null {
  try {
    const parsed = new URL(rawUrl);
    let filename = parsed.pathname.split("/").pop() || "embed_image";
    // Strip social-media size suffixes (":large", ":medium", ":small", ":orig")
    filename = filename.replace(/:(large|medium|small|orig)$/, "");

    let mimeType = "image/jpeg";
    const extension = filename.split(".").pop()?.toLowerCase();
    switch (extension) {
      case "png":
        mimeType = "image/png";
        break;
      case "gif":
        mimeType = "image/gif";
        break;
      case "webp":
        mimeType = "image/webp";
        break;
      default:
        mimeType = "image/jpeg";
        break;
    }

    if (!filename.includes(".")) filename = `${filename}.jpg`;

    return {
      url: rawUrl,
      proxyUrl: proxyUrl || rawUrl,
      mimeType,
      filename,
    };
  } catch {
    return null;
  }
}

/**
 * Mirrors `formatSystemProducedEmbedHint` in tomoriChat.ts. Wraps an embed
 * body in the `[System: ...]`-adjacent form that prefixes system-produced
 * embeds before sending to the LLM.
 */
export function formatSystemProducedEmbedHint(embedBody: string): string {
  return `[System: The following content came from a system-produced embed]\n${embedBody}`;
}
