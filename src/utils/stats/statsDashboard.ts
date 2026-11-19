import { TIMEFRAME_LABEL_KEYS } from "@/utils/discord/statsDashboardCatalog";
import {
  type AttachmentBuilder,
  ButtonStyle,
  ComponentType,
  type MessageFlags,
  type ActionRowData,
  type ButtonComponentData,
  type ChatInputCommandInteraction,
  type TopLevelComponentData,
} from "discord.js";
import { statRepository } from "@/utils/db/repositories";
import type {
  ConditioningPersonaEntry,
  EmotionEntry,
  GenerationTotals,
  ModelCostEntry,
  PersonaAffinityEntry,
  TopUserEntry,
} from "@/utils/db/repositories/StatRepository";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { truncateDiscordText } from "@/utils/text/discordTextLimits";
import { DISCORD_BUTTON_LABEL_MAX } from "@/utils/discord/ui/componentsV2Limits";
import { formatLocaleInteger, localizer } from "@/utils/text/localizer";
import { log, ColorCode } from "@/utils/misc/logger";
import { buildDashboardPagePayload, type DashboardPage } from "@/utils/metrics/status/statusPageRenderer";
import { buildStatsDashboardButtonId } from "@/utils/discord/statsDashboardCatalog";

export type Timeframe = "today" | "week" | "month" | "year" | "all_time";

export const TIMEFRAME_VALUES: Timeframe[] = ["today", "week", "month", "year", "all_time"];

export const DEFAULT_TIMEFRAME: Timeframe = "all_time";

export type StatsScope = "this_server" | "global";

// Today uses the current UTC day only because the daily bucket grain cannot express a rolling 24h window.
export function resolveWindowFrom(timeframe: Timeframe): string | undefined {
  if (timeframe === "all_time") return undefined;
  const now = new Date();
  const floor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  switch (timeframe) {
    case "today":
      break;
    case "week":
      // Subtract 6 days so the inclusive 7-day window includes today.
      floor.setUTCDate(floor.getUTCDate() - 6);
      break;
    case "month":
      // Subtract 29 days so the inclusive 30-day window includes today.
      floor.setUTCDate(floor.getUTCDate() - 29);
      break;
    case "year":
      floor.setUTCFullYear(floor.getUTCFullYear() - 1);
      break;
  }
  return floor.toISOString().split("T")[0];
}

function fmtInt(n: number, locale: string): string {
  return formatLocaleInteger(n, locale);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function rankedList(locale: string, entries: Array<{ label: string; count: number }>, unit?: string): string {
  if (entries.length === 0) return localizer(locale, "commands.stats.empty");
  return entries
    .map((e, i) => `**${i + 1}.** ${e.label}: \`${fmtInt(e.count, locale)}\`${unit ? ` ${unit}` : ""}`)
    .join("\n");
}

function modelCostList(locale: string, entries: ModelCostEntry[]): string {
  if (entries.length === 0) return localizer(locale, "commands.stats.empty");
  const inShort = localizer(locale, "commands.stats.units.tokens_in_short");
  const outShort = localizer(locale, "commands.stats.units.tokens_out_short");
  return entries
    .map(
      (e, i) =>
        `**${i + 1}.** \`${e.model}\`: ${fmtInt(e.inputTokens, locale)} ${inShort} / ${fmtInt(e.outputTokens, locale)} ${outShort} / ${fmtUsd(e.cost)}`,
    )
    .join("\n");
}

function titleCaseEmotion(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function emotionList(locale: string, entries: EmotionEntry[]): string {
  return rankedList(
    locale,
    entries.map((e) => ({ label: titleCaseEmotion(e.emotion), count: e.count })),
  );
}

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

function lineageLabel(locale: string, names: Map<number, string>, lineageId: number): string {
  return names.get(lineageId) ?? localizer(locale, "commands.stats.unknown_persona", { id: lineageId });
}

// Only the first nickname per lineage is kept because getCachedAllPersonas orders the main persona before forked
// alters.
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

function formatPeakHour(locale: string, hour: number | null, offsetHours?: number | null): string {
  if (hour === null) return localizer(locale, "commands.stats.empty");
  const minutesPerDay = 24 * 60;
  const shiftedMinutes =
    ((Math.round((hour + (offsetHours ?? 0)) * 60) % minutesPerDay) + minutesPerDay) % minutesPerDay;
  const suffix = offsetHours ? localizer(locale, "commands.stats.local_suffix") : "UTC";
  const hh = String(Math.floor(shiftedMinutes / 60)).padStart(2, "0");
  const mm = String(shiftedMinutes % 60).padStart(2, "0");
  return `${hh}:${mm} ${suffix}`;
}

function formatPeakWeekday(locale: string, byWeekday: Record<number, number>): string {
  const peak = peakKey(byWeekday);
  if (peak === null) return localizer(locale, "commands.stats.empty");
  const names = localizer(locale, "commands.stats.weekday_names").split(",");
  return names[peak] ?? String(peak);
}

type StatField = { kind: "stat"; nameKey: string; value: string; inline: boolean } | { kind: "separator" };

function statField(nameKey: string, value: string, inline = true): StatField {
  return { kind: "stat", nameKey, value: value || "(None)", inline };
}

function sepField(): StatField {
  return { kind: "separator" };
}

interface StatsTabPage {
  titleKey: string;
  subtitle: string;
  footerKey?: string;
  fields: StatField[];
}

export interface StatsTab {
  id: string;
  labelKey: string;
  page: StatsTabPage;
}

const FOOTER_KEY = "commands.stats.footer";
const DASHBOARD_COLOR = ColorCode.INFO;

function page(titleKey: string, subtitle: string, fields: StatField[]): StatsTabPage {
  return { titleKey, subtitle, footerKey: FOOTER_KEY, fields };
}

function buildTabButtonRows(
  context: StatsDashboardViewContext,
  tabs: StatsTab[],
  activeIndex: number,
  locale: string,
): ActionRowData<ButtonComponentData>[] {
  const rows: ActionRowData<ButtonComponentData>[] = [];
  for (let i = 0; i < tabs.length; i += 5) {
    rows.push({
      type: ComponentType.ActionRow,
      components: tabs.slice(i, i + 5).map((tab, j) => {
        const index = i + j;
        return {
          type: ComponentType.Button,
          style: index === activeIndex ? ButtonStyle.Primary : ButtonStyle.Secondary,
          customId: buildStatsDashboardButtonId(context, tab.id),
          label: truncateDiscordText(localizer(locale, tab.labelKey), DISCORD_BUTTON_LABEL_MAX),
          disabled: index === activeIndex,
        } satisfies ButtonComponentData;
      }),
    });
  }
  return rows;
}

function toDashboardPage(tabPage: StatsTabPage, iconUrl?: string): DashboardPage {
  return {
    titleKey: tabPage.titleKey,
    description: tabPage.subtitle,
    footerKey: tabPage.footerKey,
    color: DASHBOARD_COLOR,
    thumbnailUrl: iconUrl,
    fields: tabPage.fields.map((field) =>
      field.kind === "separator"
        ? { separator: true }
        : { nameKey: field.nameKey, value: field.value, inline: field.inline },
    ),
  };
}

// iconFile is attached on every payload because Discord requires it on each update for attachment:// icon URLs to
// keep resolving.
export function buildStatsDashboardPayload(
  context: StatsDashboardViewContext,
  tabs: StatsTab[],
  activeIndex: number,
  withButtons: boolean,
  iconUrl?: string,
  iconFile?: AttachmentBuilder,
): {
  components: TopLevelComponentData[];
  flags: MessageFlags.IsComponentsV2;
  files?: AttachmentBuilder[];
};
export function buildStatsDashboardPayload(
  legacyContext: string,
  tabs: StatsTab[],
  activeIndex: number,
  locale: string,
  withButtons: boolean,
  iconUrl?: string,
  iconFile?: AttachmentBuilder,
): {
  components: TopLevelComponentData[];
  flags: MessageFlags.IsComponentsV2;
  files?: AttachmentBuilder[];
};
export function buildStatsDashboardPayload(
  contextOrLegacy: StatsDashboardViewContext | string,
  tabs: StatsTab[],
  activeIndex: number,
  withButtonsOrLocale: boolean | string,
  iconUrlOrWithButtons?: string | boolean,
  iconFileOrUrl?: string | AttachmentBuilder,
  legacyIconFile?: AttachmentBuilder,
): {
  components: TopLevelComponentData[];
  flags: MessageFlags.IsComponentsV2;
  files?: AttachmentBuilder[];
} {
  const context: StatsDashboardViewContext =
    typeof contextOrLegacy === "string"
      ? {
          view: "personal",
          locale: withButtonsOrLocale as string,
          ownerId: "00000000000000000",
          serverId: 1,
          guildId: "00000000000000000",
          timeframe: "all_time",
          scope: "global",
        }
      : contextOrLegacy;
  const withButtons =
    typeof contextOrLegacy === "string" ? iconUrlOrWithButtons === true : withButtonsOrLocale === true;
  const iconUrl =
    typeof contextOrLegacy === "string"
      ? typeof iconFileOrUrl === "string"
        ? iconFileOrUrl
        : undefined
      : typeof iconUrlOrWithButtons === "string"
        ? iconUrlOrWithButtons
        : undefined;
  const iconFile =
    typeof contextOrLegacy === "string"
      ? legacyIconFile
      : iconFileOrUrl && typeof iconFileOrUrl !== "string"
        ? iconFileOrUrl
        : undefined;
  const buttonRows = buildTabButtonRows(context, tabs, activeIndex, context.locale);
  return {
    ...buildDashboardPagePayload({
      locale: context.locale,
      page: toDashboardPage(tabs[activeIndex].page, iconUrl),
      buttonRows: withButtons ? buttonRows : [],
    }),
    ...(iconFile ? { files: [iconFile] } : {}),
  };
}

export async function renderStatsDashboard(
  interaction: ChatInputCommandInteraction,
  context: StatsDashboardViewContext,
  tabs: StatsTab[],
  iconUrl?: string,
  iconFile?: AttachmentBuilder,
): Promise<void> {
  if (tabs.length === 0) return;
  await interaction.editReply(buildStatsDashboardPayload(context, tabs, 0, true, iconUrl, iconFile));
}

export async function renderStatsDashboardWithReply(
  reply: (payload: ReturnType<typeof buildStatsDashboardPayload>) => Promise<unknown>,
  context: StatsDashboardViewContext,
  tabs: StatsTab[],
  iconUrl?: string,
  iconFile?: AttachmentBuilder,
): Promise<void> {
  if (tabs.length === 0) return;
  await reply(buildStatsDashboardPayload(context, tabs, 0, true, iconUrl, iconFile));
}

interface StatsDashboardViewContextBase {
  locale: string;
  ownerId: string;
  serverId: number;
  guildId: string;
  timeframe: Timeframe;
}

export type StatsDashboardViewContext =
  | (StatsDashboardViewContextBase & { view: "personal"; scope: StatsScope; timezoneOffset?: number | null })
  | (StatsDashboardViewContextBase & { view: "persona"; personaId: number })
  | (StatsDashboardViewContextBase & { view: "server" });

export async function buildPersonalTabs(args: {
  locale: string;
  userId: number;
  userDiscId: string;
  serverId: number;
  guildId: string;
  timeframe: Timeframe;
  from?: string;
  scopeServerId?: number;
  subtitle: string;
  timezoneOffset?: number | null;
}): Promise<StatsTab[]> {
  // Drain buffered telemetry before dashboard reads so recent current-process activity appears in the snapshot.
  await statRepository.flush();
  const { locale, userId, from, scopeServerId, subtitle, timeframe } = args;
  const isAllTime = timeframe === "all_time";
  const isToday = timeframe === "today";
  const names = await resolvePersonaNames(args.guildId);
  const scope = { userId, serverId: scopeServerId, from };

  const [
    messages,
    commands,
    favorite,
    affinity,
    models,
    modelCost,
    tokens,
    cost,
    tools,
    topCommands,
    emoji,
    stickers,
    sprites,
    emotions,
  ] = await Promise.all([
    statRepository.getMetricTotal({ metric: "message_sent", ...scope }),
    statRepository.getMetricTotal({ metric: "command_used", ...scope }),
    statRepository.getFavoritePersona({ userId, serverId: scopeServerId, from }),
    statRepository.getPersonaAffinity({ userId, serverId: scopeServerId, from }),
    statRepository.getModelBreakdown({ userId, serverId: scopeServerId, from }),
    statRepository.getModelCostBreakdown({ userId, serverId: scopeServerId, from, limit: 5 }),
    statRepository.getTokenTotals(scope),
    statRepository.getEstimatedCost({ userId, serverId: scopeServerId, from }),
    statRepository.getMetricKeyBreakdown({ metric: "tool_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "command_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "emoji_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "sticker_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "sprite_shown", ...scope, limit: 5 }),
    statRepository.getEmotionBreakdown({ userId, serverId: scopeServerId, from, limit: 5 }),
  ]);

  const streak = isToday ? null : await statRepository.getStreak({ userId, serverId: scopeServerId });
  const histogram = isToday
    ? null
    : await statRepository.getActivityHistogram({ userId, serverId: scopeServerId, from });

  let memoriesSaved = 0;
  let memoryByPersona: PersonaAffinityEntry[] = [];
  let conditioningByPersona: ConditioningPersonaEntry[] = [];
  let conditioning = { rewards: 0, punishments: 0 };
  let generations: GenerationTotals = { textGenerations: 0, imageGenerations: 0, videoGenerations: 0 };
  if (isAllTime) {
    [memoriesSaved, memoryByPersona, conditioningByPersona, conditioning] = await Promise.all([
      statRepository.getPersonalMemoryCount({ userId }),
      statRepository.getPersonalMemoryByPersona({ userId, limit: 5 }),
      statRepository.getConditioningPersonaBreakdown({ userId, serverId: scopeServerId }),
      statRepository.getConditioningTotals({ userId, serverId: scopeServerId }),
    ]);
  }
  // Generation telemetry carries the same server/user dimensions as other stats,
  // so both this-server and global personal scopes are meaningful and windowable.
  generations = await statRepository.getGenerationTotals({
    serverId: scopeServerId,
    userId,
    from: args.from,
  });

  const unitMemories = localizer(locale, "commands.stats.units.memories_saved");
  const unitReplies = localizer(locale, "commands.stats.units.replies_received");

  const favoritePersonaName =
    favorite === null ? localizer(locale, "commands.stats.empty") : lineageLabel(locale, names, favorite.lineageId);
  const favoritePersonaText =
    favorite === null
      ? localizer(locale, "commands.stats.empty")
      : `${lineageLabel(locale, names, favorite.lineageId)} (${favorite.loyaltyPct.toFixed(0)}%)`;

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

  const favoriteModel = modelCost[0] ? modelCost[0].model : localizer(locale, "commands.stats.empty");

  const overviewFields: StatField[] = [
    statField("commands.stats.fields.messages_personal", fmtInt(messages, locale)),
    statField("commands.stats.fields.favorite_persona_short", favoritePersonaName),
    statField("commands.stats.fields.favorite_model", favoriteModel),
    sepField(),
    statField("commands.stats.fields.tokens_in", fmtInt(tokens.inputTokens, locale)),
    statField("commands.stats.fields.tokens_out", fmtInt(tokens.outputTokens, locale)),
    statField("commands.stats.fields.est_cost", fmtUsd(cost)),
  ];
  if (!isToday) {
    const hasActivity = streak !== null || histogram !== null;
    if (hasActivity) {
      overviewFields.push(sepField());
      if (streak) {
        overviewFields.push(
          statField(
            "commands.stats.fields.current_streak",
            localizer(locale, "commands.stats.days", { count: streak.currentStreak }),
          ),
          statField(
            "commands.stats.fields.longest_streak",
            localizer(locale, "commands.stats.days", { count: streak.longestStreak }),
          ),
        );
      }
      if (histogram) {
        overviewFields.push(
          statField(
            "commands.stats.fields.peak_hour",
            formatPeakHour(locale, peakKey(histogram.byHour), args.timezoneOffset),
          ),
          statField("commands.stats.fields.peak_weekday", formatPeakWeekday(locale, histogram.byWeekday)),
        );
      }
    }
  }
  if (isAllTime) {
    overviewFields.push(
      sepField(),
      statField("commands.stats.fields.personal_memories", fmtInt(memoriesSaved, locale)),
      statField("commands.stats.fields.rewards", fmtInt(conditioning.rewards, locale)),
      statField("commands.stats.fields.punishments", fmtInt(conditioning.punishments, locale)),
    );
  }
  overviewFields.push(
    sepField(),
    statField("commands.stats.fields.images", fmtInt(generations.imageGenerations, locale)),
    statField("commands.stats.fields.videos", fmtInt(generations.videoGenerations, locale)),
  );
  overviewFields.push(statField("commands.stats.fields.commands", fmtInt(commands, locale)));

  const personaFields: StatField[] = [
    statField("commands.stats.fields.favorite_persona", favoritePersonaText, false),
    statField(
      "commands.stats.fields.messages_by_persona",
      rankedList(
        locale,
        affinity.slice(0, 5).map((a) => ({ label: lineageLabel(locale, names, a.lineageId), count: a.count })),
        unitReplies,
      ),
      false,
    ),
  ];
  if (isAllTime) {
    personaFields.push(
      statField(
        "commands.stats.fields.memories_by_persona",
        rankedList(
          locale,
          memoryByPersona.map((m) => ({ label: lineageLabel(locale, names, m.lineageId), count: m.count })),
          unitMemories,
        ),
        false,
      ),
      statField("commands.stats.fields.most_rewarded_personas", rankedList(locale, mostRewarded), false),
      statField("commands.stats.fields.most_punished_personas", rankedList(locale, mostPunished), false),
    );
  }

  return [
    {
      id: "overview",
      labelKey: "commands.stats.tabs.overview_label",
      page: page("commands.stats.tabs.overview_title", subtitle, overviewFields),
    },
    {
      id: "personas",
      labelKey: "commands.stats.tabs.personas_label",
      page: page("commands.stats.tabs.personas_title", subtitle, personaFields),
    },
    {
      id: "models",
      labelKey: "commands.stats.tabs.models_label",
      page: page("commands.stats.tabs.models_title", subtitle, [
        statField("commands.stats.fields.top_models", modelCostList(locale, modelCost), false),
        statField("commands.stats.fields.model_diversity", fmtInt(models.length, locale)),
        statField("commands.stats.fields.tokens_in", fmtInt(tokens.inputTokens, locale)),
        statField("commands.stats.fields.tokens_out", fmtInt(tokens.outputTokens, locale)),
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
        statField("commands.stats.fields.top_emotions_caused", emotionList(locale, emotions), false),
        statField(
          "commands.stats.fields.top_emoji_received",
          rankedList(
            locale,
            emoji.map((e) => ({ label: `:${e.key}:`, count: e.count })),
          ),
          false,
        ),
        statField(
          "commands.stats.fields.top_stickers_received",
          rankedList(
            locale,
            stickers.map((s) => ({ label: `\`${s.key}\``, count: s.count })),
          ),
          false,
        ),
        statField(
          "commands.stats.fields.top_sprites_received",
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

export async function buildPersonaTabs(args: {
  locale: string;
  serverId: number;
  guildId: string;
  lineageId: number;
  personaName: string;
  timeframe: Timeframe;
  from?: string;
  subtitle: string;
  botUserDiscId: string;
}): Promise<StatsTab[]> {
  await statRepository.flush();
  const { locale, serverId, lineageId, from, subtitle, timeframe, botUserDiscId } = args;
  const isAllTime = timeframe === "all_time";
  const scope = { serverId, lineageId, from };

  const [messages, topUsers, modelCost, tokens, cost, emoji, stickers, sprites, emotions] = await Promise.all([
    statRepository.getMetricTotal({ metric: "message_sent", ...scope }),
    statRepository.getTopUsers({ serverId, lineageId, from, limit: 5, botUserDiscId }),
    statRepository.getModelCostBreakdown({ serverId, lineageId, from, limit: 5 }),
    statRepository.getTokenTotals(scope),
    statRepository.getEstimatedCost({ serverId, lineageId, from }),
    statRepository.getMetricKeyBreakdown({ metric: "emoji_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "sticker_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "sprite_shown", ...scope, limit: 5 }),
    statRepository.getEmotionBreakdown({ serverId, lineageId, from, limit: 5 }),
  ]);

  let conditioning = { rewards: 0, punishments: 0 };
  let personalMemoryCount = 0;
  let serverMemoryCount = 0;
  let rewardedBy: TopUserEntry[] = [];
  let punishedBy: TopUserEntry[] = [];
  let remembered: TopUserEntry[] = [];
  if (isAllTime) {
    [conditioning, personalMemoryCount, serverMemoryCount, rewardedBy, punishedBy, remembered] = await Promise.all([
      statRepository.getConditioningTotals({ serverId, lineageId }),
      // People this persona has personal memories about (global per lineage: personal
      // memories carry no server_id).
      statRepository.getPersonaMemoryCount({ lineageId }),
      statRepository.getServerMemoryCount({ serverId, lineageId }),
      statRepository.getConditioningTopUsers({ serverId, lineageId, type: "reward", limit: 5 }),
      statRepository.getConditioningTopUsers({ serverId, lineageId, type: "punish", limit: 5 }),
      statRepository.getTopUsersByMemory({ serverId, lineageId, limit: 5 }),
    ]);
  }

  const unitMessages = localizer(locale, "commands.stats.units.messages_sent");
  const unitMemories = localizer(locale, "commands.stats.units.memories_saved");
  const unitRewards = localizer(locale, "commands.stats.units.rewards");
  const unitPunishments = localizer(locale, "commands.stats.units.punishments");

  const overviewFields: StatField[] = [
    statField("commands.stats.fields.messages_persona", fmtInt(messages, locale)),
    sepField(),
    statField("commands.stats.fields.tokens_in", fmtInt(tokens.inputTokens, locale)),
    statField("commands.stats.fields.tokens_out", fmtInt(tokens.outputTokens, locale)),
    statField("commands.stats.fields.est_cost", fmtUsd(cost)),
  ];
  if (isAllTime) {
    overviewFields.push(
      sepField(),
      statField("commands.stats.fields.personal_memories_created", fmtInt(personalMemoryCount, locale)),
      statField("commands.stats.fields.server_memories_created", fmtInt(serverMemoryCount, locale)),
      statField("commands.stats.fields.rewards_received", fmtInt(conditioning.rewards, locale)),
      statField("commands.stats.fields.punishments_received", fmtInt(conditioning.punishments, locale)),
    );
  }

  const peopleFields: StatField[] = [
    statField(
      "commands.stats.fields.most_talked_to_people",
      rankedList(
        locale,
        topUsers.map((u) => ({ label: `<@${u.userDiscId}>`, count: u.count })),
        unitMessages,
      ),
      false,
    ),
  ];
  if (isAllTime) {
    peopleFields.push(
      statField(
        "commands.stats.fields.most_remembered_people",
        rankedList(
          locale,
          remembered.map((u) => ({ label: `<@${u.userDiscId}>`, count: u.count })),
          unitMemories,
        ),
        false,
      ),
      statField(
        "commands.stats.fields.most_rewarded_by",
        rankedList(
          locale,
          rewardedBy.map((u) => ({ label: `<@${u.userDiscId}>`, count: u.count })),
          unitRewards,
        ),
        false,
      ),
      statField(
        "commands.stats.fields.most_punished_by",
        rankedList(
          locale,
          punishedBy.map((u) => ({ label: `<@${u.userDiscId}>`, count: u.count })),
          unitPunishments,
        ),
        false,
      ),
    );
  }

  return [
    {
      id: "overview",
      labelKey: "commands.stats.tabs.overview_label",
      page: page("commands.stats.tabs.overview_title", subtitle, overviewFields),
    },
    {
      id: "people",
      labelKey: "commands.stats.tabs.people_label",
      page: page("commands.stats.tabs.people_title", subtitle, peopleFields),
    },
    {
      id: "models",
      labelKey: "commands.stats.tabs.models_label",
      page: page("commands.stats.tabs.models_title", subtitle, [
        statField("commands.stats.fields.top_models", modelCostList(locale, modelCost), false),
        statField("commands.stats.fields.tokens_in", fmtInt(tokens.inputTokens, locale)),
        statField("commands.stats.fields.tokens_out", fmtInt(tokens.outputTokens, locale)),
        statField("commands.stats.fields.est_cost", fmtUsd(cost)),
      ]),
    },
    {
      id: "expression",
      labelKey: "commands.stats.tabs.expression_label",
      page: page("commands.stats.tabs.expression_title", subtitle, [
        statField("commands.stats.fields.top_emotions", emotionList(locale, emotions), false),
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

export async function buildServerTabs(args: {
  locale: string;
  serverId: number;
  guildId: string;
  timeframe: Timeframe;
  from?: string;
  subtitle: string;
  botUserDiscId: string;
}): Promise<StatsTab[]> {
  await statRepository.flush();
  const { locale, serverId, from, subtitle, timeframe, botUserDiscId } = args;
  const isAllTime = timeframe === "all_time";
  const names = await resolvePersonaNames(args.guildId);
  const scope = { serverId, from };

  const [
    messages,
    commands,
    leaderboard,
    modelCost,
    tokens,
    cost,
    tools,
    topCommands,
    emoji,
    stickers,
    sprites,
    popularPersonas,
    emotions,
    generations,
  ] = await Promise.all([
    statRepository.getMetricTotal({ metric: "message_sent", ...scope }),
    statRepository.getMetricTotal({ metric: "command_used", ...scope }),
    statRepository.getTopUsers({ serverId, from, limit: 5, botUserDiscId }),
    statRepository.getModelCostBreakdown({ serverId, from, limit: 5 }),
    statRepository.getTokenTotals(scope),
    statRepository.getEstimatedCost({ serverId, from }),
    statRepository.getMetricKeyBreakdown({ metric: "tool_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "command_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "emoji_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "sticker_used", ...scope, limit: 5 }),
    statRepository.getMetricKeyBreakdown({ metric: "sprite_shown", ...scope, limit: 5 }),
    statRepository.getServerPersonaMessages({ serverId, from, limit: 5 }),
    statRepository.getEmotionBreakdown({ serverId, from, limit: 5 }),
    statRepository.getGenerationTotals({ serverId, from }),
  ]);

  let conditioning = { rewards: 0, punishments: 0 };
  let memorableMembers: TopUserEntry[] = [];
  let serverMemoryCount = 0;
  let memberMemoryCount = 0;
  if (isAllTime) {
    [conditioning, memorableMembers, serverMemoryCount, memberMemoryCount] = await Promise.all([
      statRepository.getConditioningTotals({ serverId }),
      statRepository.getTopUsersByMemory({ serverId, limit: 5 }),
      // Server memories are exact and server-scoped while member memories are cross-server estimates, so keep them
      // separate.
      statRepository.getServerMemoryCount({ serverId }),
      statRepository.getMemberMemoryCount({ serverId }),
    ]);
  }

  const unitToMe = localizer(locale, "commands.stats.units.messages_to_me");
  const unitReceived = localizer(locale, "commands.stats.units.messages_received");
  const unitMemories = localizer(locale, "commands.stats.units.memories_saved");

  const mostPopularPersonaName = popularPersonas[0]
    ? lineageLabel(locale, names, popularPersonas[0].lineageId)
    : localizer(locale, "commands.stats.empty");
  const mostPopularModel = modelCost[0] ? modelCost[0].model : localizer(locale, "commands.stats.empty");

  const overviewFields: StatField[] = [
    statField("commands.stats.fields.messages", fmtInt(messages, locale)),
    statField("commands.stats.fields.most_popular_persona", mostPopularPersonaName),
    statField("commands.stats.fields.most_popular_model", mostPopularModel),
    sepField(),
    statField("commands.stats.fields.tokens_in", fmtInt(tokens.inputTokens, locale)),
    statField("commands.stats.fields.tokens_out", fmtInt(tokens.outputTokens, locale)),
    statField("commands.stats.fields.est_cost", fmtUsd(cost)),
  ];
  if (isAllTime) {
    overviewFields.push(
      sepField(),
      statField("commands.stats.fields.server_memories", fmtInt(serverMemoryCount, locale)),
      statField("commands.stats.fields.member_memories", fmtInt(memberMemoryCount, locale)),
      statField("commands.stats.fields.rewards", fmtInt(conditioning.rewards, locale)),
      statField("commands.stats.fields.punishments", fmtInt(conditioning.punishments, locale)),
    );
  }
  overviewFields.push(
    sepField(),
    statField("commands.stats.fields.images", fmtInt(generations.imageGenerations, locale)),
    statField("commands.stats.fields.videos", fmtInt(generations.videoGenerations, locale)),
    statField("commands.stats.fields.commands", fmtInt(commands, locale)),
  );

  const leaderboardFields: StatField[] = [
    statField(
      "commands.stats.fields.most_talkative_members",
      rankedList(
        locale,
        leaderboard.map((u) => ({ label: `<@${u.userDiscId}>`, count: u.count })),
        unitToMe,
      ),
      false,
    ),
    statField(
      "commands.stats.fields.most_popular_personas",
      rankedList(
        locale,
        popularPersonas.map((p) => ({ label: lineageLabel(locale, names, p.lineageId), count: p.count })),
        unitReceived,
      ),
      false,
    ),
  ];
  if (isAllTime) {
    leaderboardFields.push(
      statField(
        "commands.stats.fields.most_memorable_members",
        rankedList(
          locale,
          memorableMembers.map((u) => ({ label: `<@${u.userDiscId}>`, count: u.count })),
          unitMemories,
        ),
        false,
      ),
    );
  }

  return [
    {
      id: "overview",
      labelKey: "commands.stats.tabs.overview_label",
      page: page("commands.stats.tabs.overview_title", subtitle, overviewFields),
    },
    {
      id: "leaderboard",
      labelKey: "commands.stats.tabs.leaderboard_label",
      page: page("commands.stats.tabs.leaderboard_title", subtitle, leaderboardFields),
    },
    {
      id: "models",
      labelKey: "commands.stats.tabs.models_label",
      page: page("commands.stats.tabs.models_title", subtitle, [
        statField("commands.stats.fields.top_models", modelCostList(locale, modelCost), false),
        statField("commands.stats.fields.tokens_in", fmtInt(tokens.inputTokens, locale)),
        statField("commands.stats.fields.tokens_out", fmtInt(tokens.outputTokens, locale)),
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
        statField("commands.stats.fields.top_emotions", emotionList(locale, emotions), false),
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

export function buildSubtitle(locale: string, timeframe: Timeframe, scopeLabelKey?: string): string {
  const timeframeLabel = localizer(locale, TIMEFRAME_LABEL_KEYS[timeframe]);
  if (!scopeLabelKey) return `**${timeframeLabel}**`;
  return `**${timeframeLabel}** • ${localizer(locale, scopeLabelKey)}`;
}
