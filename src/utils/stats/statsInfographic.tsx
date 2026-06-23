/**
 * statsInfographic.tsx — satori (JSX → SVG) layer for the `/stats generate`
 * infographic (plans/stat-tracking.md §10, Phase 3).
 *
 * Contains:
 *   1. The hand-rolled JSX factory satori needs (`h` / `Fragment`).
 *   2. Shared viz primitives (BigNumberHero, ActivityHeatmapViz, ActivityRing24h,
 *      LoyaltyRing, StreakBlock, Podium, Donut).
 *   3. Card data interfaces (PersonalCardData, PersonaCardData, ServerCardData).
 *   4. Pure render functions (renderPersonalCard, renderPersonaCard, renderServerCard).
 *
 * Why a hand-rolled JSX factory instead of React: satori consumes a
 * React-element-*shaped* tree (`{ type, props: { children, ...style } }`) but
 * the project has no React dependency. `h` builds exactly that shape, so tsc /
 * Bun transpile the JSX in this file through the classic factory
 * (tsconfig: `"jsx": "react"`, `"jsxFactory": "h"`, `"jsxFragmentFactory":
 * "Fragment"`) with zero React runtime. satori's published signature types its
 * element param as `react`'s `ReactNode`; with no `@types/react` present that
 * resolves loosely, so passing our typed {@link VNode} is accepted.
 *
 * Layout constraints (satori CSS subset):
 * - Every element MUST have `display: "flex"` — no browser defaults.
 * - Flexbox only — no CSS grid.
 * - conic-gradient: NOT supported in satori 0.26 — use SVG arc + base64 data URI instead.
 * - <img src="data:...">: supported for embedded avatars and SVG donuts.
 * - Emoji in text: NOT supported without configuring emoji provider — avoid.
 *
 * Card dimensions are env-configurable (STATS_CARD_W / STATS_CARD_H). Color
 * theme keys are also env-configurable (STATS_CARD_THEME_BG / _SURFACE / _ACCENT
 * / _TEXT). Defaults match the Chunk 2 shipped values so nothing changes visually
 * unless the operator explicitly overrides an env var.
 */
import type { ActivityHeatmap } from "@/utils/db/repositories/StatRepository";
import type { Timeframe } from "@/utils/stats/statsDashboard";
import { localizer } from "@/utils/text/localizer";

// ── JSX factory ───────────────────────────────────────────────────────────────

/**
 * A satori-compatible virtual node — the React-element shape satori walks
 * (`type` + `props`, children living inside `props.children`).
 */
export interface VNode {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
}

/**
 * Minimal JSX typing so tsc accepts intrinsic tags (`div`, `span`, `img`, …) with
 * the classic `h` factory and no React types installed. Every element produces a
 * {@link VNode}; any tag with any props is allowed (satori validates the real
 * subset at render time).
 */
declare global {
  namespace JSX {
    type Element = VNode;
    interface IntrinsicElements {
      [tag: string]: Record<string, unknown> & { children?: unknown };
    }
  }
}

/**
 * Classic JSX factory. Called by transpiled JSX as `h(type, props, ...children)`
 * and returns the {@link VNode} shape satori expects. Children are flattened one
 * level (JSX expands `{array}` children into a nested array) and collapsed to a
 * single child / `undefined` so satori sees the same shape React would emit.
 *
 * Function components (e.g. `<Section>`) are eagerly called here so every VNode
 * in the returned tree has a string `type`. satori can resolve function components
 * itself, but eager resolution keeps the tree fully concrete before it reaches
 * satori, which simplifies debugging and avoids any version-specific behavior.
 *
 * @param type     - Intrinsic element tag string OR a function component.
 * @param props    - Element props (style + attributes), or null when none.
 * @param children - Child nodes / text, possibly nested one level by JSX.
 */
export function h(
  type: string | ((props: Record<string, unknown> & { children?: unknown }) => unknown),
  props: Record<string, unknown> | null,
  ...children: unknown[]
): VNode {
  // 1. Flatten one level: JSX passes `{items}` as a single array argument.
  const flat = children.flat();
  // 2. Mirror React's children normalization (none → undefined, one → bare).
  const kids = flat.length === 0 ? undefined : flat.length === 1 ? flat[0] : flat;
  const mergedProps = { ...(props ?? {}), children: kids };

  // 3. Eagerly resolve function components so every node in the tree has a
  //    concrete string type before satori walks it.
  if (typeof type === "function") {
    return type(mergedProps) as VNode;
  }

  return { type, props: mergedProps };
}

/**
 * Fragment placeholder for `jsxFragmentFactory`. satori has no real fragment
 * concept; this exists only to satisfy the configured factory name.
 */
export function Fragment(props: { children?: unknown }): unknown {
  return props.children;
}

// ── Card theme + dimensions ───────────────────────────────────────────────────

/** Reads a non-negative integer env var with a numeric fallback. */
function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Card width shared by all card types (env: STATS_CARD_W, default 900).
 * Keep the default identical to the Chunk 2 shipped value.
 */
export const CARD_W = readIntEnv("STATS_CARD_W", 900);

/**
 * Per-card canvas heights (env: STATS_CARD_H_PERSONAL / _PERSONA / _SERVER).
 * Heights are tuned to the densest variant of each card (all sections shown) plus
 * a small buffer. Content uses minHeight so sparse variants don't leave large gaps.
 * The canvas height is the satori viewport upper bound — content never clips as
 * long as the actual layout stays under this value.
 */
export const PERSONAL_CARD_H = readIntEnv("STATS_CARD_H_PERSONAL", 900);
export const PERSONA_CARD_H = readIntEnv("STATS_CARD_H_PERSONA", 820);
export const SERVER_CARD_H = readIntEnv("STATS_CARD_H_SERVER", 880);

/** Backward-compat export used by Chunk 2 harness and tests. Maps to PERSONAL_CARD_H. */
export const CARD_H = PERSONAL_CARD_H;

/**
 * Centralized color + typography constants for all infographic cards.
 * Accent, bg, and surface colors are env-configurable (STATS_CARD_THEME_BG /
 * _SURFACE / _ACCENT). Defaults match the Chunk 2 shipped palette.
 */
export const CARD_THEME = {
  bg: process.env.STATS_CARD_THEME_BG ?? "#1e1f22",
  surface: process.env.STATS_CARD_THEME_SURFACE ?? "#2b2d31",
  surfaceAlt: "#313338",
  border: "#3d4045",
  text: "#ffffff",
  textMuted: "#949ba4",
  textSubtle: "#6d757d",
  accent: process.env.STATS_CARD_THEME_ACCENT ?? "#5865f2", // Discord blurple
  accentWarm: "#ed4245",
  accentGreen: "#57f287",
  accentYellow: "#fee75c",
  accentOrange: "#eb9b34",
  fontFamily: "Noto Sans JP",
} as const;

/** Horizontal/vertical padding used for all top-level card sections. */
const PAD_H = 28;
const PAD_V = 16;

// ── Shared primitives ─────────────────────────────────────────────────────────

/** Thin horizontal rule between card sections. */
function Divider(): VNode {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: 1,
        backgroundColor: CARD_THEME.border,
      }}
    />
  );
}

/** Section wrapper with consistent horizontal + vertical padding. */
function Section(props: { children?: unknown; style?: Record<string, unknown> }): VNode {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        paddingLeft: PAD_H,
        paddingRight: PAD_H,
        paddingTop: PAD_V,
        paddingBottom: PAD_V,
        ...(props.style ?? {}),
      }}
    >
      {props.children}
    </div>
  );
}

/**
 * Big-number hero: large stat value + smaller label beneath it.
 *
 * @param value - The formatted number / string to display prominently.
 * @param label - Descriptive label below the number.
 * @param color - Optional accent color for the number (defaults to theme accent).
 */
export function BigNumberHero(props: { value: string; label: string; color?: string }): VNode {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div
        style={{
          display: "flex",
          fontSize: 64,
          fontWeight: 700,
          color: props.color ?? CARD_THEME.accent,
          fontFamily: CARD_THEME.fontFamily,
          lineHeight: 1,
        }}
      >
        {props.value}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 14,
          color: CARD_THEME.textMuted,
          fontFamily: CARD_THEME.fontFamily,
          marginTop: 4,
        }}
      >
        {props.label}
      </div>
    </div>
  );
}

/**
 * Loyalty ring — a bordered circle showing the loyalty percentage.
 *
 * conic-gradient is NOT available in satori 0.26.0, so we use a solid accent
 * border instead of an arc fill. The percentage is shown prominently in the
 * center with the label beneath it.
 *
 * @param pct   - 0–100 loyalty percentage.
 * @param label - Short label shown below the percentage.
 * @param size  - Outer diameter in pixels (default 88).
 */
export function LoyaltyRing(props: { pct: number; label: string; size?: number }): VNode {
  const size = props.size ?? 88;
  const pct = Math.min(100, Math.max(0, props.pct));
  const borderPx = Math.max(3, Math.round(size * 0.06));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        border: `${borderPx}px solid ${CARD_THEME.accent}`,
        backgroundColor: CARD_THEME.surfaceAlt,
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: Math.round(size * 0.22),
          fontWeight: 700,
          color: CARD_THEME.text,
          fontFamily: CARD_THEME.fontFamily,
          lineHeight: 1,
        }}
      >
        {Math.round(pct)}%
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 9,
          color: CARD_THEME.textMuted,
          fontFamily: CARD_THEME.fontFamily,
        }}
      >
        {props.label}
      </div>
    </div>
  );
}

/**
 * Streak flame block — current streak count with a colored label, and longest
 * streak shown as a secondary value. Uses color instead of emoji (no emoji
 * provider configured; emoji would render as tofu on bundled Latin/JP font).
 *
 * @param current      - Current streak in days.
 * @param longest      - All-time longest streak in days.
 * @param daysUnit     - Localized "days" unit string without leading number
 *                       (from `commands.stats.days_unit` locale key). Using a
 *                       dedicated key avoids fragile regex parsing of the
 *                       pluralized `commands.stats.days` template in Japanese.
 * @param currentLabel - Localized label for current streak.
 * @param longestLabel - Localized label for longest streak.
 */
export function StreakBlock(props: {
  current: number;
  longest: number;
  daysUnit: string;
  currentLabel: string;
  longestLabel: string;
}): VNode {
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 32 }}>
      {/* Current streak — big number */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            fontSize: 40,
            fontWeight: 700,
            color: CARD_THEME.accentOrange,
            fontFamily: CARD_THEME.fontFamily,
            lineHeight: 1,
          }}
        >
          {props.current}
        </div>
        <div style={{ display: "flex", fontSize: 11, color: CARD_THEME.textMuted, fontFamily: CARD_THEME.fontFamily }}>
          {props.daysUnit}
        </div>
        <div style={{ display: "flex", fontSize: 11, color: CARD_THEME.textMuted, fontFamily: CARD_THEME.fontFamily }}>
          {props.currentLabel}
        </div>
      </div>
      {/* Longest streak — smaller secondary */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontSize: 13,
            color: CARD_THEME.textSubtle,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {props.longestLabel}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 22,
            fontWeight: 700,
            color: CARD_THEME.textMuted,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {props.longest} {props.daysUnit}
        </div>
      </div>
    </div>
  );
}

/**
 * 7×24 activity heatmap grid. Each cell is a colored rectangle whose intensity
 * is proportional to the normalized (per-weekday-occurrence averaged) value.
 *
 * @param grid        - Normalized ActivityHeatmap (dow 0–6 → hour 0–23 → avg count).
 * @param maxVal      - Maximum normalized value across all cells (for scaling).
 * @param weekdayNames - Array of 7 localized day labels (Sun→Sat).
 */
export function ActivityHeatmapViz(props: { grid: ActivityHeatmap; maxVal: number; weekdayNames: string[] }): VNode {
  const CELL_W = 30;
  const CELL_H = 18;
  const CELL_GAP = 2;
  const LABEL_W = 28;

  /** Maps a 0–1 intensity to a background color along a cool→warm ramp. */
  function cellColor(intensity: number): string {
    if (intensity <= 0) return CARD_THEME.surfaceAlt;
    // Low-to-high: dark blue → blurple → orange
    if (intensity < 0.33) return "#3b4a9f";
    if (intensity < 0.66) return CARD_THEME.accent;
    return CARD_THEME.accentOrange;
  }

  const rows: VNode[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const label = (props.weekdayNames[dow] ?? String(dow)).slice(0, 2);
    const cells: VNode[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const raw = props.grid[dow]?.[hour] ?? 0;
      const intensity = props.maxVal > 0 ? raw / props.maxVal : 0;
      cells.push(
        <div
          style={{
            display: "flex",
            width: CELL_W,
            height: CELL_H,
            backgroundColor: cellColor(intensity),
            borderRadius: 2,
            marginRight: CELL_GAP,
          }}
        />,
      );
    }

    rows.push(
      <div
        key={String(dow)}
        style={{ display: "flex", flexDirection: "row", alignItems: "center", marginBottom: CELL_GAP }}
      >
        <div
          style={{
            display: "flex",
            width: LABEL_W,
            fontSize: 10,
            color: CARD_THEME.textSubtle,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {label}
        </div>
        {cells}
      </div>,
    );
  }

  return <div style={{ display: "flex", flexDirection: "column" }}>{rows}</div>;
}

/**
 * 24-hour activity bar chart — fallback shown when the full 7×24 heatmap is
 * unavailable (timeframe = today / week). 24 vertical bars, one per hour.
 *
 * @param byHour - Hour-of-day → count map (0–23 keys; missing keys treated as 0).
 * @param maxH   - Bar chart height in pixels (default 60).
 */
export function ActivityRing24h(props: { byHour: Record<number, number>; maxH?: number }): VNode {
  const maxH = props.maxH ?? 60;
  const BAR_W = 22;
  const BAR_GAP = 2;

  const maxVal = Math.max(1, ...Object.values(props.byHour));

  const bars: VNode[] = [];
  for (let hour = 0; hour < 24; hour++) {
    const count = props.byHour[hour] ?? 0;
    const fillH = Math.max(2, Math.round((count / maxVal) * maxH));
    // Highlight peak hour in accent color
    const isPeak = count === maxVal && maxVal > 0;
    bars.push(
      <div
        key={String(hour)}
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          alignItems: "center",
          height: maxH,
          marginRight: BAR_GAP,
        }}
      >
        <div
          style={{
            display: "flex",
            width: BAR_W,
            height: fillH,
            backgroundColor: isPeak ? CARD_THEME.accentOrange : CARD_THEME.accent,
            borderRadius: 3,
          }}
        />
      </div>,
    );
  }

  return <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end" }}>{bars}</div>;
}

// ── PersonalCardData ──────────────────────────────────────────────────────────

/** Pre-normalized heatmap ready for rendering (normalization done in gather layer). */
export interface PersonalHeatmapData {
  /** Per-weekday-occurrence averaged counts (dow 0–6 → hour 0–23 → avg). */
  normalized: ActivityHeatmap;
  /** Maximum normalized cell value — used to scale the color gradient. */
  maxVal: number;
}

/**
 * All data the Personal "Wrapped" card needs, pre-gathered from the DB layer.
 * The renderer is a pure function of this struct — it never touches the DB.
 */
export interface PersonalCardData {
  /** BCP-47 locale string (e.g. "en-US" or "ja"). */
  locale: string;
  /** The selected time window (drives section visibility rules). */
  timeframe: Timeframe;
  /** Display name of the user shown on the card. */
  username: string;

  // ── Section: Favorite persona + loyalty ──
  /** Persona nickname for the user's top-messaged lineage, or null if no data. */
  favoritePersonaName: string | null;
  /** Base64 data URI ("data:image/png;base64,…") for the persona avatar, or null. */
  favoritePersonaAvatarDataUri: string | null;
  /** Loyalty ring value: top persona's share of all messages, 0–100. */
  loyaltyPct: number;

  // ── Section: Message count ──
  /** Total messages received by the user within the timeframe. */
  totalMessages: number;

  // ── Section: Activity ──
  /**
   * Full 7×24 heatmap (normalized). Present only when timeframe is month/year/all_time.
   * Null falls back to rendering the 24h ring instead.
   */
  heatmap: PersonalHeatmapData | null;
  /** 24h hour-of-day histogram for the ring fallback (today/week). */
  histogramByHour: Record<number, number> | null;

  // ── Section: Streak (hidden under timeframe = today) ──
  /** Current streak in days, or null when the timeframe is "today". */
  currentStreak: number | null;
  /** All-time longest streak, or null when the timeframe is "today". */
  longestStreak: number | null;

  // ── Section: Anniversary (hidden under timeframe = today) ──
  /** "First met" date for the favorite persona, or null when unavailable or today. */
  anniversary: Date | null;

  // ── Section: Models & cost ──
  /** Model codename with the most calls in the window, or null if no data. */
  topModelName: string | null;
  /** Estimated USD cost for the window (may be 0 for free models). */
  estimatedCost: number;

  // ── Section: Signature expression ──
  /** Top emojis + stickers combined (key = name, count = uses), top 5. */
  topExpression: Array<{ key: string; count: number }>;

  // ── Section: Conditioning (only when timeframe = all_time) ──
  /** Reward/punishment totals, or null when timeframe is not all_time. */
  conditioning: { rewards: number; punishments: number } | null;
}

// ── renderPersonalCard ────────────────────────────────────────────────────────

/**
 * Pure renderer: produces the Personal "Wrapped" infographic card VNode from the
 * pre-gathered data struct. Never accesses the DB or any async resource.
 *
 * @param data - Pre-gathered, pre-normalized card data (see {@link PersonalCardData}).
 * @returns A VNode tree suitable for passing to `renderCardToPng`.
 */
export function renderPersonalCard(data: PersonalCardData): VNode {
  const { locale } = data;

  // ── Localized strings ────────────────────────────────────────────────────────
  const t = {
    title: localizer(locale, "commands.stats.infographic.personal_title"),
    loyalty: localizer(locale, "commands.stats.infographic.loyalty"),
    messagesLabel: localizer(locale, "commands.stats.fields.messages_personal"),
    activity: localizer(locale, "commands.stats.infographic.activity"),
    currentStreak: localizer(locale, "commands.stats.fields.current_streak"),
    longestStreak: localizer(locale, "commands.stats.fields.longest_streak"),
    daysUnit: localizer(locale, "commands.stats.days_unit"),
    firstMet: localizer(locale, "commands.stats.infographic.first_met"),
    topModels: localizer(locale, "commands.stats.fields.top_models"),
    estCost: localizer(locale, "commands.stats.fields.est_cost"),
    signature: localizer(locale, "commands.stats.infographic.signature"),
    naughtyNice: localizer(locale, "commands.stats.infographic.naughty_nice"),
    noData: localizer(locale, "commands.stats.infographic.no_data"),
    empty: localizer(locale, "commands.stats.empty"),
    weekdayNames: localizer(locale, "commands.stats.weekday_names").split(","),
  };

  // ── "No data yet" fallback card ──────────────────────────────────────────────
  if (data.totalMessages === 0 && !data.favoritePersonaName) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: CARD_W,
          minHeight: PERSONAL_CARD_H,
          backgroundColor: CARD_THEME.bg,
          fontFamily: CARD_THEME.fontFamily,
        }}
      >
        <div style={{ display: "flex", fontSize: 48, color: CARD_THEME.textSubtle }}>--</div>
        <div style={{ display: "flex", fontSize: 20, color: CARD_THEME.textMuted, marginTop: 16 }}>{t.noData}</div>
        <div style={{ display: "flex", fontSize: 14, color: CARD_THEME.textSubtle, marginTop: 8 }}>{data.username}</div>
      </div>
    );
  }

  // ── Header: title bar ────────────────────────────────────────────────────────
  const headerSection = (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingLeft: PAD_H,
        paddingRight: PAD_H,
        paddingTop: 20,
        paddingBottom: 20,
        backgroundColor: CARD_THEME.surface,
      }}
    >
      {/* Left: title + username */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 700,
            color: CARD_THEME.text,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {t.title}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 15,
            color: CARD_THEME.textMuted,
            fontFamily: CARD_THEME.fontFamily,
            marginTop: 4,
          }}
        >
          {data.username}
        </div>
      </div>

      {/* Right: persona avatar (if any) + loyalty ring */}
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 16 }}>
        {data.favoritePersonaAvatarDataUri ? (
          <div
            style={{
              display: "flex",
              width: 64,
              height: 64,
              borderRadius: "50%",
              overflow: "hidden",
              border: `2px solid ${CARD_THEME.accent}`,
            }}
          >
            <img
              src={data.favoritePersonaAvatarDataUri}
              alt={data.favoritePersonaName ?? ""}
              style={{ display: "flex", width: 64, height: 64, objectFit: "cover" }}
              width={64}
              height={64}
            />
          </div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <LoyaltyRing pct={data.loyaltyPct} label={t.loyalty} size={72} />
          {data.favoritePersonaName ? (
            <div
              style={{
                display: "flex",
                fontSize: 11,
                color: CARD_THEME.textMuted,
                fontFamily: CARD_THEME.fontFamily,
                maxWidth: 100,
              }}
            >
              {data.favoritePersonaName}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  // ── Message count ─────────────────────────────────────────────────────────────
  const messageSection = (
    <Section style={{ alignItems: "center" }}>
      <BigNumberHero
        value={data.totalMessages.toLocaleString("en-US")}
        label={t.messagesLabel}
        color={CARD_THEME.accent}
      />
    </Section>
  );

  // ── Activity (heatmap or 24h ring) ────────────────────────────────────────────
  const activitySection = (
    <Section>
      <div
        style={{
          display: "flex",
          fontSize: 13,
          fontWeight: 700,
          color: CARD_THEME.textMuted,
          fontFamily: CARD_THEME.fontFamily,
          marginBottom: 10,
          textTransform: "uppercase",
          letterSpacing: 1,
        }}
      >
        {t.activity}
      </div>
      {data.heatmap ? (
        <ActivityHeatmapViz grid={data.heatmap.normalized} maxVal={data.heatmap.maxVal} weekdayNames={t.weekdayNames} />
      ) : data.histogramByHour ? (
        <ActivityRing24h byHour={data.histogramByHour} maxH={64} />
      ) : (
        <div
          style={{
            display: "flex",
            fontSize: 14,
            color: CARD_THEME.textSubtle,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {t.empty}
        </div>
      )}
    </Section>
  );

  // ── Streak + anniversary ──────────────────────────────────────────────────────
  const showStreak = data.currentStreak !== null && data.longestStreak !== null;
  const streakSection = showStreak ? (
    <Section style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <StreakBlock
        current={data.currentStreak ?? 0}
        longest={data.longestStreak ?? 0}
        daysUnit={t.daysUnit}
        currentLabel={t.currentStreak}
        longestLabel={t.longestStreak}
      />
      {data.anniversary ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div
            style={{
              display: "flex",
              fontSize: 12,
              color: CARD_THEME.textSubtle,
              fontFamily: CARD_THEME.fontFamily,
            }}
          >
            {t.firstMet}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 18,
              fontWeight: 700,
              color: CARD_THEME.textMuted,
              fontFamily: CARD_THEME.fontFamily,
            }}
          >
            {data.anniversary.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
          </div>
        </div>
      ) : null}
    </Section>
  ) : null;

  // ── Models & cost ─────────────────────────────────────────────────────────────
  const modelSection = (
    <Section style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontSize: 12,
            color: CARD_THEME.textSubtle,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {t.topModels}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 17,
            fontWeight: 700,
            color: CARD_THEME.text,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {data.topModelName ?? t.empty}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <div
          style={{
            display: "flex",
            fontSize: 12,
            color: CARD_THEME.textSubtle,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {t.estCost}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 20,
            fontWeight: 700,
            color: CARD_THEME.accentGreen,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          ${data.estimatedCost.toFixed(4)}
        </div>
      </div>
    </Section>
  );

  // ── Signature expression row ──────────────────────────────────────────────────
  const signatureSection =
    data.topExpression.length > 0 ? (
      <Section>
        <div
          style={{
            display: "flex",
            fontSize: 12,
            color: CARD_THEME.textSubtle,
            fontFamily: CARD_THEME.fontFamily,
            marginBottom: 8,
          }}
        >
          {t.signature}
        </div>
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {data.topExpression.slice(0, 5).map((expr) => (
            <div
              key={expr.key}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                backgroundColor: CARD_THEME.surfaceAlt,
                borderRadius: 6,
                paddingLeft: 10,
                paddingRight: 10,
                paddingTop: 4,
                paddingBottom: 4,
              }}
            >
              <div style={{ display: "flex", fontSize: 13, color: CARD_THEME.text, fontFamily: CARD_THEME.fontFamily }}>
                {expr.key}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 11,
                  color: CARD_THEME.textMuted,
                  fontFamily: CARD_THEME.fontFamily,
                }}
              >
                ×{expr.count}
              </div>
            </div>
          ))}
        </div>
      </Section>
    ) : null;

  // ── Naughty / nice conditioning (all-time only) ───────────────────────────────
  const conditioningSection = data.conditioning ? (
    <Section style={{ flexDirection: "row", gap: 32 }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontSize: 12,
            color: CARD_THEME.textSubtle,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {t.naughtyNice}
        </div>
        <div style={{ display: "flex", flexDirection: "row", gap: 24, marginTop: 4 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                fontSize: 28,
                fontWeight: 700,
                color: CARD_THEME.accentGreen,
                fontFamily: CARD_THEME.fontFamily,
              }}
            >
              {data.conditioning.rewards}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 11,
                color: CARD_THEME.textSubtle,
                fontFamily: CARD_THEME.fontFamily,
              }}
            >
              {localizer(locale, "commands.stats.units.rewards")}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div
              style={{
                display: "flex",
                fontSize: 28,
                fontWeight: 700,
                color: CARD_THEME.accentWarm,
                fontFamily: CARD_THEME.fontFamily,
              }}
            >
              {data.conditioning.punishments}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 11,
                color: CARD_THEME.textSubtle,
                fontFamily: CARD_THEME.fontFamily,
              }}
            >
              {localizer(locale, "commands.stats.units.punishments")}
            </div>
          </div>
        </div>
      </div>
    </Section>
  ) : null;

  // ── Footer ────────────────────────────────────────────────────────────────────
  const footerSection = (
    <div
      style={{
        display: "flex",
        paddingLeft: PAD_H,
        paddingRight: PAD_H,
        paddingTop: 8,
        paddingBottom: 12,
        backgroundColor: CARD_THEME.surface,
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 10,
          color: CARD_THEME.textSubtle,
          fontFamily: CARD_THEME.fontFamily,
        }}
      >
        {localizer(locale, "commands.stats.footer")}
      </div>
    </div>
  );

  // ── Assemble ──────────────────────────────────────────────────────────────────
  const sections: unknown[] = [headerSection, <Divider />, messageSection, <Divider />, activitySection];

  if (streakSection) {
    sections.push(<Divider />);
    sections.push(streakSection);
  }

  sections.push(<Divider />);
  sections.push(modelSection);

  if (signatureSection) {
    sections.push(<Divider />);
    sections.push(signatureSection);
  }

  if (conditioningSection) {
    sections.push(<Divider />);
    sections.push(conditioningSection);
  }

  sections.push(<Divider />);
  sections.push(footerSection);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: CARD_W,
        // Use minHeight (not fixed height) so sparse variants don't leave dead
        // space and the densest variant never clips the footer.
        minHeight: PERSONAL_CARD_H,
        backgroundColor: CARD_THEME.bg,
        fontFamily: CARD_THEME.fontFamily,
      }}
    >
      {sections}
    </div>
  );
}

// ── Podium ────────────────────────────────────────────────────────────────────

/** One ranked entry for the Podium primitive. */
export interface PodiumEntry {
  /** Short display label (truncated to ~12 chars for layout safety). */
  label: string;
  /** Numeric count shown below the bar. */
  count: number;
}

/**
 * Classic 3-column podium visualization. Entries are rendered in the traditional
 * 2nd–1st–3rd left-to-right order. Missing entries (2nd or 3rd absent) are
 * replaced with a dimmed "—" placeholder so the layout stays symmetrical.
 *
 * @param entries    - Up to 3 ranked entries (index 0 = 1st place, …).
 * @param countLabel - Unit suffix appended after each count value.
 * @param colors     - Optional rank colors: [1st, 2nd, 3rd] (defaults to
 *                     accent yellow, muted, subtle).
 */
export function Podium(props: {
  entries: PodiumEntry[];
  countLabel?: string;
  colors?: [string, string, string];
}): VNode {
  const entries = props.entries;
  const colors: [string, string, string] = props.colors ?? [
    CARD_THEME.accentYellow,
    CARD_THEME.textMuted,
    CARD_THEME.accentOrange,
  ];

  // Classic podium bar heights (px): 2nd = 70, 1st = 100, 3rd = 50
  const BAR_H: [number, number, number] = [70, 100, 50];
  const BAR_W = 180;

  // Display order: [index 1 (2nd), index 0 (1st), index 2 (3rd)]
  const displayOrder = [1, 0, 2] as const;
  const rankLabels = ["2", "1", "3"];

  const columns = displayOrder.map((idx, col) => {
    const entry = entries[idx];
    const color = colors[idx];
    const barH = BAR_H[col];
    const rankLabel = rankLabels[col];

    return (
      <div key={String(col)} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: BAR_W }}>
        {/* Rank number above bar */}
        <div
          style={{
            display: "flex",
            fontSize: 11,
            fontWeight: 700,
            color: color,
            fontFamily: CARD_THEME.fontFamily,
            marginBottom: 4,
          }}
        >
          #{rankLabel}
        </div>
        {/* Bar */}
        <div
          style={{
            display: "flex",
            width: BAR_W - 24,
            height: barH,
            backgroundColor: entry ? color : CARD_THEME.surfaceAlt,
            borderRadius: "4px 4px 0 0",
            opacity: entry ? 1 : 0.3,
          }}
        />
        {/* Label + count below bar */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginTop: 6,
            backgroundColor: CARD_THEME.surfaceAlt,
            borderRadius: "0 0 4px 4px",
            width: BAR_W - 24,
            paddingTop: 6,
            paddingBottom: 6,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 11,
              fontWeight: 700,
              color: entry ? CARD_THEME.text : CARD_THEME.textSubtle,
              fontFamily: CARD_THEME.fontFamily,
              maxWidth: BAR_W - 32,
            }}
          >
            {entry ? entry.label.slice(0, 14) : "—"}
          </div>
          {entry ? (
            <div
              style={{
                display: "flex",
                fontSize: 10,
                color: CARD_THEME.textSubtle,
                fontFamily: CARD_THEME.fontFamily,
                marginTop: 2,
              }}
            >
              {entry.count.toLocaleString("en-US")}
              {props.countLabel ? ` ${props.countLabel}` : ""}
            </div>
          ) : null}
        </div>
      </div>
    );
  });

  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 4 }}>
      {columns}
    </div>
  );
}

// ── Donut ─────────────────────────────────────────────────────────────────────

/**
 * Builds an SVG donut chart string from pie segments using arc paths.
 *
 * Why SVG arc + base64 instead of conic-gradient: satori 0.26 cannot parse
 * `conic-gradient()` in CSS (same limitation that forced the LoyaltyRing to use
 * a solid border). By building an SVG string and embedding it as a
 * `data:image/svg+xml;base64,…` data URI in an `<img>` element, the arc is
 * rasterized by resvg directly — no CSS gradient parsing needed.
 *
 * @param segments  - Values + hex colors (proportional arc per segment).
 * @param size      - Outer SVG canvas size in pixels (square).
 * @param thickness - Donut ring thickness in pixels.
 * @param bgColor   - Fill color for the center hole (matches card background).
 */
export function buildDonutSvg(
  segments: { value: number; color: string }[],
  size: number,
  thickness: number,
  bgColor: string,
): string {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total <= 0) {
    // Empty state: a single grey ring
    const cx = size / 2;
    const r = cx - 2 - thickness / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${bgColor}" stroke-width="${thickness}"/></svg>`;
  }

  const cx = size / 2;
  const cy = size / 2;
  const R = cx - 2; // outer radius
  const r = R - thickness; // inner radius

  const paths: string[] = [];
  let currentAngle = -Math.PI / 2; // start at 12 o'clock

  for (const seg of segments) {
    if (seg.value <= 0) continue;
    const sweepAngle = (seg.value / total) * 2 * Math.PI;
    const endAngle = currentAngle + sweepAngle;
    const largeArc = sweepAngle > Math.PI ? 1 : 0;

    const x1 = cx + R * Math.cos(currentAngle);
    const y1 = cy + R * Math.sin(currentAngle);
    const x2 = cx + R * Math.cos(endAngle);
    const y2 = cy + R * Math.sin(endAngle);
    const x3 = cx + r * Math.cos(endAngle);
    const y3 = cy + r * Math.sin(endAngle);
    const x4 = cx + r * Math.cos(currentAngle);
    const y4 = cy + r * Math.sin(currentAngle);

    const fmt = (n: number) => n.toFixed(2);
    paths.push(
      `<path d="M ${fmt(x1)},${fmt(y1)} A ${fmt(R)},${fmt(R)} 0 ${largeArc},1 ${fmt(x2)},${fmt(y2)} L ${fmt(x3)},${fmt(y3)} A ${fmt(r)},${fmt(r)} 0 ${largeArc},0 ${fmt(x4)},${fmt(y4)} Z" fill="${seg.color}"/>`,
    );

    currentAngle = endAngle;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths.join("")}</svg>`;
}

/**
 * Donut chart primitive rendered via an inline SVG arc embedded as a base64
 * data URI. No conic-gradient — works through satori 0.26 and resvg.
 *
 * @param segments   - Value + color per slice.
 * @param size       - Overall diameter in pixels (default 80).
 * @param thickness  - Ring thickness in pixels (default 18).
 */
export function Donut(props: {
  segments: { value: number; color: string }[];
  size?: number;
  thickness?: number;
}): VNode {
  const size = props.size ?? 80;
  const thickness = props.thickness ?? 18;
  const svg = buildDonutSvg(props.segments, size, thickness, CARD_THEME.bg);
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  return <img src={dataUri} alt="" width={size} height={size} style={{ display: "flex", width: size, height: size }} />;
}

// ── PersonaCardData ────────────────────────────────────────────────────────────

/** One resolved user entry with display name for card rendering. */
export interface ResolvedUserEntry {
  /** Resolved display name (guild member displayName or Discord username). */
  displayName: string;
  /** Raw count for the metric. */
  count: number;
}

/**
 * All data the Persona "trading card" needs, pre-gathered from the DB layer.
 * The renderer is a pure function of this struct — it never touches the DB.
 */
export interface PersonaCardData {
  /** BCP-47 locale string (e.g. "en-US" or "ja"). */
  locale: string;
  /** The selected time window (drives section visibility rules). */
  timeframe: Timeframe;
  /** Display name of the persona shown on the card. */
  personaName: string;
  /** Base64 data URI for the persona avatar, or null for placeholder. */
  personaAvatarDataUri: string | null;

  // ── Stat block ──
  /** Total messages sent by this persona within the timeframe (on this server). */
  totalMessages: number;
  /** Global memory count (personal_memories WHERE persona_lineage_id = lineageId). */
  memoryCount: number;
  /** 1-based server popularity rank (by messages sent). 0 = not ranked / no data. */
  serverRank: number;

  // ── People I remember most (all-time) ──
  /** Top users by personal memory count (global per lineage), top 3. */
  topPeopleByMemory: ResolvedUserEntry[];

  // ── Conditioning (all-time) ──
  /** Top users who gave the most rewards, top 2. */
  mostRewardedBy: ResolvedUserEntry[];
  /** Top users who punished the most, top 2. */
  mostPunishedBy: ResolvedUserEntry[];

  // ── Vibe breakdown (top expression totals, windowable) ──
  /** Total sprite_shown count in window. */
  vibeSprites: number;
  /** Total emoji_used count in window. */
  vibeEmoji: number;
  /** Total sticker_used count in window. */
  vibeStickers: number;
  /** Total tool_used count in window. */
  vibeTools: number;
}

// ── renderPersonaCard ──────────────────────────────────────────────────────────

/**
 * Pure renderer: produces the Persona "trading card" infographic VNode from the
 * pre-gathered data struct. Never accesses the DB or any async resource.
 *
 * @param data - Pre-gathered card data (see {@link PersonaCardData}).
 * @returns A VNode tree suitable for passing to `renderCardToPng`.
 */
export function renderPersonaCard(data: PersonaCardData): VNode {
  const { locale } = data;

  const t = {
    title: localizer(locale, "commands.stats.infographic.persona_title"),
    memoriesLabel: localizer(locale, "commands.stats.infographic.memories_saved"),
    rankLabel: localizer(locale, "commands.stats.infographic.server_rank"),
    rankPrefix: localizer(locale, "commands.stats.infographic.rank_prefix"),
    peopleLabel: localizer(locale, "commands.stats.infographic.people_i_remember"),
    rewardedBy: localizer(locale, "commands.stats.infographic.most_rewarded_by"),
    punishedBy: localizer(locale, "commands.stats.infographic.most_punished_by"),
    vibeLabel: localizer(locale, "commands.stats.infographic.vibe_check"),
    sprites: localizer(locale, "commands.stats.infographic.sprites_label"),
    emoji: localizer(locale, "commands.stats.infographic.emoji_label"),
    stickers: localizer(locale, "commands.stats.infographic.stickers_label"),
    tools: localizer(locale, "commands.stats.infographic.tools_label"),
    messagesLabel: localizer(locale, "commands.stats.fields.messages_persona"),
    noData: localizer(locale, "commands.stats.infographic.no_data"),
    empty: localizer(locale, "commands.stats.empty"),
    footer: localizer(locale, "commands.stats.footer"),
    units: {
      messagesToMe: localizer(locale, "commands.stats.units.messages_to_me"),
      memoriesSaved: localizer(locale, "commands.stats.units.memories_saved"),
    },
  };

  // ── "No data yet" fallback ───────────────────────────────────────────────────
  if (data.totalMessages === 0 && data.memoryCount === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: CARD_W,
          minHeight: PERSONA_CARD_H,
          backgroundColor: CARD_THEME.bg,
          fontFamily: CARD_THEME.fontFamily,
        }}
      >
        <div style={{ display: "flex", fontSize: 48, color: CARD_THEME.textSubtle }}>--</div>
        <div
          style={{
            display: "flex",
            fontSize: 20,
            color: CARD_THEME.textMuted,
            marginTop: 16,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {t.noData}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 14,
            color: CARD_THEME.textSubtle,
            marginTop: 8,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {data.personaName}
        </div>
      </div>
    );
  }

  // ── Header ───────────────────────────────────────────────────────────────────
  const headerSection = (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: PAD_H,
        paddingRight: PAD_H,
        paddingTop: 20,
        paddingBottom: 20,
        backgroundColor: CARD_THEME.surface,
        gap: 16,
      }}
    >
      {data.personaAvatarDataUri ? (
        <div
          style={{
            display: "flex",
            width: 72,
            height: 72,
            borderRadius: "50%",
            overflow: "hidden",
            border: `2px solid ${CARD_THEME.accent}`,
          }}
        >
          <img
            src={data.personaAvatarDataUri}
            alt={data.personaName}
            style={{ display: "flex", width: 72, height: 72, objectFit: "cover" }}
            width={72}
            height={72}
          />
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            width: 72,
            height: 72,
            borderRadius: "50%",
            backgroundColor: CARD_THEME.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 28,
              fontWeight: 700,
              color: CARD_THEME.text,
              fontFamily: CARD_THEME.fontFamily,
            }}
          >
            {data.personaName.slice(0, 1).toUpperCase()}
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontSize: 11,
            fontWeight: 400,
            color: CARD_THEME.textSubtle,
            fontFamily: CARD_THEME.fontFamily,
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {t.title}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 26,
            fontWeight: 700,
            color: CARD_THEME.text,
            fontFamily: CARD_THEME.fontFamily,
            marginTop: 2,
          }}
        >
          {data.personaName}
        </div>
      </div>
    </div>
  );

  // ── Stat block ───────────────────────────────────────────────────────────────
  const statBlockSection = (
    <Section style={{ flexDirection: "row", justifyContent: "space-around" }}>
      {/* Messages */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 700,
            color: CARD_THEME.accent,
            fontFamily: CARD_THEME.fontFamily,
            lineHeight: 1,
          }}
        >
          {data.totalMessages.toLocaleString("en-US")}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 11,
            color: CARD_THEME.textMuted,
            fontFamily: CARD_THEME.fontFamily,
            marginTop: 3,
          }}
        >
          {t.messagesLabel}
        </div>
      </div>
      {/* Memories */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 700,
            color: CARD_THEME.accentGreen,
            fontFamily: CARD_THEME.fontFamily,
            lineHeight: 1,
          }}
        >
          {data.memoryCount.toLocaleString("en-US")}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 11,
            color: CARD_THEME.textMuted,
            fontFamily: CARD_THEME.fontFamily,
            marginTop: 3,
          }}
        >
          {t.memoriesLabel}
        </div>
      </div>
      {/* Server rank */}
      {data.serverRank > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              fontWeight: 700,
              color: CARD_THEME.accentYellow,
              fontFamily: CARD_THEME.fontFamily,
              lineHeight: 1,
            }}
          >
            {t.rankPrefix}
            {data.serverRank}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 11,
              color: CARD_THEME.textMuted,
              fontFamily: CARD_THEME.fontFamily,
              marginTop: 3,
            }}
          >
            {t.rankLabel}
          </div>
        </div>
      ) : null}
    </Section>
  );

  // ── People I remember most ───────────────────────────────────────────────────
  const peopleSection =
    data.topPeopleByMemory.length > 0 ? (
      <Section>
        <div
          style={{
            display: "flex",
            fontSize: 12,
            color: CARD_THEME.textSubtle,
            fontFamily: CARD_THEME.fontFamily,
            marginBottom: 8,
          }}
        >
          {t.peopleLabel}
        </div>
        {data.topPeopleByMemory.slice(0, 3).map((person, i) => (
          <div
            key={String(i)}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", marginBottom: 4, gap: 8 }}
          >
            <div
              style={{
                display: "flex",
                width: 16,
                fontSize: 11,
                color: CARD_THEME.textSubtle,
                fontFamily: CARD_THEME.fontFamily,
              }}
            >
              {i + 1}.
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 13,
                fontWeight: 600,
                color: CARD_THEME.text,
                fontFamily: CARD_THEME.fontFamily,
                flex: 1,
              }}
            >
              {person.displayName}
            </div>
            <div
              style={{ display: "flex", fontSize: 11, color: CARD_THEME.textSubtle, fontFamily: CARD_THEME.fontFamily }}
            >
              {person.count} {t.units.memoriesSaved}
            </div>
          </div>
        ))}
      </Section>
    ) : null;

  // ── Conditioning ─────────────────────────────────────────────────────────────
  const hasRewards = data.mostRewardedBy.length > 0;
  const hasPunishments = data.mostPunishedBy.length > 0;
  const conditioningSection =
    hasRewards || hasPunishments ? (
      <Section style={{ flexDirection: "row", gap: 24 }}>
        {/* Rewarded by */}
        {hasRewards ? (
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div
              style={{
                display: "flex",
                fontSize: 12,
                color: CARD_THEME.accentGreen,
                fontFamily: CARD_THEME.fontFamily,
                marginBottom: 6,
              }}
            >
              {t.rewardedBy}
            </div>
            {data.mostRewardedBy.slice(0, 2).map((u, i) => (
              <div
                key={String(i)}
                style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}
              >
                <div
                  style={{
                    display: "flex",
                    fontSize: 11,
                    color: CARD_THEME.textSubtle,
                    fontFamily: CARD_THEME.fontFamily,
                  }}
                >
                  {i + 1}.
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 12,
                    color: CARD_THEME.text,
                    fontFamily: CARD_THEME.fontFamily,
                    flex: 1,
                  }}
                >
                  {u.displayName}
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 11,
                    color: CARD_THEME.accentGreen,
                    fontFamily: CARD_THEME.fontFamily,
                  }}
                >
                  +{u.count}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {/* Punished by */}
        {hasPunishments ? (
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div
              style={{
                display: "flex",
                fontSize: 12,
                color: CARD_THEME.accentWarm,
                fontFamily: CARD_THEME.fontFamily,
                marginBottom: 6,
              }}
            >
              {t.punishedBy}
            </div>
            {data.mostPunishedBy.slice(0, 2).map((u, i) => (
              <div
                key={String(i)}
                style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}
              >
                <div
                  style={{
                    display: "flex",
                    fontSize: 11,
                    color: CARD_THEME.textSubtle,
                    fontFamily: CARD_THEME.fontFamily,
                  }}
                >
                  {i + 1}.
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 12,
                    color: CARD_THEME.text,
                    fontFamily: CARD_THEME.fontFamily,
                    flex: 1,
                  }}
                >
                  {u.displayName}
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 11,
                    color: CARD_THEME.accentWarm,
                    fontFamily: CARD_THEME.fontFamily,
                  }}
                >
                  -{u.count}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Section>
    ) : null;

  // ── Vibe breakdown (4 horizontal bars) ───────────────────────────────────────
  const vibeData: Array<{ label: string; count: number; color: string }> = [
    { label: t.sprites, count: data.vibeSprites, color: CARD_THEME.accent },
    { label: t.emoji, count: data.vibeEmoji, color: CARD_THEME.accentYellow },
    { label: t.stickers, count: data.vibeStickers, color: CARD_THEME.accentGreen },
    { label: t.tools, count: data.vibeTools, color: CARD_THEME.accentOrange },
  ];
  const vibeMax = Math.max(1, ...vibeData.map((v) => v.count));
  const VIBE_BAR_W = 200;

  const vibeSection =
    vibeMax > 0 ? (
      <Section>
        <div
          style={{
            display: "flex",
            fontSize: 12,
            color: CARD_THEME.textSubtle,
            fontFamily: CARD_THEME.fontFamily,
            marginBottom: 8,
          }}
        >
          {t.vibeLabel}
        </div>
        {vibeData.map((vibe, i) => (
          <div
            key={String(i)}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", marginBottom: 6, gap: 8 }}
          >
            <div
              style={{
                display: "flex",
                width: 60,
                fontSize: 11,
                color: CARD_THEME.textMuted,
                fontFamily: CARD_THEME.fontFamily,
              }}
            >
              {vibe.label}
            </div>
            <div
              style={{ display: "flex", flex: 1, height: 10, backgroundColor: CARD_THEME.surfaceAlt, borderRadius: 4 }}
            >
              <div
                style={{
                  display: "flex",
                  width: vibe.count > 0 ? Math.max(4, Math.round((vibe.count / vibeMax) * VIBE_BAR_W)) : 0,
                  height: 10,
                  backgroundColor: vibe.color,
                  borderRadius: 4,
                }}
              />
            </div>
            <div
              style={{
                display: "flex",
                width: 36,
                fontSize: 11,
                color: CARD_THEME.textSubtle,
                fontFamily: CARD_THEME.fontFamily,
                justifyContent: "flex-end",
              }}
            >
              {vibe.count > 0 ? vibe.count.toLocaleString("en-US") : "—"}
            </div>
          </div>
        ))}
      </Section>
    ) : null;

  // ── Footer ────────────────────────────────────────────────────────────────────
  const personaFooter = (
    <div
      style={{
        display: "flex",
        paddingLeft: PAD_H,
        paddingRight: PAD_H,
        paddingTop: 8,
        paddingBottom: 12,
        backgroundColor: CARD_THEME.surface,
      }}
    >
      <div style={{ display: "flex", fontSize: 10, color: CARD_THEME.textSubtle, fontFamily: CARD_THEME.fontFamily }}>
        {t.footer}
      </div>
    </div>
  );

  // ── Assemble ──────────────────────────────────────────────────────────────────
  const sections: unknown[] = [headerSection, <Divider />, statBlockSection];

  if (peopleSection) {
    sections.push(<Divider />);
    sections.push(peopleSection);
  }
  if (conditioningSection) {
    sections.push(<Divider />);
    sections.push(conditioningSection);
  }
  if (vibeSection) {
    sections.push(<Divider />);
    sections.push(vibeSection);
  }

  sections.push(<Divider />);
  sections.push(personaFooter);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: CARD_W,
        minHeight: PERSONA_CARD_H,
        backgroundColor: CARD_THEME.bg,
        fontFamily: CARD_THEME.fontFamily,
      }}
    >
      {sections}
    </div>
  );
}

// ── ServerCardData ─────────────────────────────────────────────────────────────

/**
 * All data the Server "Year in Review" card needs, pre-gathered from the DB layer.
 * The renderer is a pure function of this struct — it never touches the DB.
 */
export interface ServerCardData {
  /** BCP-47 locale string (e.g. "en-US" or "ja"). */
  locale: string;
  /** The selected time window (drives section visibility rules). */
  timeframe: Timeframe;
  /** Server display name shown on the card. */
  serverName: string;

  // ── Leaderboards ──
  /** Top chatters (message_sent), top 3, with resolved display names. */
  topChatters: Array<ResolvedUserEntry & { rank: number }>;
  /** Top personas by messages, top 3 (persona names pre-resolved). */
  topPersonas: Array<{ name: string; count: number; rank: number }>;

  // ── Collective stats (all-time only) ──
  /** Generation totals from quota tables, or null when timeframe ≠ all_time. */
  generationTotals: { text: number; images: number; videos: number } | null;
  /** Total estimated cost across all users in the server. */
  estimatedCost: number;

  // ── Activity ──
  /** Peak activity hour (0–23), or null when no data. */
  peakHour: number | null;

  // ── Expression ──
  /** Top emoji + sticker combined (key = name, count = uses), top 3. */
  mostLovedExpression: Array<{ key: string; count: number }>;

  // ── Commands ──
  /** Most-used commands on this server, top 3. */
  topCommands: Array<{ command: string; count: number }>;
}

// ── renderServerCard ───────────────────────────────────────────────────────────

/**
 * Pure renderer: produces the Server "Year in Review" infographic card VNode
 * from the pre-gathered data struct. Never accesses the DB or any async resource.
 *
 * @param data - Pre-gathered card data (see {@link ServerCardData}).
 * @returns A VNode tree suitable for passing to `renderCardToPng`.
 */
export function renderServerCard(data: ServerCardData): VNode {
  const { locale } = data;

  const t = {
    title: localizer(locale, "commands.stats.infographic.server_title"),
    topChatters: localizer(locale, "commands.stats.infographic.top_chatters"),
    topPersonas: localizer(locale, "commands.stats.infographic.top_personas"),
    collectiveStats: localizer(locale, "commands.stats.infographic.collective_stats"),
    textGenerations: localizer(locale, "commands.stats.infographic.text_generations"),
    imageGenerations: localizer(locale, "commands.stats.infographic.image_generations"),
    videoGenerations: localizer(locale, "commands.stats.infographic.video_generations"),
    estCost: localizer(locale, "commands.stats.fields.est_cost"),
    peakHour: localizer(locale, "commands.stats.infographic.peak_hour"),
    mostLoved: localizer(locale, "commands.stats.infographic.most_loved"),
    topCommands: localizer(locale, "commands.stats.infographic.top_commands"),
    noData: localizer(locale, "commands.stats.infographic.no_data"),
    empty: localizer(locale, "commands.stats.empty"),
    footer: localizer(locale, "commands.stats.footer"),
    units: {
      messagesToMe: localizer(locale, "commands.stats.units.messages_to_me"),
    },
  };

  const hasData = data.topChatters.length > 0 || data.topPersonas.length > 0 || data.topCommands.length > 0;

  // ── "No data yet" fallback ───────────────────────────────────────────────────
  if (!hasData) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: CARD_W,
          minHeight: SERVER_CARD_H,
          backgroundColor: CARD_THEME.bg,
          fontFamily: CARD_THEME.fontFamily,
        }}
      >
        <div style={{ display: "flex", fontSize: 48, color: CARD_THEME.textSubtle }}>--</div>
        <div
          style={{
            display: "flex",
            fontSize: 20,
            color: CARD_THEME.textMuted,
            marginTop: 16,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {t.noData}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 14,
            color: CARD_THEME.textSubtle,
            marginTop: 8,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {data.serverName}
        </div>
      </div>
    );
  }

  // ── Header ───────────────────────────────────────────────────────────────────
  const serverHeaderSection = (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingLeft: PAD_H,
        paddingRight: PAD_H,
        paddingTop: 20,
        paddingBottom: 20,
        backgroundColor: CARD_THEME.surface,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontSize: 11,
            color: CARD_THEME.textSubtle,
            fontFamily: CARD_THEME.fontFamily,
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          {t.title}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 24,
            fontWeight: 700,
            color: CARD_THEME.text,
            fontFamily: CARD_THEME.fontFamily,
            marginTop: 2,
          }}
        >
          {data.serverName}
        </div>
      </div>
      {/* Server cost badge */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <div style={{ display: "flex", fontSize: 11, color: CARD_THEME.textSubtle, fontFamily: CARD_THEME.fontFamily }}>
          {t.estCost}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 20,
            fontWeight: 700,
            color: CARD_THEME.accentGreen,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          ${data.estimatedCost.toFixed(2)}
        </div>
      </div>
    </div>
  );

  // ── Leaderboards: top chatters (podium) + top personas (list) ────────────────
  const chattersSection = (
    <Section>
      <div
        style={{
          display: "flex",
          fontSize: 12,
          color: CARD_THEME.textSubtle,
          fontFamily: CARD_THEME.fontFamily,
          marginBottom: 12,
        }}
      >
        {t.topChatters}
      </div>
      <Podium
        entries={data.topChatters.slice(0, 3).map((c) => ({ label: c.displayName, count: c.count }))}
        countLabel={t.units.messagesToMe}
      />
    </Section>
  );

  const personasSection =
    data.topPersonas.length > 0 ? (
      <Section>
        <div
          style={{
            display: "flex",
            fontSize: 12,
            color: CARD_THEME.textSubtle,
            fontFamily: CARD_THEME.fontFamily,
            marginBottom: 8,
          }}
        >
          {t.topPersonas}
        </div>
        {data.topPersonas.slice(0, 3).map((p, i) => (
          <div
            key={String(i)}
            style={{ display: "flex", flexDirection: "row", alignItems: "center", marginBottom: 4, gap: 8 }}
          >
            <div
              style={{
                display: "flex",
                width: 16,
                fontSize: 11,
                color: CARD_THEME.textSubtle,
                fontFamily: CARD_THEME.fontFamily,
              }}
            >
              {i + 1}.
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 13,
                fontWeight: 600,
                color: CARD_THEME.text,
                fontFamily: CARD_THEME.fontFamily,
                flex: 1,
              }}
            >
              {p.name}
            </div>
            <div
              style={{ display: "flex", fontSize: 11, color: CARD_THEME.textSubtle, fontFamily: CARD_THEME.fontFamily }}
            >
              {p.count.toLocaleString("en-US")} {t.units.messagesToMe}
            </div>
          </div>
        ))}
      </Section>
    ) : null;

  // ── Collective stats (all-time only) ─────────────────────────────────────────
  const collectiveSection = data.generationTotals ? (
    <Section style={{ flexDirection: "row", justifyContent: "space-around" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            fontSize: 22,
            fontWeight: 700,
            color: CARD_THEME.accent,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {data.generationTotals.text.toLocaleString("en-US")}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 11,
            color: CARD_THEME.textMuted,
            fontFamily: CARD_THEME.fontFamily,
            marginTop: 3,
          }}
        >
          {t.textGenerations}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            fontSize: 22,
            fontWeight: 700,
            color: CARD_THEME.accentYellow,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {data.generationTotals.images.toLocaleString("en-US")}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 11,
            color: CARD_THEME.textMuted,
            fontFamily: CARD_THEME.fontFamily,
            marginTop: 3,
          }}
        >
          {t.imageGenerations}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            fontSize: 22,
            fontWeight: 700,
            color: CARD_THEME.accentOrange,
            fontFamily: CARD_THEME.fontFamily,
          }}
        >
          {data.generationTotals.videos.toLocaleString("en-US")}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 11,
            color: CARD_THEME.textMuted,
            fontFamily: CARD_THEME.fontFamily,
            marginTop: 3,
          }}
        >
          {t.videoGenerations}
        </div>
      </div>
    </Section>
  ) : null;

  // ── Peak hour + most loved expression ────────────────────────────────────────
  const formatHour = (h: number): string => {
    const ampm = h >= 12 ? "PM" : "AM";
    const display = h % 12 === 0 ? 12 : h % 12;
    return `${display} ${ampm}`;
  };

  const activityRow = (
    <Section style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
      {/* Peak hour */}
      {data.peakHour !== null ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{ display: "flex", fontSize: 12, color: CARD_THEME.textSubtle, fontFamily: CARD_THEME.fontFamily }}
          >
            {t.peakHour}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 20,
              fontWeight: 700,
              color: CARD_THEME.accent,
              fontFamily: CARD_THEME.fontFamily,
              marginTop: 3,
            }}
          >
            {formatHour(data.peakHour)}
          </div>
        </div>
      ) : null}
      {/* Most loved expression */}
      {data.mostLovedExpression.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div
            style={{ display: "flex", fontSize: 12, color: CARD_THEME.textSubtle, fontFamily: CARD_THEME.fontFamily }}
          >
            {t.mostLoved}
          </div>
          <div style={{ display: "flex", flexDirection: "row", gap: 8, marginTop: 4 }}>
            {data.mostLovedExpression.slice(0, 3).map((expr) => (
              <div
                key={expr.key}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  backgroundColor: CARD_THEME.surfaceAlt,
                  borderRadius: 6,
                  paddingLeft: 8,
                  paddingRight: 8,
                  paddingTop: 4,
                  paddingBottom: 4,
                }}
              >
                <div
                  style={{ display: "flex", fontSize: 12, color: CARD_THEME.text, fontFamily: CARD_THEME.fontFamily }}
                >
                  {expr.key}
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 10,
                    color: CARD_THEME.textSubtle,
                    fontFamily: CARD_THEME.fontFamily,
                  }}
                >
                  ×{expr.count}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Section>
  );

  // ── Top commands ──────────────────────────────────────────────────────────────
  const commandsSection =
    data.topCommands.length > 0 ? (
      <Section>
        <div
          style={{
            display: "flex",
            fontSize: 12,
            color: CARD_THEME.textSubtle,
            fontFamily: CARD_THEME.fontFamily,
            marginBottom: 6,
          }}
        >
          {t.topCommands}
        </div>
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {data.topCommands.slice(0, 4).map((cmd, i) => (
            <div
              key={String(i)}
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                backgroundColor: CARD_THEME.surfaceAlt,
                borderRadius: 6,
                paddingLeft: 10,
                paddingRight: 10,
                paddingTop: 5,
                paddingBottom: 5,
              }}
            >
              <div style={{ display: "flex", fontSize: 12, color: CARD_THEME.text, fontFamily: CARD_THEME.fontFamily }}>
                /{cmd.command}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 10,
                  color: CARD_THEME.textSubtle,
                  fontFamily: CARD_THEME.fontFamily,
                }}
              >
                {cmd.count}×
              </div>
            </div>
          ))}
        </div>
      </Section>
    ) : null;

  // ── Footer ────────────────────────────────────────────────────────────────────
  const serverFooter = (
    <div
      style={{
        display: "flex",
        paddingLeft: PAD_H,
        paddingRight: PAD_H,
        paddingTop: 8,
        paddingBottom: 12,
        backgroundColor: CARD_THEME.surface,
      }}
    >
      <div style={{ display: "flex", fontSize: 10, color: CARD_THEME.textSubtle, fontFamily: CARD_THEME.fontFamily }}>
        {t.footer}
      </div>
    </div>
  );

  // ── Assemble ──────────────────────────────────────────────────────────────────
  const sections: unknown[] = [serverHeaderSection, <Divider />, chattersSection];

  if (personasSection) {
    sections.push(<Divider />);
    sections.push(personasSection);
  }
  if (collectiveSection) {
    sections.push(<Divider />);
    sections.push(collectiveSection);
  }

  sections.push(<Divider />);
  sections.push(activityRow);

  if (commandsSection) {
    sections.push(<Divider />);
    sections.push(commandsSection);
  }

  sections.push(<Divider />);
  sections.push(serverFooter);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: CARD_W,
        minHeight: SERVER_CARD_H,
        backgroundColor: CARD_THEME.bg,
        fontFamily: CARD_THEME.fontFamily,
      }}
    >
      {sections}
    </div>
  );
}
