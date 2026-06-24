---
title: Stats Infographic
---

# Stats Infographic Subsystem

`/stats generate` renders one of three shareable PNG image cards using a **satori → resvg** pipeline.
The stat data itself reuses the same `StatRepository` read methods that power the Phase 2 text dashboard.

## Card types

| Type | Command choice | Gatherer | Renderer |
|---|---|---|---|
| Personal Wrapped | `personal` | `personalCardGatherer.ts` | `renderPersonalCard()` |
| Persona Affinity | `persona` | `personaCardGatherer.ts` | `renderPersonaCard()` |
| Server Leaderboard | `server` | `serverCardGatherer.ts` | `renderServerCard()` |

Cards are designed for Discord's inline image preview rather than full-resolution
inspection. The default width is `1080px`; important labels use at least `24px`
source text and values use `34px` or larger so they remain readable when Discord
scales the attachment down.

Height is content-aware:

- Personal Wrapped is a `9:16` portrait card (`1080×1920`). It gives the top
  favorite persona avatar visual priority, limits the ranked list to five
  text-only entries, and retains only total tokens and total spend.
- Persona Affinity is `1080×1100` for all-time cards and shorter when the
  all-time-only memory tile is absent.
- Server Leaderboard is a fixed `9:16` portrait card (`1080×2010`) that mirrors
  the Personal Wrapped share format. The no-data card is shorter (`1080×900`).

- Personal Wrapped: a dominant #1 favorite-persona avatar, truncated vertical
  user name, up to five ranked personas with per-persona token/cost totals,
aggregate token/spend totals, and a monochrome Tomoricon stamp. The gatherer
derives its accessible light-mode palette from the #1 avatar: the most common
usable hue supplies the background and contrast-safe text color, while a
distinct saturated hue supplies the accent layers. The Tomoricon stamp is tinted
to the same contrast-safe text color. It falls back to a neutral palette if that
image is unavailable or undecodable.
- Persona Affinity: the invoking user and picked persona, scoped token/cost/trigger
  totals, all-time memory count, reward/punishment count, emoji icons, and emotion/
  tool donut charts. Memory count is hidden outside the all-time view.
- Server Leaderboard: a left rail with the server icon and vertically-set server
  name; a hero vertical bar chart of the top five personas by total tokens (avatar
  capped, bar tinted to the persona avatar's accent, with a tokens-over-cost
  fraction inscribed); a "Most Active Members" horizontal bar chart of the top
  three members by triggers (avatar + name at the bar tip, bar tinted to the
  member avatar's accent); a "Top Models" horizontal bar chart of the top three
  models by tokens processed (no icon — model name at the tip, with
  `{tokens} | {cost}` inscribed in the bar); and the server-wide total tokens and
  total spend. Its light-mode palette is derived
  from the server icon, mirroring how Personal Wrapped derives its palette from
  the #1 persona avatar.

`tokens_in` and `tokens_out` are daily counters. Per-persona costs are calculated
in one grouped query, applying the matched model's input/output pricing to each
persona lineage; no per-row database queries are issued during card generation.
Because an LLM codename can appear under more than one provider, pricing joins
first collapse to one conservative rate per codename. This prevents duplicated
join rows from inflating a persona's token total beyond the card aggregate.

## Minimal infographic design guide

The current Personal Wrapped card is the **golden standard** for new compact
infographic work. Its purpose is not to show every metric; it establishes a
single visual narrative that remains legible in Discord's inline preview.

### Personal Wrapped: hierarchy and layout

The card is a `9:16` portrait image with four intentional zones, in order:

1. **Hero** — the #1 (highest-token) persona avatar takes most of the upper card.
   The invoking user's avatar and vertically set, truncated name appear in a
   narrow rail that ends with the hero, not the whole card.
2. **Ranked table** — the lower content width is unrestricted by the user rail.
   It presents at most five text-only persona rows with `Favorite Personas`,
   `Tokens`, and `Spent` columns, **ranked by total tokens (descending)** so the
   row order matches the visible Tokens column. The whole persona population is
   ranked before the top five are taken, so a heavy-token persona is never
   dropped for having fewer message triggers. Columns are aligned through fixed
   widths and flexible name space rather than visible vertical rules.
3. **Summary** — favorite model is a single row, followed by the two large
   aggregate values: `Total Tokens` and `Total Spent`.
4. **Signature** — the contrast-tinted Tomoricon and localized
   `PERSONAL WRAPPED (TIMEFRAME)` footer share one centered row at the bottom.

Use large source typography. At the default 1080px width, table labels are at
least 30px, row values 34px or greater, and aggregate values 76px. Do not trade
this hierarchy for denser secondary metrics; place those in a different card or
text dashboard instead.

### Palette and hero decoration

The palette + image helpers live in the shared gather-layer module
`cardColor.ts` (`extractCardPalette`, `extractAvatarAccentColor`,
`loadTomoriconDataUri`, `chooseHeroVariant`). Personal Wrapped feeds it the #1
persona avatar; Server Leaderboard feeds it the server icon. The renderer never
imports it — it stays pure. `personalCardGatherer.ts` re-exports
`extractPersonalCardPalette` as a backward-compatible alias of
`extractCardPalette`.

The palette extractor samples the hero image at 64px after alpha filtering and
creates an accessible light-mode palette with two roles:

- The most common usable hue is the **base**: pale background/surface colors,
  dark contrast-safe ink, muted text, borders, and the secondary hero color.
- A sufficiently different saturated hue becomes the **accent**: table headings,
  hero border, avatar outlines, and primary decorative layer. This preserves
  meaningful details such as a red/magenta eye or hair accent when blue hair is
  the most common pixel color.

The gatherer tints the monochrome PNG stamp to `palette.ink`; retain the
high-resolution PNG rather than substituting the lower-resolution `.ico`. SVG is
appropriate only when the original vector artwork is available.

Five palette-colored hero decoration variants are chosen randomly **in the
gatherer**, then stored on `PersonalCardData.heroVariant`. Keep randomness out of
the renderer so a given data object always produces the same VNode and remains
unit-testable. New variations must stay behind the avatar, use only palette
colors, and avoid adding small text or semantic content.

### Server Leaderboard: bar layout

The Server card reuses the Personal Wrapped frame (left identity rail + hero box
+ bottom-aligned totals/signature) but its body is three bar charts:

- **Bar tints come from the gatherer.** `extractAvatarAccentColor` distils one
  vivid hue per persona/member avatar (`ServerPersonaBar.accent`,
  `ServerMemberBar.accent`); the renderer fills each bar with it and picks
  black/white in-bar text via `readableInkOn` (WCAG luminance). Models have no
  avatar, so their bars use `palette.accentSecondary`.
- **Bars are proportional, not floored.** Both the vertical persona bars and the
  horizontal member/model bars size as `min + share × (ceiling − min)` where
  `share = value / leaderValue`. Do **not** revert to `max(min, share × track)`:
  that flattens every entry below the floor (#2 and #3 collapse to the same
  size). The floor only guarantees the inscribed value text fits the shortest bar.
- **Persona bars merge with their avatar** (the bar is absolutely-overlapped by
  the avatar so they read as one shape) and are captioned by a shared baseline
  name row, so caption alignment is independent of bar height.
- Personal Wrapped and Server Leaderboard both push the aggregate
  `Total Tokens` / `Total Spent` block and the Tomoricon signature to the card
  bottom with a flex spacer, for a consistent share-card silhouette.

### Contributor checklist

When changing an infographic:

- Keep gathering, palette/image processing, and decorative variant selection in
  the gatherer; keep renderer functions pure.
- Add or update both locale files for every new visible label.
- Preserve a contrast-safe text/icon color; never place palette-colored text on
  a similarly colored background without checking the rendered PNG.
- Render EN and JA cards with `scripts/devtools/renderPersonalCardHarness.ts`
  and visually inspect the result at preview scale.
- Add a focused unit test for new palette or dimension behavior, then run
  `bun run check`, `bun run lint`, and `bun run check-locales` as applicable.

## Render pipeline

```
gatherXxxCardData()   ← DB + Discord API (async, sole touch-point)
        ↓
  renderXxxCard()     ← pure VNode tree (statsInfographic.tsx, no DB)
        ↓
  renderCardToPng()   ← satori (JSX→SVG) + resvg (SVG→PNG)
        ↓
  AttachmentBuilder   ← Discord PNG attachment
```

**Key constraints:**
- satori 0.26 cannot parse `conic-gradient()` — the `Donut` primitive embeds an SVG arc string as a `data:image/svg+xml;base64,…` `<img>` data URI instead; resvg rasterizes it fine.
- Fonts (`VF`-format crashes satori) are loaded once at module init as static instances via `readFileSync`. See `cardRenderer.ts`.
- Renderer and caller use the same `getXxxCardHeight(data)` helper. The footer
  follows the final section instead of being pushed to the canvas bottom.
- Layout dimensions and typography scale with `STATS_CARD_W`; changing the
  output resolution retains the same visual proportions.

## Gather / render split

All DB access is isolated to the gatherer layer. The renderer functions are pure functions of their data struct (`PersonalCardData`, `PersonaCardData`, `ServerCardData`) — no async, no DB, no Discord API. This split makes the renderers unit-testable without DB mocks.

## Privacy gate

Personal cards refuse fully-private users (`PrivacyLevel.FULL`) before deferring the interaction. Persona and server cards have no privacy gate (they show aggregate/persona data, not individual user data).

## Persona picker flow

For `type=persona`, the command shows an ephemeral picker via `replyPaginatedPersonaChoicesV2` with `preserveSelectedInteraction: true`. The PNG reply is sent from the returned `ButtonInteraction` (not the original slash command interaction) to avoid double-acknowledging Discord.

## Env config

All card dimensions and theme colors are configurable. See `.env.optional.example` for the full list:

| Var | Default | Description |
|---|---|---|
| `STATS_CARD_W` | `1080` | Logical card width; typography, spacing, and data-dependent height scale with it |
| `STATS_CARD_THEME_BG` | `#1d100e` | Deep espresso card background |
| `STATS_CARD_THEME_SURFACE` | `#2c1815` | Dark espresso secondary surface |
| `STATS_CARD_THEME_ACCENT` | `#e7322a` | Primary red accent |
