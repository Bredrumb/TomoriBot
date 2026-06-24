/**
 * Pure satori renderers for the `/stats generate` infographics.
 * Gatherers provide the complete data structs; this module never reads the DB
 * or Discord API.
 */
import type { Timeframe } from "@/utils/stats/statsDashboard";
import { localizer } from "@/utils/text/localizer";

// ── JSX factory ───────────────────────────────────────────────────────────────

export interface VNode {
  type: string;
  props: Record<string, unknown> & { children?: unknown };
}

declare global {
  namespace JSX {
    type Element = VNode;
    interface IntrinsicElements {
      [tag: string]: Record<string, unknown> & { children?: unknown };
    }
  }
}

export function h(
  type: string | ((props: Record<string, unknown> & { children?: unknown }) => unknown),
  props: Record<string, unknown> | null,
  ...children: unknown[]
): VNode {
  const flatChildren = children.flat();
  const normalizedChildren =
    flatChildren.length === 0 ? undefined : flatChildren.length === 1 ? flatChildren[0] : flatChildren;
  const mergedProps = { ...(props ?? {}), children: normalizedChildren };

  if (typeof type === "function") return type(mergedProps) as VNode;
  return { type, props: mergedProps };
}

export function Fragment(props: { children?: unknown }): unknown {
  return props.children;
}

// ── Canvas + theme ────────────────────────────────────────────────────────────

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Logical canvas width. All typography is sized for a Discord-scale preview. */
export const CARD_W = readIntEnv("STATS_CARD_W", 1080);
const BASE_CARD_W = 1080;
const CARD_SCALE = CARD_W / BASE_CARD_W;

function scaled(value: number): number {
  return Math.max(1, Math.round(value * CARD_SCALE));
}

/**
 * Cards deliberately use different heights: Personal Wrapped is a tall
 * portrait share card, while leaderboard cards grow with their ranked rows.
 */
export const PERSONAL_CARD_H = scaled(1920);
export const PERSONA_CARD_H = scaled(1100);
/** Server Leaderboard mirrors the Personal Wrapped 9:16 portrait share format. */
export const SERVER_CARD_H = scaled(2010);
/** @deprecated Use the card-specific height helpers instead. */
export const CARD_H = PERSONAL_CARD_H;

/** TomoriBot brand palette. Operators may override the three structural colors. */
export const CARD_THEME = {
  bg: process.env.STATS_CARD_THEME_BG ?? "#1d100e",
  surface: process.env.STATS_CARD_THEME_SURFACE ?? "#2c1815",
  surfaceAlt: "#160b0a",
  border: "#4d2b26",
  text: "#f7f2f1",
  textMuted: "#d1b8b2",
  textSubtle: "#ab8981",
  red: process.env.STATS_CARD_THEME_ACCENT ?? "#e7322a",
  magenta: "#db1458",
  cyan: "#00e5ff",
  teal: "#6ec4cf",
  activity: "#f56a3f",
  fontFamily: "Noto Sans JP",
} as const;

const PAD = scaled(56);
const CONTENT_W = CARD_W - PAD * 2;
const PIE_COLORS = [CARD_THEME.red, CARD_THEME.magenta, CARD_THEME.cyan, CARD_THEME.teal] as const;

function formatInt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`;
}

function timeframeLabel(locale: string, timeframe: Timeframe): string {
  return localizer(locale, `commands.choices.${timeframe}`);
}

function Divider(): VNode {
  return <div style={{ display: "flex", width: "100%", height: scaled(1), backgroundColor: CARD_THEME.border }} />;
}

function CardFrame(props: Record<string, unknown> & { children?: unknown; height: number }): VNode {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        width: CARD_W,
        height: props.height,
        padding: PAD,
        backgroundColor: CARD_THEME.bg,
        color: CARD_THEME.text,
        fontFamily: CARD_THEME.fontFamily,
      }}
    >
      {props.children}
    </div>
  );
}

function Section(props: Record<string, unknown> & { title?: string; children?: unknown; compact?: boolean }): VNode {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        paddingTop: scaled(props.compact ? 16 : 22),
        paddingBottom: scaled(props.compact ? 16 : 22),
      }}
    >
      {props.title ? (
        <div
          style={{
            display: "flex",
            marginBottom: scaled(14),
            color: CARD_THEME.teal,
            fontFamily: CARD_THEME.fontFamily,
            fontSize: scaled(28),
            fontWeight: 700,
            letterSpacing: 0,
          }}
        >
          {props.title}
        </div>
      ) : null}
      {props.children}
    </div>
  );
}

function Avatar(
  props: Record<string, unknown> & { name: string; dataUri: string | null; size?: number; accent?: string },
): VNode {
  const size = props.size ?? scaled(64);
  const initials = props.name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderRadius: "50%",
        border: `${scaled(2)}px solid ${props.accent ?? CARD_THEME.red}`,
        backgroundColor: CARD_THEME.surfaceAlt,
        color: CARD_THEME.text,
        fontFamily: CARD_THEME.fontFamily,
        fontSize: Math.max(scaled(22), Math.round(size * 0.36)),
        fontWeight: 700,
      }}
    >
      {props.dataUri ? (
        <img
          src={props.dataUri}
          alt=""
          width={size}
          height={size}
          style={{ display: "flex", width: size, height: size, objectFit: "cover" }}
        />
      ) : (
        initials
      )}
    </div>
  );
}

function AvatarStack(
  props: Record<string, unknown> & {
    first: { name: string; dataUri: string | null };
    second: { name: string; dataUri: string | null };
  },
): VNode {
  return (
    <div style={{ display: "flex", flexDirection: "row", width: scaled(150), alignItems: "center" }}>
      <Avatar name={props.first.name} dataUri={props.first.dataUri} size={scaled(88)} accent={CARD_THEME.cyan} />
      <div style={{ display: "flex", marginLeft: -scaled(30) }}>
        <Avatar name={props.second.name} dataUri={props.second.dataUri} size={scaled(88)} accent={CARD_THEME.magenta} />
      </div>
    </div>
  );
}

function Header(props: Record<string, unknown> & { title: string; subtitle: string; children?: unknown }): VNode {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        minHeight: scaled(124),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingBottom: scaled(22),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", maxWidth: CONTENT_W - scaled(390) }}>
        <div
          style={{
            display: "flex",
            color: CARD_THEME.text,
            fontFamily: CARD_THEME.fontFamily,
            fontSize: scaled(58),
            fontWeight: 700,
            lineHeight: 1.1,
          }}
        >
          {props.title}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: scaled(18) }}>
        <div
          style={{
            display: "flex",
            maxWidth: scaled(210),
            color: CARD_THEME.teal,
            fontFamily: CARD_THEME.fontFamily,
            fontSize: scaled(25),
            fontWeight: 700,
            lineHeight: 1.2,
            textAlign: "right",
          }}
        >
          {props.subtitle}
        </div>
        {props.children}
      </div>
    </div>
  );
}

function TokenTotals(
  props: Record<string, unknown> & {
    inputTokens: number;
    outputTokens: number;
    inputLabel: string;
    outputLabel: string;
  },
): VNode {
  return (
    <div style={{ display: "flex", flexDirection: "row", width: "100%", alignItems: "baseline", gap: scaled(28) }}>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: scaled(12) }}>
        <div style={{ display: "flex", color: CARD_THEME.textSubtle, fontSize: scaled(25) }}>{props.inputLabel}</div>
        <div style={{ display: "flex", color: CARD_THEME.cyan, fontSize: scaled(56), fontWeight: 700 }}>
          {formatInt(props.inputTokens)}
        </div>
      </div>
      <div style={{ display: "flex", width: scaled(1), height: scaled(54), backgroundColor: CARD_THEME.border }} />
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: scaled(12) }}>
        <div style={{ display: "flex", color: CARD_THEME.textSubtle, fontSize: scaled(25) }}>{props.outputLabel}</div>
        <div style={{ display: "flex", color: CARD_THEME.teal, fontSize: scaled(56), fontWeight: 700 }}>
          {formatInt(props.outputTokens)}
        </div>
      </div>
    </div>
  );
}

function Footer(props: Record<string, unknown> & { text: string }): VNode {
  return (
    <div style={{ display: "flex", width: "100%", paddingTop: scaled(18) }}>
      <div style={{ display: "flex", color: CARD_THEME.textSubtle, fontSize: scaled(22), lineHeight: 1.25 }}>
        {props.text}
      </div>
    </div>
  );
}

interface MetricTileData {
  label: string;
  value: string;
  color: string;
  detail?: string;
}

function MetricTile(props: Record<string, unknown> & MetricTileData & { width: string }): VNode {
  return (
    <div
      style={{
        display: "flex",
        width: props.width,
        minHeight: scaled(112),
        flexDirection: "column",
        justifyContent: "space-between",
        padding: scaled(16),
        borderRadius: scaled(12),
        backgroundColor: CARD_THEME.surface,
      }}
    >
      <div style={{ display: "flex", color: CARD_THEME.textMuted, fontSize: scaled(22), lineHeight: 1.2 }}>
        {props.label}
      </div>
      <div style={{ display: "flex", color: props.color, fontSize: scaled(34), fontWeight: 700, lineHeight: 1.15 }}>
        {props.value}
      </div>
      {props.detail ? (
        <div style={{ display: "flex", color: CARD_THEME.textSubtle, fontSize: scaled(22), lineHeight: 1.15 }}>
          {props.detail}
        </div>
      ) : null}
    </div>
  );
}

function MetricGrid(props: Record<string, unknown> & { items: MetricTileData[] }): VNode {
  const width = props.items.length === 2 ? "49%" : "32%";
  return (
    <div
      style={{ display: "flex", flexDirection: "row", width: "100%", justifyContent: "space-between", gap: scaled(12) }}
    >
      {props.items.map((item) => (
        <MetricTile key={item.label} {...item} width={width} />
      ))}
    </div>
  );
}

export interface PersonIcon {
  name: string;
  avatarDataUri: string | null;
}

export interface EmojiIcon {
  name: string;
  imageDataUri: string | null;
}

export interface BreakdownSegment {
  label: string;
  count: number;
}

function EmojiStrip(props: Record<string, unknown> & { emojis: EmojiIcon[]; empty: string }): VNode {
  if (props.emojis.length === 0) {
    return <div style={{ display: "flex", color: CARD_THEME.textSubtle, fontSize: scaled(22) }}>{props.empty}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "row", gap: scaled(16), width: "100%" }}>
      {props.emojis.slice(0, 5).map((emoji) => (
        <div
          key={emoji.name}
          style={{
            display: "flex",
            width: scaled(96),
            height: scaled(96),
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            borderRadius: scaled(8),
            backgroundColor: CARD_THEME.surfaceAlt,
          }}
        >
          {emoji.imageDataUri ? (
            <img
              src={emoji.imageDataUri}
              alt=""
              width={scaled(72)}
              height={scaled(72)}
              style={{ display: "flex", width: scaled(72), height: scaled(72) }}
            />
          ) : (
            <div style={{ display: "flex", color: CARD_THEME.textMuted, fontSize: scaled(22), textAlign: "center" }}>
              {emoji.name.slice(0, 8)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function arcPoint(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

/** Produces a data-URI-safe SVG donut without unsupported CSS conic gradients. */
export function buildDonutSvg(
  segments: Array<{ value: number; color: string }>,
  size = 112,
  thickness = 20,
  trackColor = CARD_THEME.surfaceAlt,
): string {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  const radius = (size - thickness) / 2;
  const center = size / 2;
  const track = `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${trackColor}" stroke-width="${thickness}"/>`;

  if (total === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${track}</svg>`;
  }

  let cursor = 0;
  const paths = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const portion = (segment.value / total) * 360;
      const start = arcPoint(center, center, radius, cursor);
      const end = arcPoint(center, center, radius, cursor + Math.min(portion, 359.999));
      cursor += portion;
      const largeArc = portion > 180 ? 1 : 0;
      return `<path d="M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}" fill="none" stroke="${segment.color}" stroke-width="${thickness}" stroke-linecap="butt"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${track}${paths}</svg>`;
}

function Donut(props: Record<string, unknown> & { segments: BreakdownSegment[]; size?: number }): VNode {
  const size = props.size ?? scaled(112);
  const svg = buildDonutSvg(
    props.segments
      .slice(0, PIE_COLORS.length)
      .map((segment, index) => ({ value: segment.count, color: PIE_COLORS[index] })),
    size,
    scaled(20),
  );
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  return <img src={dataUri} alt="" width={size} height={size} style={{ display: "flex", width: size, height: size }} />;
}

function BreakdownChart(
  props: Record<string, unknown> & { title: string; segments: BreakdownSegment[]; empty: string },
): VNode {
  const segments = props.segments.slice(0, PIE_COLORS.length);
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "48%" }}>
      <div
        style={{
          display: "flex",
          marginBottom: scaled(14),
          color: CARD_THEME.textMuted,
          fontSize: scaled(24),
          fontWeight: 700,
        }}
      >
        {props.title}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: scaled(16) }}>
        <Donut segments={segments} size={scaled(158)} />
        <div style={{ display: "flex", flexDirection: "column", width: scaled(180), gap: scaled(9) }}>
          {segments.length > 0 ? (
            segments.map((segment, index) => (
              <div
                key={segment.label}
                style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: scaled(7) }}
              >
                <div
                  style={{
                    display: "flex",
                    width: scaled(12),
                    height: scaled(12),
                    flexShrink: 0,
                    borderRadius: "50%",
                    backgroundColor: PIE_COLORS[index],
                  }}
                />
                <div style={{ display: "flex", color: CARD_THEME.textMuted, fontSize: scaled(22), lineHeight: 1.15 }}>
                  {segment.label.slice(0, 18)}
                </div>
              </div>
            ))
          ) : (
            <div style={{ display: "flex", color: CARD_THEME.textSubtle, fontSize: scaled(22) }}>{props.empty}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Personal Wrapped ──────────────────────────────────────────────────────────

export interface PersonalCardPalette {
  background: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  accentSecondary: string;
  border: string;
}

/** Neutral fallback used when the leading persona has no usable avatar image. */
export const DEFAULT_PERSONAL_CARD_PALETTE: PersonalCardPalette = {
  background: "#f6f5ef",
  surface: "#eae7dc",
  ink: "#1e1d19",
  muted: "#54514a",
  accent: "#2f6259",
  accentSecondary: "#315c87",
  border: "#c3c9c1",
};

export interface PersonalFavoritePersona extends PersonIcon {
  totalTokens: number;
  estimatedCost: number;
}

export type PersonalHeroVariant = 0 | 1 | 2 | 3 | 4;
export const PERSONAL_HERO_VARIANT_COUNT = 5;

export interface PersonalCardData {
  locale: string;
  timeframe: Timeframe;
  username: string;
  userAvatarDataUri: string | null;
  tomoriconDataUri: string | null;
  palette: PersonalCardPalette;
  totalTokens: number;
  totalTriggers: number;
  estimatedCost: number;
  favoritePersonas: PersonalFavoritePersona[];
  favoriteModelName: string | null;
  heroVariant: PersonalHeroVariant;
}

function truncateCardText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, Math.max(1, maxLength - 3))}...` : value;
}

function PersonalImage(
  props: Record<string, unknown> & {
    name: string;
    dataUri: string | null;
    size: number;
    palette: PersonalCardPalette;
    rounded?: boolean;
  },
): VNode {
  const initials = props.name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <div
      style={{
        display: "flex",
        width: props.size,
        height: props.size,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderRadius: props.rounded ? "50%" : scaled(18),
        border: `${scaled(2)}px solid ${props.palette.accent}`,
        backgroundColor: props.palette.surface,
        color: props.palette.ink,
        fontSize: Math.max(scaled(24), Math.round(props.size * 0.35)),
        fontWeight: 700,
      }}
    >
      {props.dataUri ? (
        <img
          src={props.dataUri}
          alt=""
          width={props.size}
          height={props.size}
          style={{ display: "flex", width: props.size, height: props.size, objectFit: "cover" }}
        />
      ) : (
        initials
      )}
    </div>
  );
}

/** Decorative layers behind the #1 avatar; the gatherer picks one per generated card. */
function PersonalHeroDecor(
  props: Record<string, unknown> & { palette: PersonalCardPalette; variant: PersonalHeroVariant },
): VNode {
  const layer = (style: Record<string, unknown>): VNode => (
    <div style={{ display: "flex", position: "absolute", ...style }} />
  );
  const { accent, accentSecondary } = props.palette;
  let layers: VNode[];

  switch (props.variant) {
    case 1:
      layers = [
        layer({
          width: scaled(470),
          height: scaled(260),
          top: -scaled(60),
          left: -scaled(110),
          backgroundColor: accentSecondary,
          opacity: 0.2,
          transform: "rotate(-14deg)",
        }),
        layer({
          width: scaled(310),
          height: scaled(310),
          top: scaled(110),
          left: scaled(40),
          borderRadius: "50%",
          backgroundColor: accent,
          opacity: 0.2,
        }),
      ];
      break;
    case 2:
      layers = [
        layer({
          width: scaled(400),
          height: scaled(400),
          top: -scaled(150),
          right: scaled(40),
          borderRadius: "50%",
          backgroundColor: accent,
          opacity: 0.18,
        }),
        layer({
          width: scaled(500),
          height: scaled(180),
          bottom: scaled(40),
          left: -scaled(120),
          borderRadius: scaled(100),
          backgroundColor: accentSecondary,
          opacity: 0.18,
          transform: "rotate(16deg)",
        }),
      ];
      break;
    case 3:
      layers = [
        layer({
          width: scaled(190),
          height: scaled(610),
          top: -scaled(80),
          left: scaled(74),
          borderRadius: scaled(100),
          backgroundColor: accent,
          opacity: 0.2,
          transform: "rotate(20deg)",
        }),
        layer({
          width: scaled(310),
          height: scaled(310),
          bottom: -scaled(150),
          right: scaled(40),
          borderRadius: scaled(52),
          backgroundColor: accentSecondary,
          opacity: 0.2,
          transform: "rotate(30deg)",
        }),
      ];
      break;
    case 4:
      layers = [
        layer({
          width: scaled(260),
          height: scaled(260),
          top: scaled(54),
          left: scaled(34),
          borderRadius: scaled(44),
          backgroundColor: accentSecondary,
          opacity: 0.2,
          transform: "rotate(20deg)",
        }),
        layer({
          width: scaled(310),
          height: scaled(310),
          bottom: -scaled(120),
          left: scaled(120),
          borderRadius: "50%",
          backgroundColor: accent,
          opacity: 0.2,
        }),
      ];
      break;
    default:
      layers = [
        layer({
          width: scaled(430),
          height: scaled(430),
          top: -scaled(150),
          left: -scaled(100),
          borderRadius: "50%",
          backgroundColor: accent,
          opacity: 0.2,
        }),
        layer({
          width: scaled(330),
          height: scaled(330),
          right: scaled(180),
          bottom: -scaled(150),
          borderRadius: scaled(64),
          backgroundColor: accentSecondary,
          opacity: 0.18,
          transform: "rotate(28deg)",
        }),
      ];
  }

  return (
    <div style={{ display: "flex", position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden" }}>
      {layers}
    </div>
  );
}

function PersonalRankingRow(
  props: Record<string, unknown> & {
    entry: PersonalFavoritePersona;
    rank: number;
    palette: PersonalCardPalette;
  },
): VNode {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        minHeight: scaled(82),
        flexDirection: "row",
        alignItems: "center",
        borderTop: `${scaled(1)}px solid ${props.palette.border}`,
      }}
    >
      <div
        style={{
          display: "flex",
          width: scaled(62),
          color: props.palette.accent,
          fontSize: scaled(34),
          fontWeight: 700,
        }}
      >
        #{props.rank}
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          color: props.palette.ink,
          fontSize: scaled(38),
          fontWeight: 700,
        }}
      >
        {truncateCardText(props.entry.name, 16)}
      </div>
      <div
        style={{
          display: "flex",
          width: scaled(254),
          justifyContent: "flex-end",
          color: props.palette.muted,
          fontSize: scaled(34),
          lineHeight: 1.15,
          textAlign: "right",
        }}
      >
        {formatInt(props.entry.totalTokens)}
      </div>
      <div
        style={{
          display: "flex",
          width: scaled(184),
          justifyContent: "flex-end",
          color: props.palette.muted,
          fontSize: scaled(34),
          lineHeight: 1.15,
          textAlign: "right",
        }}
      >
        {formatCost(props.entry.estimatedCost)}
      </div>
    </div>
  );
}

function PersonalRankingHeader(
  props: Record<string, unknown> & {
    favoritePersonas: string;
    tokens: string;
    spent: string;
    palette: PersonalCardPalette;
  },
): VNode {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        minHeight: scaled(64),
        flexDirection: "row",
        alignItems: "center",
        borderBottom: `${scaled(2)}px solid ${props.palette.accent}`,
      }}
    >
      <div style={{ display: "flex", flex: 1, color: props.palette.accent, fontSize: scaled(38), fontWeight: 700 }}>
        {props.favoritePersonas}
      </div>
      <div
        style={{
          display: "flex",
          width: scaled(254),
          justifyContent: "flex-end",
          color: props.palette.accent,
          fontSize: scaled(30),
          fontWeight: 700,
        }}
      >
        {props.tokens}
      </div>
      <div
        style={{
          display: "flex",
          width: scaled(184),
          justifyContent: "flex-end",
          color: props.palette.accent,
          fontSize: scaled(30),
          fontWeight: 700,
        }}
      >
        {props.spent}
      </div>
    </div>
  );
}

function PersonalTotal(
  props: Record<string, unknown> & { label: string; value: string; palette: PersonalCardPalette },
): VNode {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "48%" }}>
      <div style={{ display: "flex", color: props.palette.muted, fontSize: scaled(30), fontWeight: 700 }}>
        {props.label}
      </div>
      <div
        style={{ display: "flex", color: props.palette.ink, fontSize: scaled(76), fontWeight: 700, lineHeight: 1.05 }}
      >
        {props.value}
      </div>
    </div>
  );
}

/** Personal Wrapped is intentionally a tall 9:16 card for Discord previews. */
export function getPersonalCardHeight(_data: PersonalCardData): number {
  return PERSONAL_CARD_H;
}

export function renderPersonalCard(data: PersonalCardData): VNode {
  const t = {
    totalTokens: localizer(data.locale, "commands.stats.infographic.personal_total_tokens"),
    totalSpent: localizer(data.locale, "commands.stats.infographic.total_spent"),
    favoritePersonas: localizer(data.locale, "commands.stats.infographic.favorite_personas"),
    favoriteModel: localizer(data.locale, "commands.stats.infographic.favorite_model"),
    tokens: localizer(data.locale, "commands.stats.infographic.tokens"),
    spent: localizer(data.locale, "commands.stats.infographic.spent"),
    footerBrand: localizer(data.locale, "commands.stats.infographic.personal_wrapped_footer", {
      timeframe: timeframeLabel(data.locale, data.timeframe).toUpperCase(),
    }),
    noData: localizer(data.locale, "commands.stats.infographic.no_data"),
  };

  const hasData = data.totalTriggers > 0;
  const palette = data.palette ?? DEFAULT_PERSONAL_CARD_PALETTE;
  const favorite = data.favoritePersonas[0];
  return (
    <div
      style={{
        display: "flex",
        width: CARD_W,
        height: getPersonalCardHeight(data),
        boxSizing: "border-box",
        overflow: "hidden",
        flexDirection: "column",
        backgroundColor: palette.background,
        color: palette.ink,
        fontFamily: CARD_THEME.fontFamily,
      }}
    >
      <div style={{ display: "flex", width: "100%", height: scaled(900), flexDirection: "row" }}>
        <div
          style={{
            display: "flex",
            width: scaled(138),
            flexShrink: 0,
            position: "relative",
            flexDirection: "column",
            alignItems: "center",
            paddingTop: scaled(34),
            paddingBottom: scaled(40),
            borderRight: `${scaled(1)}px solid ${palette.border}`,
          }}
        >
          <PersonalImage
            name={data.username}
            dataUri={data.userAvatarDataUri}
            size={scaled(78)}
            palette={palette}
            rounded
          />
          <div
            style={{
              display: "flex",
              position: "absolute",
              top: scaled(150),
              left: scaled(108),
              width: scaled(700),
              color: palette.ink,
              fontSize: scaled(58),
              fontWeight: 700,
              letterSpacing: scaled(1),
              transform: "rotate(90deg)",
              transformOrigin: "top left",
            }}
          >
            {truncateCardText(data.username, 18)}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flex: 1,
            paddingTop: scaled(42),
            paddingRight: scaled(42),
            paddingLeft: scaled(42),
          }}
        >
          <div
            style={{
              display: "flex",
              position: "relative",
              width: "100%",
              height: scaled(820),
              overflow: "hidden",
              justifyContent: "flex-end",
              alignItems: "flex-end",
              borderRadius: scaled(32),
              border: `${scaled(2)}px solid ${palette.accent}`,
              backgroundColor: palette.surface,
            }}
          >
            <PersonalHeroDecor palette={palette} variant={data.heroVariant} />
            <div
              style={{
                display: "flex",
                position: "relative",
                marginRight: -scaled(28),
                marginBottom: -scaled(24),
                boxShadow: "0 28px 52px rgba(0, 0, 0, 0.22)",
              }}
            >
              <PersonalImage
                name={favorite?.name ?? data.username}
                dataUri={favorite?.avatarDataUri ?? null}
                size={scaled(760)}
                palette={palette}
              />
            </div>
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          paddingTop: scaled(36),
          paddingRight: scaled(66),
          paddingBottom: scaled(40),
          paddingLeft: scaled(66),
        }}
      >
        <PersonalRankingHeader
          favoritePersonas={t.favoritePersonas}
          tokens={t.tokens}
          spent={t.spent}
          palette={palette}
        />
        {hasData ? (
          data.favoritePersonas
            .slice(0, 5)
            .map((entry, index) => (
              <PersonalRankingRow key={entry.name} entry={entry} rank={index + 1} palette={palette} />
            ))
        ) : (
          <div style={{ display: "flex", color: palette.muted, fontSize: scaled(40), paddingTop: scaled(28) }}>
            {t.noData}
          </div>
        )}
        <div
          style={{
            display: "flex",
            width: "100%",
            minHeight: scaled(106),
            marginTop: scaled(28),
            paddingTop: scaled(20),
            paddingBottom: scaled(20),
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `${scaled(1)}px solid ${palette.border}`,
            borderBottom: `${scaled(1)}px solid ${palette.border}`,
          }}
        >
          <div style={{ display: "flex", color: palette.accent, fontSize: scaled(32), fontWeight: 700 }}>
            {t.favoriteModel}
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: "66%",
              color: palette.ink,
              fontSize: scaled(38),
              fontWeight: 700,
              textAlign: "right",
            }}
          >
            {data.favoriteModelName ?? t.noData}
          </div>
        </div>
        {/* Spacer pushes the aggregate totals + signature to the card bottom. */}
        <div style={{ display: "flex", flex: 1, minHeight: scaled(20) }} />
        <div
          style={{
            display: "flex",
            width: "100%",
            paddingTop: scaled(26),
            flexDirection: "row",
            justifyContent: "space-between",
            borderTop: `${scaled(2)}px solid ${palette.accent}`,
          }}
        >
          <PersonalTotal label={t.totalTokens} value={formatInt(data.totalTokens)} palette={palette} />
          <PersonalTotal label={t.totalSpent} value={formatCost(data.estimatedCost)} palette={palette} />
        </div>
        <div
          style={{
            display: "flex",
            width: "100%",
            marginTop: scaled(24),
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              width: scaled(86),
              height: scaled(86),
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {data.tomoriconDataUri ? (
              <img
                src={data.tomoriconDataUri}
                alt=""
                width={scaled(80)}
                height={scaled(80)}
                style={{ display: "flex", width: scaled(80), height: scaled(80), objectFit: "contain" }}
              />
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              color: palette.ink,
              fontSize: scaled(34),
              fontWeight: 700,
              letterSpacing: scaled(1),
            }}
          >
            {t.footerBrand}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Persona Affinity ──────────────────────────────────────────────────────────

export interface PersonaCardData {
  locale: string;
  timeframe: Timeframe;
  username: string;
  userAvatarDataUri: string | null;
  personaName: string;
  personaAvatarDataUri: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTriggers: number;
  sharePct: number;
  estimatedCost: number;
  memoryCount: number | null;
  conditioning: { rewards: number; punishments: number };
  favoriteEmojis: EmojiIcon[];
  favoriteEmotions: BreakdownSegment[];
  favoriteTools: BreakdownSegment[];
}

/** Removes the all-time-only memory tile from shorter time-window cards. */
export function getPersonaCardHeight(data: PersonaCardData): number {
  return data.totalTriggers === 0 ? scaled(820) : data.memoryCount === null ? scaled(1000) : PERSONA_CARD_H;
}

export function renderPersonaCard(data: PersonaCardData): VNode {
  const t = {
    title: localizer(data.locale, "commands.stats.infographic.persona_title"),
    totalTokens: localizer(data.locale, "commands.stats.infographic.total_tokens"),
    inputTokens: localizer(data.locale, "commands.stats.infographic.input_tokens"),
    outputTokens: localizer(data.locale, "commands.stats.infographic.output_tokens"),
    share: localizer(data.locale, "commands.stats.infographic.persona_share", {
      persona: data.personaName,
      share: data.sharePct.toFixed(1),
      user: data.username,
    }),
    totalSpent: localizer(data.locale, "commands.stats.infographic.total_spent"),
    throughTriggers: localizer(data.locale, "commands.stats.infographic.through_triggers", {
      count: formatInt(data.totalTriggers),
    }),
    memories: localizer(data.locale, "commands.stats.infographic.total_memories_owned"),
    conditioning: localizer(data.locale, "commands.stats.infographic.rewards_punishments_made"),
    emojis: localizer(data.locale, "commands.stats.infographic.favorite_emojis"),
    emotions: localizer(data.locale, "commands.stats.infographic.favorite_emotions"),
    tools: localizer(data.locale, "commands.stats.infographic.favorite_tools"),
    noData: localizer(data.locale, "commands.stats.infographic.no_data"),
    empty: localizer(data.locale, "commands.stats.empty"),
    footer: localizer(data.locale, "commands.stats.footer"),
  };

  const hasData = data.totalTriggers > 0;
  const metricItems: MetricTileData[] = [
    {
      label: t.totalSpent,
      value: formatCost(data.estimatedCost),
      detail: t.throughTriggers,
      color: CARD_THEME.red,
    },
    ...(data.memoryCount !== null
      ? [{ label: t.memories, value: formatInt(data.memoryCount), color: CARD_THEME.cyan }]
      : []),
    {
      label: t.conditioning,
      value: `${formatInt(data.conditioning.rewards)} / ${formatInt(data.conditioning.punishments)}`,
      color: CARD_THEME.teal,
    },
  ];
  return (
    <CardFrame height={getPersonaCardHeight(data)}>
      <Header
        title={`${data.username} & ${data.personaName}`}
        subtitle={`${timeframeLabel(data.locale, data.timeframe)} ${t.title}`}
      >
        <AvatarStack
          first={{ name: data.username, dataUri: data.userAvatarDataUri }}
          second={{ name: data.personaName, dataUri: data.personaAvatarDataUri }}
        />
      </Header>
      <Divider />
      {hasData ? (
        <>
          <Section title={t.totalTokens}>
            <TokenTotals
              inputTokens={data.inputTokens}
              outputTokens={data.outputTokens}
              inputLabel={t.inputTokens}
              outputLabel={t.outputTokens}
            />
          </Section>
          <Divider />
          <Section compact>
            <div style={{ display: "flex", color: CARD_THEME.textMuted, fontSize: scaled(24), lineHeight: 1.25 }}>
              {t.share}
            </div>
          </Section>
          <Divider />
          <Section compact>
            <MetricGrid items={metricItems} />
          </Section>
          <Divider />
          <Section title={t.emojis} compact>
            <EmojiStrip emojis={data.favoriteEmojis} empty={t.empty} />
          </Section>
          <Divider />
          <Section compact>
            <div style={{ display: "flex", flexDirection: "row", width: "100%", justifyContent: "space-between" }}>
              <BreakdownChart title={t.emotions} segments={data.favoriteEmotions} empty={t.empty} />
              <BreakdownChart title={t.tools} segments={data.favoriteTools} empty={t.empty} />
            </div>
          </Section>
        </>
      ) : (
        <div
          style={{ display: "flex", flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center" }}
        >
          <div style={{ display: "flex", color: CARD_THEME.textSubtle, fontSize: scaled(32) }}>{t.noData}</div>
        </div>
      )}
      <Footer text={t.footer} />
    </CardFrame>
  );
}

// ── Server Leaderboard ────────────────────────────────────────────────────────

/**
 * One persona's vertical-bar entry, ranked by total tokens (highest = leftmost).
 * `accent` is sampled from the persona avatar in the gatherer and tints the bar.
 */
export interface ServerPersonaBar extends PersonIcon {
  rank: number;
  totalTokens: number;
  estimatedCost: number;
  accent: string;
}

/** One member's horizontal-bar entry, ranked by triggers; `accent` tints the bar. */
export interface ServerMemberBar extends PersonIcon {
  rank: number;
  triggers: number;
  accent: string;
}

/** One model's horizontal-bar entry, ranked by total tokens processed (no icon). */
export interface ServerModelBar {
  name: string;
  totalTokens: number;
  estimatedCost: number;
}

export interface ServerCardData {
  locale: string;
  timeframe: Timeframe;
  serverName: string;
  serverIconDataUri: string | null;
  tomoriconDataUri: string | null;
  palette: PersonalCardPalette;
  topPersonas: ServerPersonaBar[];
  topMembers: ServerMemberBar[];
  topModels: ServerModelBar[];
  totalTokens: number;
  estimatedCost: number;
  totalTriggers: number;
  heroVariant: PersonalHeroVariant;
}

/** Lower-content padding for the Server card; bar tracks are sized against it. */
const SERVER_LOWER_PAD = scaled(66);
const SERVER_LOWER_W = CARD_W - SERVER_LOWER_PAD * 2;
/** Pixels reserved at a member bar's tip for its avatar + name label. */
const SERVER_BAR_TIP_RESERVE = scaled(360);
const SERVER_BAR_TRACK_W = SERVER_LOWER_W - SERVER_BAR_TIP_RESERVE;
const SERVER_BAR_MIN_W = scaled(360);
/** Model bars need no avatar, so their tip reserve (name only) is smaller. */
const SERVER_MODEL_TRACK_W = SERVER_LOWER_W - scaled(280);
const SERVER_MODEL_MIN_W = scaled(380);

/**
 * Picks black or white text for legibility on a solid `hex` fill using the WCAG
 * relative-luminance threshold. Pure + synchronous so it stays renderer-safe.
 */
function readableInkOn(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length < 6) return "#ffffff";
  const toLinear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * toLinear(Number.parseInt(clean.slice(0, 2), 16)) +
    0.7152 * toLinear(Number.parseInt(clean.slice(2, 4), 16)) +
    0.0722 * toLinear(Number.parseInt(clean.slice(4, 6), 16));
  return luminance > 0.5 ? "#1d1410" : "#ffffff";
}

/** Circular avatar whose ring uses a per-entry `accent` over the card palette. */
function AccentAvatar(
  props: Record<string, unknown> & {
    name: string;
    dataUri: string | null;
    size: number;
    accent: string;
    palette: PersonalCardPalette;
  },
): VNode {
  const initials = props.name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <div
      style={{
        display: "flex",
        width: props.size,
        height: props.size,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        borderRadius: "50%",
        border: `${scaled(3)}px solid ${props.accent}`,
        backgroundColor: props.palette.surface,
        color: props.palette.ink,
        fontSize: Math.max(scaled(22), Math.round(props.size * 0.4)),
        fontWeight: 700,
      }}
    >
      {props.dataUri ? (
        <img
          src={props.dataUri}
          alt=""
          width={props.size}
          height={props.size}
          style={{ display: "flex", width: props.size, height: props.size, objectFit: "cover" }}
        />
      ) : (
        initials
      )}
    </div>
  );
}

/**
 * Vertical bar chart of the top personas by tokens. Bar heights interpolate
 * between a text-fitting floor and the chart ceiling by each persona's share of
 * the leader's tokens, so #2 vs #3 stay visually proportional. Each bar is
 * inscribed with a tokens-over-cost fraction, tucks up behind its persona
 * avatar, and is captioned with the persona name on a shared baseline row.
 */
function ServerPersonaBars(
  props: Record<string, unknown> & { personas: ServerPersonaBar[]; palette: PersonalCardPalette; empty: string },
): VNode {
  const { palette } = props;
  const personas = props.personas.slice(0, 5);
  const chartHeight = scaled(660);
  const nameRowHeight = scaled(52);
  const barsAreaHeight = chartHeight - nameRowHeight;
  const avatarSize = scaled(104);
  // The bar rises behind the avatar's lower portion so the two read as one shape.
  const avatarOverlap = scaled(30);
  const avatarOverhang = avatarSize - avatarOverlap;
  const minBarHeight = scaled(112);
  const maxBarHeight = barsAreaHeight - avatarOverhang - scaled(6);
  const barRange = Math.max(0, maxBarHeight - minBarHeight);
  const maxTokens = Math.max(1, ...personas.map((entry) => entry.totalTokens));
  const columnWidth = scaled(150);

  if (personas.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: chartHeight,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ display: "flex", color: palette.muted, fontSize: scaled(36) }}>{props.empty}</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", width: "100%", height: chartHeight, flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          width: "100%",
          height: barsAreaHeight,
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "space-around",
        }}
      >
        {personas.map((entry) => {
          // 1. Interpolate floor→ceiling by token share (true proportion, text still fits).
          const barHeight = Math.round(minBarHeight + (entry.totalTokens / maxTokens) * barRange);
          const ink = readableInkOn(entry.accent);
          return (
            <div
              key={`${entry.rank}-${entry.name}`}
              style={{
                display: "flex",
                position: "relative",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-end",
                width: columnWidth,
              }}
            >
              {/* Bar (in flow): tokens-over-cost fraction pinned to its base. */}
              <div
                style={{
                  display: "flex",
                  width: scaled(128),
                  height: barHeight,
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  paddingBottom: scaled(18),
                  borderTopLeftRadius: scaled(20),
                  borderTopRightRadius: scaled(20),
                  backgroundColor: entry.accent,
                }}
              >
                <div style={{ display: "flex", color: ink, fontSize: scaled(26), fontWeight: 700, lineHeight: 1 }}>
                  {formatInt(entry.totalTokens)}
                </div>
                <div
                  style={{
                    display: "flex",
                    width: scaled(78),
                    height: scaled(2),
                    marginTop: scaled(7),
                    marginBottom: scaled(7),
                    backgroundColor: ink,
                    opacity: 0.65,
                  }}
                />
                <div style={{ display: "flex", color: ink, fontSize: scaled(24), fontWeight: 700, lineHeight: 1 }}>
                  {formatCost(entry.estimatedCost)}
                </div>
              </div>
              {/* Avatar (absolute, paints last): overlaps the bar top so they merge. */}
              <div
                style={{
                  display: "flex",
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: barHeight - avatarOverlap,
                  justifyContent: "center",
                }}
              >
                <AccentAvatar
                  name={entry.name}
                  dataUri={entry.avatarDataUri}
                  size={avatarSize}
                  accent={entry.accent}
                  palette={palette}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          width: "100%",
          height: nameRowHeight,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-around",
        }}
      >
        {personas.map((entry) => (
          <div
            key={`${entry.rank}-${entry.name}-label`}
            style={{
              display: "flex",
              width: columnWidth,
              justifyContent: "center",
              color: palette.ink,
              fontSize: scaled(26),
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            {truncateCardText(entry.name, 10)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One horizontal bar: a fill sized to `fraction` of the leader, the value typed
 * inside, and an optional `tip` node (avatar + label, or a bare model name) at
 * the bar's end.
 */
function ServerBarRow(
  props: Record<string, unknown> & {
    fillColor: string;
    insideText: string;
    fraction: number;
    minWidth?: number;
    trackWidth?: number;
    tip?: unknown;
  },
): VNode {
  // Interpolate floor→track by value share so #2 vs #3 stay proportional while
  // the value text still fits inside the shortest bar (matches the persona bars).
  const minWidth = props.minWidth ?? SERVER_BAR_MIN_W;
  const trackWidth = props.trackWidth ?? SERVER_BAR_TRACK_W;
  const fraction = Math.min(1, Math.max(0, props.fraction));
  const barWidth = Math.round(minWidth + fraction * Math.max(0, trackWidth - minWidth));
  const ink = readableInkOn(props.fillColor);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100%",
        alignItems: "center",
        paddingTop: scaled(10),
        paddingBottom: scaled(10),
      }}
    >
      <div
        style={{
          display: "flex",
          width: barWidth,
          height: scaled(78),
          flexShrink: 0,
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: scaled(24),
          borderRadius: scaled(16),
          backgroundColor: props.fillColor,
        }}
      >
        <div style={{ display: "flex", color: ink, fontSize: scaled(27), fontWeight: 700, whiteSpace: "nowrap" }}>
          {props.insideText}
        </div>
      </div>
      {props.tip as VNode}
    </div>
  );
}

/** Title rule above each lower-zone block, tinted to the card accent. */
function ServerBlockTitle(props: Record<string, unknown> & { title: string; palette: PersonalCardPalette }): VNode {
  return (
    <div
      style={{
        display: "flex",
        marginTop: scaled(18),
        marginBottom: scaled(8),
        color: props.palette.accent,
        fontSize: scaled(34),
        fontWeight: 700,
      }}
    >
      {props.title}
    </div>
  );
}

/** Server Leaderboard keeps a fixed 9:16 frame; only the no-data card is shorter. */
export function getServerCardHeight(data: ServerCardData): number {
  return data.totalTriggers > 0 ? SERVER_CARD_H : scaled(900);
}

export function renderServerCard(data: ServerCardData): VNode {
  const t = {
    title: localizer(data.locale, "commands.stats.infographic.server_title"),
    topPersonas: localizer(data.locale, "commands.stats.infographic.top_personas"),
    mostActiveMembers: localizer(data.locale, "commands.stats.infographic.most_active_members"),
    topModels: localizer(data.locale, "commands.stats.infographic.top_models"),
    totalTokens: localizer(data.locale, "commands.stats.infographic.total_server_tokens"),
    totalSpent: localizer(data.locale, "commands.stats.infographic.total_server_spend"),
    triggerLabel: localizer(data.locale, "commands.stats.units.messages_to_me"),
    footerBrand: localizer(data.locale, "commands.stats.infographic.server_leaderboard_footer", {
      timeframe: timeframeLabel(data.locale, data.timeframe).toUpperCase(),
    }),
    noData: localizer(data.locale, "commands.stats.infographic.no_data"),
    empty: localizer(data.locale, "commands.stats.empty"),
  };

  const hasData = data.totalTriggers > 0;
  const palette = data.palette ?? DEFAULT_PERSONAL_CARD_PALETTE;
  const members = data.topMembers.slice(0, 3);
  const models = data.topModels.slice(0, 3);
  const maxTriggers = Math.max(1, ...members.map((entry) => entry.triggers));
  const maxModelTokens = Math.max(1, ...models.map((entry) => entry.totalTokens));

  return (
    <div
      style={{
        display: "flex",
        width: CARD_W,
        height: getServerCardHeight(data),
        boxSizing: "border-box",
        overflow: "hidden",
        flexDirection: "column",
        backgroundColor: palette.background,
        color: palette.ink,
        fontFamily: CARD_THEME.fontFamily,
      }}
    >
      {/* 1. Hero zone: server identity rail + top-persona vertical bar chart. */}
      <div style={{ display: "flex", width: "100%", height: scaled(860), flexDirection: "row" }}>
        <div
          style={{
            display: "flex",
            width: scaled(138),
            flexShrink: 0,
            position: "relative",
            flexDirection: "column",
            alignItems: "center",
            paddingTop: scaled(34),
            paddingBottom: scaled(40),
            borderRight: `${scaled(1)}px solid ${palette.border}`,
          }}
        >
          <PersonalImage
            name={data.serverName}
            dataUri={data.serverIconDataUri}
            size={scaled(78)}
            palette={palette}
            rounded
          />
          <div
            style={{
              display: "flex",
              position: "absolute",
              top: scaled(150),
              left: scaled(108),
              width: scaled(680),
              color: palette.ink,
              fontSize: scaled(58),
              fontWeight: 700,
              letterSpacing: scaled(1),
              transform: "rotate(90deg)",
              transformOrigin: "top left",
            }}
          >
            {truncateCardText(data.serverName, 18)}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flex: 1,
            paddingTop: scaled(42),
            paddingRight: scaled(42),
            paddingLeft: scaled(42),
          }}
        >
          <div
            style={{
              display: "flex",
              position: "relative",
              width: "100%",
              height: scaled(776),
              overflow: "hidden",
              flexDirection: "column",
              borderRadius: scaled(32),
              border: `${scaled(2)}px solid ${palette.accent}`,
              backgroundColor: palette.surface,
              paddingTop: scaled(30),
              paddingRight: scaled(26),
              paddingBottom: scaled(28),
              paddingLeft: scaled(26),
            }}
          >
            <PersonalHeroDecor palette={palette} variant={data.heroVariant} />
            <div
              style={{
                display: "flex",
                position: "relative",
                marginBottom: scaled(8),
                color: palette.accent,
                fontSize: scaled(34),
                fontWeight: 700,
              }}
            >
              {t.topPersonas}
            </div>
            <div style={{ display: "flex", position: "relative", flex: 1, alignItems: "flex-end" }}>
              <ServerPersonaBars personas={data.topPersonas} palette={palette} empty={t.empty} />
            </div>
          </div>
        </div>
      </div>

      {/* 2. Lower zone: member + model bars, server totals, signature footer. */}
      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          paddingTop: scaled(20),
          paddingRight: SERVER_LOWER_PAD,
          paddingBottom: scaled(40),
          paddingLeft: SERVER_LOWER_PAD,
        }}
      >
        {hasData ? (
          <>
            <ServerBlockTitle title={t.mostActiveMembers} palette={palette} />
            {members.length > 0 ? (
              members.map((entry) => (
                <ServerBarRow
                  key={`${entry.rank}-${entry.name}`}
                  fillColor={entry.accent}
                  insideText={`${formatInt(entry.triggers)} ${t.triggerLabel}`}
                  fraction={entry.triggers / maxTriggers}
                  tip={
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        marginLeft: -scaled(20),
                      }}
                    >
                      <AccentAvatar
                        name={entry.name}
                        dataUri={entry.avatarDataUri}
                        size={scaled(78)}
                        accent={entry.accent}
                        palette={palette}
                      />
                      <div
                        style={{
                          display: "flex",
                          marginLeft: scaled(16),
                          color: palette.ink,
                          fontSize: scaled(28),
                          fontWeight: 700,
                        }}
                      >
                        {truncateCardText(entry.name, 14)}
                      </div>
                    </div>
                  }
                />
              ))
            ) : (
              <div style={{ display: "flex", color: palette.muted, fontSize: scaled(28) }}>{t.empty}</div>
            )}

            <ServerBlockTitle title={t.topModels} palette={palette} />
            {models.length > 0 ? (
              models.map((entry) => (
                <ServerBarRow
                  key={entry.name}
                  fillColor={palette.accentSecondary}
                  insideText={localizer(data.locale, "commands.stats.infographic.model_tokens_cost", {
                    count: formatInt(entry.totalTokens),
                    cost: formatCost(entry.estimatedCost),
                  })}
                  fraction={entry.totalTokens / maxModelTokens}
                  minWidth={SERVER_MODEL_MIN_W}
                  trackWidth={SERVER_MODEL_TRACK_W}
                  tip={
                    <div
                      style={{
                        display: "flex",
                        marginLeft: scaled(18),
                        color: palette.ink,
                        fontSize: scaled(28),
                        fontWeight: 700,
                      }}
                    >
                      {truncateCardText(entry.name, 22)}
                    </div>
                  }
                />
              ))
            ) : (
              <div style={{ display: "flex", color: palette.muted, fontSize: scaled(28) }}>{t.empty}</div>
            )}

            <div style={{ display: "flex", flex: 1, minHeight: scaled(20) }} />

            <div
              style={{
                display: "flex",
                width: "100%",
                paddingTop: scaled(26),
                flexDirection: "row",
                justifyContent: "space-between",
                borderTop: `${scaled(2)}px solid ${palette.accent}`,
              }}
            >
              <PersonalTotal label={t.totalTokens} value={formatInt(data.totalTokens)} palette={palette} />
              <PersonalTotal label={t.totalSpent} value={formatCost(data.estimatedCost)} palette={palette} />
            </div>
          </>
        ) : (
          <div
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ display: "flex", color: palette.muted, fontSize: scaled(40) }}>{t.noData}</div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            width: "100%",
            marginTop: scaled(24),
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              width: scaled(86),
              height: scaled(86),
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {data.tomoriconDataUri ? (
              <img
                src={data.tomoriconDataUri}
                alt=""
                width={scaled(80)}
                height={scaled(80)}
                style={{ display: "flex", width: scaled(80), height: scaled(80), objectFit: "contain" }}
              />
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              color: palette.ink,
              fontSize: scaled(34),
              fontWeight: 700,
              letterSpacing: scaled(1),
            }}
          >
            {t.footerBrand}
          </div>
        </div>
      </div>
    </div>
  );
}
