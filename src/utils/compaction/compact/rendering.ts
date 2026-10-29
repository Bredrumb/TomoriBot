import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder } from "discord.js";
import { isDiscordLocaleCode } from "@/constants/locales";
import { buildInteractionRouteId } from "@/utils/discord/interactions/routeRegistry";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

export function buildConversationEmbed(locale: string, summaryText: string, refresh: boolean): EmbedBuilder {
  const title = refresh
    ? localizer(locale, "commands.compact.summary_title_refreshed")
    : localizer(locale, "commands.compact.summary_title");

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(truncateEmbedDescription(summaryText))
    .setColor(ColorCode.SECTION);
}

export function buildRoleplayEmbeds(locale: string, summaryText: string, refresh: boolean): EmbedBuilder[] {
  const title = refresh
    ? localizer(locale, "commands.compact.roleplay_scene_title_refreshed")
    : localizer(locale, "commands.compact.roleplay_scene_title");

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(truncateEmbedDescription(summaryText))
    .setColor(ColorCode.SECTION);
  return [embed];
}

export function isDiscordThreadChannel(channel: unknown): boolean {
  if (!channel || typeof channel !== "object") return false;
  if ("isThread" in channel && typeof channel.isThread === "function") return channel.isThread();
  if (!("type" in channel)) return false;
  const channelType = Number((channel as { type: number }).type);
  return (
    channelType === ChannelType.PublicThread ||
    channelType === ChannelType.PrivateThread ||
    channelType === ChannelType.AnnouncementThread
  );
}

export function buildManualEmbed(locale: string, summaryText: string, refresh: boolean): EmbedBuilder {
  const title = refresh
    ? localizer(locale, "commands.compact.manual_entry_title_refreshed")
    : localizer(locale, "commands.compact.manual_entry_title");

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(truncateEmbedDescription(summaryText))
    .setColor(ColorCode.SECTION);
}

export const COMPACT_ROUTE_NAMESPACE = "compact";
export const COMPACT_ROUTE_VERSION = "v1";
export const COMPACT_EDIT_WINDOW_MS = 10 * 60 * 1000;

export type SummaryControlAction = "edit" | "save";

/**
 * Summary button state carried in each button's custom ID, so a click after a restart can repaint
 * the message without any in-memory record of it.
 */
export interface SummaryControls {
  locale: string;
  refresh: boolean;
  /** Unix seconds after which the Edit button is withdrawn. */
  editDeadline: number;
}

export function buildSummaryControlId(action: SummaryControlAction, controls: SummaryControls): string {
  return buildInteractionRouteId(
    COMPACT_ROUTE_NAMESPACE,
    COMPACT_ROUTE_VERSION,
    action,
    controls.locale,
    controls.refresh ? "1" : "0",
    String(controls.editDeadline),
  );
}

export function parseSummaryControlSegments(
  segments: readonly string[],
): { action: SummaryControlAction; controls: SummaryControls } | null {
  const [action, locale, refresh, deadline] = segments;
  if (action !== "edit" && action !== "save") return null;
  if (!locale || !isDiscordLocaleCode(locale)) return null;
  if (refresh !== "0" && refresh !== "1") return null;
  if (!deadline || !/^\d{1,12}$/.test(deadline)) return null;
  return { action, controls: { locale, refresh: refresh === "1", editDeadline: Number(deadline) } };
}

export function isSummaryEditWindowOpen(controls: SummaryControls, now = Date.now()): boolean {
  return now < controls.editDeadline * 1000;
}

/**
 * Sets the footer and buttons for one summary state. Saving withdraws both buttons, so an edit can
 * never make the message disagree with the stored document.
 */
export function renderSummaryMessage(
  embed: EmbedBuilder,
  controls: SummaryControls,
  saved: boolean,
  now = Date.now(),
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const { locale } = controls;
  const editable = !saved && isSummaryEditWindowOpen(controls, now);
  const footerParts: string[] = [];
  if (controls.refresh) footerParts.push(localizer(locale, "commands.compact.refresh_footer"));
  if (saved) {
    footerParts.push(localizer(locale, "commands.compact.add_to_docs_stored_footer"));
  } else if (editable) {
    footerParts.push(
      localizer(locale, "commands.compact.edit_footer", {
        deadline: formatDeadline(new Date(controls.editDeadline * 1000)),
      }),
    );
  } else {
    footerParts.push(localizer(locale, "commands.compact.add_to_docs_footer"));
  }
  embed.setFooter({ text: footerParts.join(" · ") });

  const buttons: ButtonBuilder[] = [];
  if (editable) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(buildSummaryControlId("edit", controls))
        .setLabel(localizer(locale, "commands.compact.edit_button_label"))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (!saved) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(buildSummaryControlId("save", controls))
        .setLabel(localizer(locale, "commands.compact.add_to_docs_button_label"))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  const components = buttons.length > 0 ? [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)] : [];
  return { embeds: [embed], components };
}

function formatDeadline(date: Date): string {
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getUTCFullYear());
  return `${hh}:${mm} ${dd}/${mo}/${yyyy}`;
}

function truncateEmbedDescription(text: string, maxLength = 4000): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}
