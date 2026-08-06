---
title: "01: Preset Routing"
---

Decide whether to use native fixed-order assembly or to reassemble its output
through an active SillyTavern preset.

**File:** `src/utils/text/context/builder.ts:13-83`

## Mission

The wrapper around `buildContextNative`. Always runs the native build first
(so preset reassembly has the structured items to slot into preset macro
blocks). If a SillyTavern preset is active for the server *and* the turn
isn't an impersonation, calls `reassembleWithPreset` to map native items into
preset blocks. Otherwise returns the native build directly. After either
path, resolves any random-choice macros (`{{random:a::b}}` or
`{random::a::b}`) across all output text — these can appear in user-imported
preset content and need to be rolled per-build.

## Input

`BuildContextParams` — see `src/utils/text/context/types.ts:40-86`. The
shared parameter shape for both the wrapper and native builder.

## Output

`BuildContextResult` — see `src/utils/text/context/types.ts:89-96`.

## Side effects

- **Preset cache read** — `getCachedActivePreset(serverId)` returns the
  active preset data if one is configured.
- **Persona state load** — falls back to `personaRepository.loadState` if
  `snapshot.tomoriState` wasn't carried by the caller.
- **Native build** — always runs `buildContextNative` (the inner pipeline).
- **Preset reassembly** — if a preset is active and not impersonation, runs
  `reassembleWithPreset` from
  `src/utils/text/presetContextBuilder.ts`.
- **Random-choice macro resolution** — `resolveRandomChoiceMacrosInBuildOutput`
  rolls each `{{random:a,b}}` macro independently across `contextItems`,
  `tailDirectives`, `lowerPriorityTailDirectives`, and `uncensorDirective`.

## Invariants

After this stage runs:

- `messageIdMap` is populated and returned — either the caller-supplied map
  or a freshly-constructed one.
- If a preset was active, the native build still ran first (preset
  reassembly does not bypass native assembly).
- All random-choice macros are resolved exactly once per build (no double
  rolls between native and preset paths).
- Impersonation turns *always* use the native path, regardless of preset
  configuration.

## Extension points

**This stage is the routing seam.** Two architectural facts worth naming:

| Surface | Plugin-relevance |
|---|---|
| Preset routing | `reassembleWithPreset` is the SillyTavern-preset integration point — a different preset format (Risu, Agnaistic, etc.) would extend here with a parallel reassembly path |
| Macro resolution | `resolveRandomChoiceMacros` syntax (`{{random:a,b}}` / `{random::a::b}`) is currently ST-compatible; new macro kinds would extend here |

A future plugin extension for "alternate prompt format" would either:
- (a) take the form of a registered reassembly handler keyed by preset kind,
  selected here by inspecting `presetData`. → plugin plan candidate.
- (b) be a wholesale alternate `buildContext` entry-point selected upstream
  by the chat pipeline. Less likely — the native build is broadly useful.

The native build (stage 02) is the much larger extension surface — most
plugin work goes there, not here.

## Related docs

- Native assembly: [`02-native-assembly/`](/architecture/pipelines/context-build/02-native-assembly/)
- SillyTavern preset system:
  [`docs/en/architecture/integrations/sillytavern/preset-system.md`](../../../integrations/sillytavern/preset-system)
- Random-choice macros: → folded into this doc; no dedicated page (small
  feature)
