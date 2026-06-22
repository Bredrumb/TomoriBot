/**
 * Shared building blocks for the `/stats` dashboard (Phase 2 presentation layer).
 *
 * - Timeframe → window resolution (daily-bucket floor; see plans/stat-tracking.md §4).
 * - Per-view tab builders (personal / persona / server) that turn StatRepository
 *   reads into localized SummaryEmbedOptions "tabs".
 * - A public, invoker-controlled tabbed dashboard renderer: a row of named category
 *   buttons swaps which tab embed is shown (not item pagination — a tabbed view).
 *
 * All token/cost figures are CHARACTER-ESTIMATES (see tokenEstimate / postTurnEffects):
 * rough stats only, surfaced as such in the footer.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { SummaryEmbedOptions } from "@/types/discord/embed";
import { statRepository } from "@/utils/db/repositories";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { createSummaryEmbed } from "@/utils/discord/embedHelper";
import { localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";

// ── Timeframe ─────────────────────────────────────────────────────────────────

/** Selectable time windows. `all_time` omits the bucket floor entirely. */
export type Timeframe = "today" | "week" | "month" | "year" | "all_time";

/** The choice values offered by the `timeframe` slash option, in display order. */
export const TIMEFRAME_VALUES: Timeframe[] = ["today", "week", "month", "year", "all_time"];

/** Scope choice for the personal view: current server vs. across all servers. */
export type StatsScope = "this_server" | "global";

/** Dashboard collector lifetime (env-configurable per CLAUDE.md rule #6). */
const DASHBOARD_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.STATS_DASHBOARD_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 300_000;
})();

/**
 * Resolves a timeframe to a `bucket >= from` floor (YYYY-MM-DD, UTC), or undefined
 * for all-time. "today" is the current UTC day only — the daily bucket grain cannot
 * express a rolling 24h, so the option is labelled "Today" rather than "24 hours".
 */
export function resolveWindowFrom(timeframe: Timeframe): string | undefined {
  if (timeframe === "all_time") return undefined;
  const now = new Date();
  const floor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  switch (timeframe) {
    case "today":
      break;
    case "week":
      floor.setUTCDate(floor.getUTCDate() - 6); // last 7 days incl. today
      break;
    case "month":
      floor.setUTCDate(floor.getUTCDate() - 29); // last 30 days incl. today
      break;
    case "year":
      floor.setUTCFullYear(floor.getUTCFullYear() - 1);
      break;
  }
  return floor.toISOString().split("T")[0];
}

// ── Small formatting helpers ───────────────────────────────────────────────────

/** Locale-grouped integer (e.g. 12,345). */
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** USD cost with 4 decimals (estimates are small). */
function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

/** Renders a ranked "1. label: `count`" list, or the localized empty placeholder. */
function rankedList(locale: string, entries: Array<{ label: string; count: number }>): string {
  if (entries.length === 0) return localizer(locale, "commands.stats.empty");
  return entries.map((e, i) => `**${i + 1}.** ${e.label}: \`${fmtInt(e.count)}\``).join("\n");
}

/** Index of the highest-count key in a numeric record, or null when empty. */
function peakKey(record: Record<number, number>): number | null {
  let best: number | null = null;
  let bestCount = -1;
  for (const [key, count] of Object.entries(record)) {
    if (count > bestCount) {
      bestCount = count;
      best = Number(key);
    }
  }
  return best;
}

/** Resolves a persona lineage id to its nickname from the server's personas. */
function lineageLabel(locale: string, names: Map<number, string>, lineageId: number): string {
  return names.get(lineageId) ?? localizer(locale, "commands.stats.unknown_persona", { id: lineageId });
}

/**
 * Builds a lineage→nickname map from the guild's cached personas. `loadAllForServer`
 * returns the main persona first, so we keep the FIRST nickname seen per lineage:
 * when a renamed/forked persona shares a lineage with a former main (copy-on-write),
 * the current main's name wins instead of a stale alter's (e.g. "Ellen", not "Lucoa").
 */
async function resolvePersonaNames(guildId: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const personas = await getCachedAllPersonas(guildId);
    for (const persona of personas) {
      if (typeof persona.persona_lineage_id === "number" && !map.has(persona.persona_lineage_id)) {
        map.set(persona.persona_lineage_id, persona.persona_nickname);
      }
    }
  } catch (error) {
    log.warn(`resolvePersonaNames: failed for guild ${guildId}`, error as Error);
  }
  return map;
}

/** Formats the peak hour-of-day, shifting by a personal UTC offset when provided. */
function formatPeakHour(locale: string, hour: number | null, offsetHours?: number | null): string {
  if (hour === null) return localizer(locale, "commands.stats.empty");
  const shifted = offsetHours ? (((hour + offsetHours) % 24) + 24) % 24 : hour;
  const suffix = offsetHours ? localizer(locale, "commands.stats.local_suffix") : "UTC";
  return `${String(shifted).padStart(2, "0")}:00 ${suffix}`;
}

/** Formats the peak weekday from the histogram using localized short day names. */
function formatPeakWeekday(locale: string, byWeekday: Record<number, number>): string {
  const peak = peakKey(byWeekday);
  if (peak === null) return localizer(locale, "commands.stats.empty");
  const names = localizer(locale, "commands.stats.weekday_names").split(",");
  return names[peak] ?? String(peak);
}

// ── Shared field helpers ───────────────────────────────────────────────────────

type StatField = NonNullable<SummaryEmbedOptions["fields"]>[number];

/** A single-line stat field (localized name + computed value). */
function statField(nameKey: string, value: string, inline = true): StatField {
  return { nameKey, value: value || "(None)", inline };
}

// ── Dashboard tab + renderer ────────────────────────────────────────────────────

/** One dashboard tab: a category button plus the embed it reveals. */
export interface StatsTab {
  /** Stable id used in the button custom_id and to locate the tab on click. */
  id: string;
  /** Locale key for the button label. */
  labelKey: string;
  /** The embed shown when this tab is active. */
  page: SummaryEmbedOptions;
}

/** Builds the rows of named category buttons (≤5 per row), active tab disabled. */
function buildTabRows(
  interactionId: string,
  tabs: StatsTab[],
  activeIndex: number,
  locale: string,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  for (let i = 0; i < tabs.length; i += 5) {
    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>();
    tabs.slice(i, i + 5).forEach((tab, j) => {
      const index = i + j;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`stats:${interactionId}:${tab.id}`)
          .setLabel(localizer(locale, tab.labelKey))
          .setStyle(index === activeIndex ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(index === activeIndex),
      );
    });
    rows.push(row);
  }
  return rows;
}

/**
 * Renders a public, invoker-controlled tabbed dashboard. The interaction MUST already
 * be acknowledged with a PUBLIC deferral (the caller defers before its DB reads), so
 * this uses editReply for the first paint and `update` for tab switches.
 *
 * @param interaction - The acknowledged (publicly deferred) slash or button interaction.
 * @param invokerId   - Discord id allowed to operate the tab buttons.
 * @param locale      - Active locale.
 * @param tabs        - The tabs to render (first is shown initially).
 */
export async function renderStatsDashboard(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  invokerId: string,
  locale: string,
  tabs: StatsTab[],
): Promise<void> {
  if (tabs.length === 0) return;
  let activeIndex = 0;

  const firstEmbed = createSummaryEmbed(locale, tabs[activeIndex].page);
  const message = (await interaction.editReply({
    embeds: [firstEmbed],
    components: buildTabRows(interaction.id, tabs, activeIndex, locale),
  })) as Message;

  // Tab-switch loop: keep collecting the invoker's button presses until timeout.
  while (true) {
    let button: ButtonInteraction;
    try {
      button = await message.awaitMessageComponent({
        filter: (i) => i.user.id === invokerId && i.customId.startsWith(`stats:${interaction.id}:`),
        componentType: ComponentType.Button,
        time: DASHBOARD_TIMEOUT_MS,
      });
    } catch {
      break; // collector timed out
    }

    const tabId = button.customId.split(":")[2];
    const nextIndex = tabs.findIndex((t) => t.id === tabId);
    if (nextIndex >= 0) activeIndex = nextIndex;

    await button.update({
      embeds: [createSummaryEmbed(locale, tabs[activeIndex].page)],
      components: buildTabRows(interaction.id, tabs, activeIndex, locale),
    });
  }

  // Timeout: strip the buttons so the last viewed tab stays as a clean static embed.
  try {
    await interaction.editReply({
      embeds: [createSummaryEmbed(locale, tabs[activeIndex].page)],
      components: [],
    });
  } catch (error) {
    log.warn("renderStatsDashboard: failed to clear dashboard buttons after timeout", error as Error);
  }
}

// ── Per-view tab builders ───────────────────────────────────────────────────────

const FOOTER_KEY = "commands.stats.footer";
const DASHBOARD_COLOR = ColorCode.INFO;

/** Common page scaffolding (title + subtitle + footer) for a tab embed. */
function page(titleKey: string, subtitle: string, fields: StatField[]): SummaryEmbedOptions {
  return {
    titleKey,
    description: subtitle,
    color: DASHBOARD_COLOR,
    footerKey: FOOTER_KEY,
    fields,
  };
}

/**
 * Builds the personal (`/stats personal`) dashboard tabs for one user.
 * `scopeServerId` is the internal server id when scope=this_server, else undefined
 * (global, aggregated across every server the user shares with the bot).
 */
export async function buildPersonalTabs(args: {
  locale: string;
  userId: number;
  userDiscId: string;
  serverId: number;
  guildId: string;
  from?: string;
  scopeServerId?: number;
  subtitle: string;
  timezoneOffset?: number | null;
}): Promise<StatsTab[]> {
  const { locale, userId, from, scopeServerId, subtitle } = args;
  const names = await resolvePersonaNames(args.guildId);
  const scope = { userId, serverId: scopeServerId, from };

  const [
    messages,
    commands,
    streak,
    histogram,
    favorite,
    affinity,
    models,
    tokens,
    cost,
    tools,
    topCommands,
    emoji,
    stickers,
    sprites,
    memoriesSaved,
    conditioningByPersona,
  ] = await Promise.all([
    statRepository.getMetricTotal({ metric: "message_sent", ...scope }),
    statRepository.getMetricTotal({ metric: "command_used", ...scope }),
    statRepository.getStreak({ userId, serverId: scopeServerId }),
    statRepository.getActivityHistogram({ userId, serverId: scopeServerId, from }),
    statRepository.getFavoritePersona({ userId, serverId: scopeServerId, from }),
    statRepository.getPersonaAffinity({ userId, serverId: scopeServerId, from }),
    statRepository.getModelBreakdown({ userId, serverId: scopeServerId, from }),
    statRepository.getTokenTotals(scope),
    statRepository.getEstimatedCost({ userId, serverId: scopeServerId, from }),
    statRepository.getMetricKeyBreakdown({ metric: "tool_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "command_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "emoji_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "sticker_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "sprite_shown", ...scope, limit: 5 }),
    statRepository.getPersonalMemoryCount({ userId }),
    // Conditioning is a lifetime counter (not bucketed) → all-time, not windowed.
    statRepository.getConditioningPersonaBreakdown({ userId, serverId: scopeServerId }),
  ]);

  const favoritePersonaText =
    favorite === null
      ? localizer(locale, "commands.stats.empty")
      : `${lineageLabel(locale, names, favorite.lineageId)} (${favorite.loyaltyPct.toFixed(0)}%)`;

  // Most rewarded / punished personas (all-time, sorted by the respective count).
  const mostRewarded = [...conditioningByPersona]
    .filter((c) => c.rewards > 0)
    .sort((a, b) => b.rewards - a.rewards)
    .slice(0, 5)
    .map((c) => ({ label: lineageLabel(locale, names, c.lineageId), count: c.rewards }));
  const mostPunished = [...conditioningByPersona]
    .filter((c) => c.punishments > 0)
    .sort((a, b) => b.punishments - a.punishments)
    .slice(0, 5)
    .map((c) => ({ label: lineageLabel(locale, names, c.lineageId), count: c.punishments }));

  return [
    {
      id: "overview",
      labelKey: "commands.stats.tabs.overview_label",
      page: page("commands.stats.tabs.overview_title", subtitle, [
        statField("commands.stats.fields.messages", fmtInt(messages)),
        statField("commands.stats.fields.commands", fmtInt(commands)),
        statField(
          "commands.stats.fields.current_streak",
          localizer(locale, "commands.stats.days", { count: streak.currentStreak }),
        ),
        statField(
          "commands.stats.fields.longest_streak",
          localizer(locale, "commands.stats.days", { count: streak.longestStreak }),
        ),
        statField(
          "commands.stats.fields.peak_hour",
          formatPeakHour(locale, peakKey(histogram.byHour), args.timezoneOffset),
        ),
        statField("commands.stats.fields.peak_weekday", formatPeakWeekday(locale, histogram.byWeekday)),
      ]),
    },
    {
      id: "personas",
      labelKey: "commands.stats.tabs.personas_label",
      page: page("commands.stats.tabs.personas_title", subtitle, [
        statField("commands.stats.fields.favorite_persona", favoritePersonaText, false),
        statField(
          "commands.stats.fields.messages_by_persona",
          rankedList(
            locale,
            affinity.slice(0, 5).map((a) => ({ label: lineageLabel(locale, names, a.lineageId), count: a.count })),
          ),
          false,
        ),
        statField("commands.stats.fields.memories_saved", fmtInt(memoriesSaved)),
        statField("commands.stats.fields.most_rewarded_personas", rankedList(locale, mostRewarded), false),
        statField("commands.stats.fields.most_punished_personas", rankedList(locale, mostPunished), false),
      ]),
    },
    {
      id: "models",
      labelKey: "commands.stats.tabs.models_label",
      page: page("commands.stats.tabs.models_title", subtitle, [
        statField(
          "commands.stats.fields.top_models",
          rankedList(
            locale,
            models.slice(0, 5).map((m) => ({ label: `\`${m.model}\``, count: m.count })),
          ),
          false,
        ),
        statField("commands.stats.fields.model_diversity", fmtInt(models.length)),
        statField("commands.stats.fields.tokens_in", fmtInt(tokens.inputTokens)),
        statField("commands.stats.fields.tokens_out", fmtInt(tokens.outputTokens)),
        statField("commands.stats.fields.est_cost", fmtUsd(cost)),
      ]),
    },
    {
      id: "tools",
      labelKey: "commands.stats.tabs.tools_label",
      page: page("commands.stats.tabs.tools_title", subtitle, [
        statField(
          "commands.stats.fields.top_tools",
          rankedList(
            locale,
            tools.map((t) => ({ label: `\`${t.key}\``, count: t.count })),
          ),
          false,
        ),
        statField(
          "commands.stats.fields.top_commands",
          rankedList(
            locale,
            topCommands.map((c) => ({ label: `\`${c.key}\``, count: c.count })),
          ),
          false,
        ),
      ]),
    },
    {
      id: "expression",
      labelKey: "commands.stats.tabs.expression_label",
      page: page("commands.stats.tabs.expression_title", subtitle, [
        statField(
          "commands.stats.fields.top_emoji",
          rankedList(
            locale,
            emoji.map((e) => ({ label: `:${e.key}:`, count: e.count })),
          ),
          false,
        ),
        statField(
          "commands.stats.fields.top_stickers",
          rankedList(
            locale,
            stickers.map((s) => ({ label: `\`${s.key}\``, count: s.count })),
          ),
          false,
        ),
        statField(
          "commands.stats.fields.top_sprites",
          rankedList(
            locale,
            sprites.map((s) => ({ label: `\`${s.key}\``, count: s.count })),
          ),
          false,
        ),
      ]),
    },
  ];
}

/**
 * Builds the persona (`/stats persona`) dashboard tabs for one lineage on this server.
 */
export async function buildPersonaTabs(args: {
  locale: string;
  serverId: number;
  guildId: string;
  lineageId: number;
  personaName: string;
  from?: string;
  subtitle: string;
}): Promise<StatsTab[]> {
  const { locale, serverId, lineageId, from, subtitle } = args;
  const scope = { serverId, lineageId, from };

  const [messages, topUsers, models, tokens, emoji, stickers, sprites, conditioning] = await Promise.all([
    statRepository.getMetricTotal({ metric: "message_sent", ...scope }),
    statRepository.getTopUsers({ serverId, lineageId, from, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "model_used", ...scope, limit: 5 }),
    statRepository.getTokenTotals(scope),
    statRepository.getMetricKeyBreakdown({ metric: "emoji_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "sticker_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "sprite_shown", ...scope, limit: 5 }),
    statRepository.getConditioningTotals({ serverId, lineageId }),
  ]);

  return [
    {
      id: "overview",
      labelKey: "commands.stats.tabs.overview_label",
      page: page("commands.stats.tabs.overview_title", subtitle, [
        statField("commands.stats.fields.messages", fmtInt(messages)),
        statField("commands.stats.fields.rewards", fmtInt(conditioning.rewards)),
        statField("commands.stats.fields.punishments", fmtInt(conditioning.punishments)),
        statField("commands.stats.fields.tokens_in", fmtInt(tokens.inputTokens)),
        statField("commands.stats.fields.tokens_out", fmtInt(tokens.outputTokens)),
      ]),
    },
    {
      id: "people",
      labelKey: "commands.stats.tabs.people_label",
      page: page("commands.stats.tabs.people_title", subtitle, [
        statField(
          "commands.stats.fields.top_people",
          rankedList(
            locale,
            topUsers.map((u) => ({ label: `<@${u.userDiscId}>`, count: u.count })),
          ),
          false,
        ),
      ]),
    },
    {
      id: "models",
      labelKey: "commands.stats.tabs.models_label",
      page: page("commands.stats.tabs.models_title", subtitle, [
        statField(
          "commands.stats.fields.top_models",
          rankedList(
            locale,
            models.map((m) => ({ label: `\`${m.key}\``, count: m.count })),
          ),
          false,
        ),
      ]),
    },
    {
      id: "expression",
      labelKey: "commands.stats.tabs.expression_label",
      page: page("commands.stats.tabs.expression_title", subtitle, [
        statField(
          "commands.stats.fields.top_emoji",
          rankedList(
            locale,
            emoji.map((e) => ({ label: `:${e.key}:`, count: e.count })),
          ),
          false,
        ),
        statField(
          "commands.stats.fields.top_stickers",
          rankedList(
            locale,
            stickers.map((s) => ({ label: `\`${s.key}\``, count: s.count })),
          ),
          false,
        ),
        statField(
          "commands.stats.fields.top_sprites",
          rankedList(
            locale,
            sprites.map((s) => ({ label: `\`${s.key}\``, count: s.count })),
          ),
          false,
        ),
      ]),
    },
  ];
}

/**
 * Builds the server (`/stats server`) dashboard tabs.
 */
export async function buildServerTabs(args: {
  locale: string;
  serverId: number;
  guildId: string;
  from?: string;
  subtitle: string;
}): Promise<StatsTab[]> {
  const { locale, serverId, from, subtitle } = args;
  const scope = { serverId, from };

  const [
    messages,
    commands,
    leaderboard,
    models,
    tokens,
    cost,
    tools,
    topCommands,
    emoji,
    stickers,
    sprites,
    conditioning,
    generations,
  ] = await Promise.all([
    statRepository.getMetricTotal({ metric: "message_sent", ...scope }),
    statRepository.getMetricTotal({ metric: "command_used", ...scope }),
    statRepository.getTopUsers({ serverId, from, limit: 5 }),
    statRepository.getModelBreakdown({ serverId, from }),
    statRepository.getTokenTotals(scope),
    statRepository.getEstimatedCost({ serverId, from }),
    statRepository.getMetricKeyBreakdown({ metric: "tool_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "command_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "emoji_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "sticker_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "sprite_shown", ...scope, limit: 5 }),
    statRepository.getConditioningTotals({ serverId }),
    statRepository.getGenerationTotals({ serverId }),
  ]);

  return [
    {
      id: "overview",
      labelKey: "commands.stats.tabs.overview_label",
      page: page("commands.stats.tabs.overview_title", subtitle, [
        statField("commands.stats.fields.messages", fmtInt(messages)),
        statField("commands.stats.fields.commands", fmtInt(commands)),
        statField("commands.stats.fields.images", fmtInt(generations.imageGenerations)),
        statField("commands.stats.fields.videos", fmtInt(generations.videoGenerations)),
        statField("commands.stats.fields.rewards", fmtInt(conditioning.rewards)),
        statField("commands.stats.fields.punishments", fmtInt(conditioning.punishments)),
      ]),
    },
    {
      id: "leaderboard",
      labelKey: "commands.stats.tabs.leaderboard_label",
      page: page("commands.stats.tabs.leaderboard_title", subtitle, [
        statField(
          "commands.stats.fields.leaderboard",
          rankedList(
            locale,
            leaderboard.map((u) => ({ label: `<@${u.userDiscId}>`, count: u.count })),
          ),
          false,
        ),
      ]),
    },
    {
      id: "models",
      labelKey: "commands.stats.tabs.models_label",
      page: page("commands.stats.tabs.models_title", subtitle, [
        statField(
          "commands.stats.fields.top_models",
          rankedList(
            locale,
            models.slice(0, 5).map((m) => ({ label: `\`${m.model}\``, count: m.count })),
          ),
          false,
        ),
        statField("commands.stats.fields.tokens_in", fmtInt(tokens.inputTokens)),
        statField("commands.stats.fields.tokens_out", fmtInt(tokens.outputTokens)),
        statField("commands.stats.fields.est_cost", fmtUsd(cost)),
      ]),
    },
    {
      id: "tools",
      labelKey: "commands.stats.tabs.tools_label",
      page: page("commands.stats.tabs.tools_title", subtitle, [
        statField(
          "commands.stats.fields.top_tools",
          rankedList(
            locale,
            tools.map((t) => ({ label: `\`${t.key}\``, count: t.count })),
          ),
          false,
        ),
        statField(
          "commands.stats.fields.top_commands",
          rankedList(
            locale,
            topCommands.map((c) => ({ label: `\`${c.key}\``, count: c.count })),
          ),
          false,
        ),
      ]),
    },
    {
      id: "expression",
      labelKey: "commands.stats.tabs.expression_label",
      page: page("commands.stats.tabs.expression_title", subtitle, [
        statField(
          "commands.stats.fields.top_emoji",
          rankedList(
            locale,
            emoji.map((e) => ({ label: `:${e.key}:`, count: e.count })),
          ),
          false,
        ),
        statField(
          "commands.stats.fields.top_stickers",
          rankedList(
            locale,
            stickers.map((s) => ({ label: `\`${s.key}\``, count: s.count })),
          ),
          false,
        ),
        statField(
          "commands.stats.fields.top_sprites",
          rankedList(
            locale,
            sprites.map((s) => ({ label: `\`${s.key}\``, count: s.count })),
          ),
          false,
        ),
      ]),
    },
  ];
}

/** Builds the localized "{timeframe} • {scope}" subtitle shown under each tab title. */
export function buildSubtitle(locale: string, timeframe: Timeframe, scopeLabelKey?: string): string {
  const timeframeLabel = localizer(locale, `commands.choices.${timeframe}`);
  if (!scopeLabelKey) return `**${timeframeLabel}**`;
  return `**${timeframeLabel}** • ${localizer(locale, scopeLabelKey)}`;
}
