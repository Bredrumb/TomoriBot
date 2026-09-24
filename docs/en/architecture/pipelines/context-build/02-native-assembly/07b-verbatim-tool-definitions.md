---
title: "02.7b: Verbatim Tool Definitions"
---

In-band JSON dump of the resolved tool schemas, emitted only when the
verbatim tool-calling workaround is enabled.

**File:** `src/utils/text/context/toolDefinitions.ts`

## Mission

The verbatim tool-calling opt-in (`/providers` > select endpoint > model >
Chat Completion Compatibilities) exists for endpoints that accept the native
`tools` field but ignore it; typically local / custom OpenAI-compatible
servers. In that mode the model never reliably "sees" the tool schemas, so the
[`CustomStreamAdapter`](../../provider/03-chunk-normalization) parses tool
calls out of the model's *text* instead. This contributor closes the loop:
when the opt-in is on, it serializes the exact tool set the provider would
send and embeds it in the prompt body so the model can read the names and
parameter schemas in-band.

This is the *schema* half of the opt-in. The *behavioral* half (the
instruction on how to emit a verbatim call) is the
`VERBATIM_TOOL_CALLING_NUDGE` injected near the dialogue tail (stage 11,
[`11-dialogue-history.md`](/architecture/pipelines/context-build/02-native-assembly/11-dialogue-history/)). Both are gated by the
same predicate so they always switch on together.

## Input

- `tomoriState`: provides the active `llm` (provider, capability flags
  including `verbatim_tool_calling`), `server_id`, persona voice fields, and
  feature-flag config used to gate tool availability.

## Output

`Promise<StructuredContextItem | null>`: `null` when the opt-in is off, the
model is not tool-capable, state is missing, or no tools resolve. Otherwise
one `user`-role item tagged `KNOWLEDGE_VERBATIM_TOOL_DEFINITIONS`.

Content shape: a short instructional header followed by a fenced ```json
block containing the provider-native tool array (`{ type: "function",
function: { name, description, parameters } }` per tool).

## How the JSON is built

Mirrors the recipe used by `/tool prompt snapshot` (`fetchProviderTools`)
and by `<Provider>Provider.getTools`:

1. Assemble a minimal `ToolStateForContext` from the live persona state
   (voice assignment, model capability flags, feature-flag config).
2. `getAvailableToolsWithMCP(provider, state)`: registry returns the
   feature-flag-gated built-in tools plus the allowed MCP function names.
3. `new OpenAICompatibleToolAdapter(provider).getAllToolsInProviderFormat(
   builtInTools, server_id, mcpFunctionNames)`: serializes full native
   schemas for built-in **+ global MCP + guild MCP** tools, exactly matching
   what lands in `config.tools`.

## Invariants

After this stage runs:

- Gated identically to the verbatim nudge via
  `shouldInjectVerbatimToolCallingNudge(tomoriState)`, which requires
  `tomoriState.llm.verbatim_tool_calling === true`, a `custom` provider, and
  `tomoriState.llm.has_tools === true`.
- Injected per attempt rather than once per turn: `prepareProviderContextItems`
  in `src/utils/chat/generationTurn.ts` adds this item when a fallback arm is a
  verbatim custom model even though the primary model was native, and strips it
  when the arm is native. See [`tool-loop/README.md`](../../tool-loop/README.md).
- Placed in the stable reference zone (right before RAG documents) so the
  schema block stays inside the prompt-cache-friendly prefix rather than
  churning next to live dialogue.
- Tools are resolved *fresh* each turn (no caching here); the same resolve
  runs again later in the provider when it builds `config.tools`. Accepted
  cost for an opt-in mode.
- Errors are logged and return `null`; a failure never blocks the rest of
  the build.

## Configuration

| Source | Field | Effect |
|---|---|---|
| `tomoriState.llm` | `verbatim_tool_calling` | Per-model opt-in (set in `/providers` under Chat Completion Compatibilities) |
| `tomoriState.llm` | `has_tools` | Must be true; otherwise no tools to dump |
| `tomoriState.llm` | `llm_provider` | Must be a `custom` provider; only `CustomStreamAdapter` runs the parser |

## Extension points

| Surface | Plugin-relevance |
|---|---|
| Tool resolution (`getAvailableToolsWithMCP`) | Shared with every provider's `getTools`; a plugin adding tools is picked up here automatically. |
| Serialization adapter (`OpenAICompatibleToolAdapter`) | Hard-wired to OpenAI-compatible shape because the verbatim parser only runs in `CustomStreamAdapter`. A future non-OpenAI verbatim parser would select a different adapter here. |
| Gating predicate (`shouldInjectVerbatimToolCallingNudge`) | Single source of truth shared with the nudge and with the fallback adaptation; changing the gate changes every half of the opt-in. |

## Related docs

- Verbatim nudge (behavioral half): → [`11-dialogue-history.md`](/architecture/pipelines/context-build/02-native-assembly/11-dialogue-history/)
- Verbatim parsing at stream time: → [`provider/03-chunk-normalization.md`](../../provider/03-chunk-normalization)
- Per-attempt fallback adaptation: → [`tool-loop/README.md`](../../tool-loop/README.md)
- Provider tool assembly reference: → `/tool prompt snapshot` (`src/commands/tool/prompt/snapshot.ts`)
