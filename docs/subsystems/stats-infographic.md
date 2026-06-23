---
title: Stats Infographic
---

# Stats Infographic Subsystem

`/stats generate` renders one of three shareable PNG image cards using a **satori → resvg** pipeline.
The stat data itself reuses the same `StatRepository` read methods that power the Phase 2 text dashboard.

## Card types

| Type | Command choice | Gatherer | Renderer |
|---|---|---|---|
| Personal "Wrapped" | `personal` | `personalCardGatherer.ts` | `renderPersonalCard()` |
| Persona trading card | `persona` | `personaCardGatherer.ts` | `renderPersonaCard()` |
| Server in review | `server` | `serverCardGatherer.ts` | `renderServerCard()` |

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
- Card wrapper uses `minHeight` (not fixed `height`) so sparse variants don't leave dead space and dense variants don't clip the footer.

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
| `STATS_CARD_W` | `900` | Canvas width (all card types) |
| `STATS_CARD_H_PERSONAL` | `900` | Personal card min-height |
| `STATS_CARD_H_PERSONA` | `820` | Persona card min-height |
| `STATS_CARD_H_SERVER` | `880` | Server card min-height |
| `STATS_CARD_THEME_BG` | `#1a1b2e` | Card background color |
| `STATS_CARD_THEME_SURFACE` | `#16213e` | Card surface/header color |
| `STATS_CARD_THEME_ACCENT` | `#7c3aed` | Card accent color |
