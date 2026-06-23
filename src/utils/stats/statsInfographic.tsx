/**
 * statsInfographic.tsx — satori (JSX → SVG) layer for the `/stats generate`
 * infographic (plans/stat-tracking.md §10, Phase 3).
 *
 * SCOPE — CHUNK 2. Contains:
 *   1. The hand-rolled JSX factory satori needs (`h` / `Fragment`).
 *   2. Shared viz primitives (BigNumberHero, ActivityHeatmapViz, ActivityRing24h,
 *      LoyaltyRing, StreakBlock, ModelCostRow, ExpressionRow, ConditioningRow).
 *   3. `PersonalCardData` — the typed input struct for the Personal card.
 *   4. `renderPersonalCard(data)` — pure function: data → VNode, no DB access.
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
 * - conic-gradient, linear-gradient: supported since satori 0.10.
 * - <img src="data:...">: supported for embedded avatars.
 * - Emoji in text: NOT supported without configuring emoji provider — avoid.
 *
 * Card dimensions and color theme are named constants here; promotion to env vars
 * (CLAUDE.md rule #6) happens in Chunk 3 command wiring.
 * TODO(chunk3): expose CARD_W, CARD_H, and CARD_THEME colors via env vars
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

/** Fixed card dimensions (promoted to env vars in Chunk 3). */
export const CARD_W = 900;
export const CARD_H = 1060;

/**
 * Centralized color + typography constants for all infographic cards.
 * Change values here to retheme every card at once.
 * TODO(chunk3): expose as STATS_CARD_* env vars
 */
export const CARD_THEME = {
  bg: "#1e1f22",
  surface: "#2b2d31",
  surfaceAlt: "#313338",
  border: "#3d4045",
  text: "#ffffff",
  textMuted: "#949ba4",
  textSubtle: "#6d757d",
  accent: "#5865f2", // Discord blurple
  accentWarm: "#ed4245", // danger/red
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
 * @param current  - Current streak in days.
 * @param longest  - All-time longest streak in days.
 * @param daysLabel - Localized "days" suffix.
 * @param currentLabel - Localized label for current streak.
 * @param longestLabel - Localized label for longest streak.
 */
export function StreakBlock(props: {
  current: number;
  longest: number;
  daysLabel: string;
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
          {props.daysLabel}
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
          {props.longest} {props.daysLabel}
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
    days: (n: number) => localizer(locale, "commands.stats.days", { count: n }),
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
          height: CARD_H,
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
        daysLabel={t.days(data.currentStreak ?? 0).replace(/^\d+\s*/, "")}
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
        height: CARD_H,
        backgroundColor: CARD_THEME.bg,
        fontFamily: CARD_THEME.fontFamily,
        overflow: "hidden",
      }}
    >
      {sections}
    </div>
  );
}
