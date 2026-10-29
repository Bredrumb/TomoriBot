---
title: "Prompt Snapshot"
aiGenerated: true
---

The prompt snapshot subsystem reconstructs a prompt for the current channel history, persona, and configuration. It includes system instructions and request parameters, but does not capture an earlier generation request. It powers two surfaces sharing a single assembler (`assemblePromptInspection()`):

- `/tool prompt snapshot`: Exports the reconstructed prompt and sampling parameters to a file.
- `/context`: Visualizes context window consumption in an interactive usage grid with snapshot export buttons.

## Permission model and privacy

Prompt inspection separates aggregate token measurements from raw prompt content:

- **Guild-only execution**: Both commands require server context and cannot execute in direct messages.
- **Access tiers**: The `/context` panel shows token counts and segment proportions, open to all server members. Prompt text (the snapshot file and `/context` download buttons) contains server prompts and participant memories, so access requires the `ManageGuild` permission or the `prompt_snapshot_enabled` member permission setting (`canViewPromptText()` in `src/utils/text/promptInspection/delivery.ts`).
- **Privacy filters**: Messages from users configured with `FULL` privacy levels are excluded from the fetched message history, matching live chat execution.

## Faithfulness to runtime execution

Prompt assembly mirrors the production `messageCreate → tomoriChat` pipeline through `assemblePromptInspection()` in `src/utils/text/promptInspection/assemble.ts`:

- **Context construction**: Invokes `buildContext()` to assemble instructions, server memories, conditioning logs, SillyTavern preset reordering, and depth-injected `/context-note` content.
- **Participant discovery**: Calls `prepareParticipantContext()`, matching live chat profiles, synthetic identity mappings, and attribution logic.
- **Message boundary processing**: Respects conversation resets (`sliceMessagesAtResetMarker()`), link previews, stickers, and system-produced notice blocks (`extractNoticeTextFromComponents`).
- **History truncation**: Uses `resolveContextBudget()` for ordinary providers. NovelAI selects, renders, and fits its native context through the same preparation function as generation.
- **UI exclusion**: Diagnostic embeds and internal debug notices are omitted because they represent interface elements rather than model prompt input.
- **Hidden agendas**: A Natural Nudges agenda renders above its opener only when the answering persona owns it, as in live context building, so the snapshot shows what that persona sees.

NovelAI inspection uses native context captured before preset reassembly, the resolved personal or
server credential, and the saved response prefill. It runs the provider's allowlist, renderer, and
exact fitter without selecting a rotation key. Both formats include the final flat prompt and a
report of included, excluded, and trimmed identities, input tokens, window, and effective output cap.
A snapshot reconstructs that credential's current request; it cannot reproduce a previous rotated
request. Credential identities are omitted from both formats. Missing credentials or required
tokenizer assets fail inspection instead of producing an approximate request.

GLM and Xialong JSON exports use `prompt` with completion parameters; Kayra and Erato use `input`
with native `parameters`. The `fitting` report accompanies each request. Its section identities
refer to source context items, so omitted instructions and trimmed memories can be distinguished
from included content. `inputTokens` is the exact local count of the final prompt; `window` is the
credential's model allowance, and `outputCap` is the fitted request limit. Native framing and
sentence-completion reserves are reported separately. These reserves consume context space but
are not added to the request's output cap.

## Output formats

Snapshots can be exported in two formats:

### Text format (`format: text`)

Generates human-readable plain text annotated with configuration locator headers:

```text
=== Persona Attributes (`/config` > Persona > Identity & Personality) ===
...attribute definitions...

=== Server Memories (`/memories`) ===
...memory entries...

=== Conversation History (system-managed) ===
...dialogue turns...
```

Header markers identify configuration commands and are annotations for readers. NovelAI text exports instead begin with the actual rendered prompt, followed by the fitting report.

### JSON format (`format: json` or `json_tools`)

Serializes the reconstructed context into provider-native request shapes:

- Google-family, Anthropic, and OpenAI-compatible serializers use request-building adapters. NovelAI exports its fitted completion or native request parameters and fitting report. Other providers without a probe builder use a generic OpenAI-style representation. Transport retries and continuation requests are outside the snapshot.
- Large media payloads are replaced with placeholders (`[BASE64_HIDDEN]`) to limit export file sizes.
- `format: json_tools` also appends provider-formatted tool definitions generated via `adapter.getAllToolsInProviderFormat()`.

### Request configuration block

Exports include provider sampling parameters constructed by `buildRequestConfig()`. They lead the file instead of the Discord message: in JSON they follow `model`, and in text they sit under a `=== Request Config (annotation, NOT part of the prompt) ===` header. For NovelAI they are the prepared request's actual parameters, including preset defaults, the fitted output cap, and foreign-speaker stops, and the fitting report follows the prompt (text) or sits under `fitting` (JSON). The server, channel, persona, provider, model, preset, and capture time also stay out of the Discord card, so the card cannot be mistaken for the prompt: text files carry them under a `=== Snapshot Info ... ===` header, and JSON files omit them so the payload stays shaped like the provider request.

- Lists active parameters (such as `temperature`, `top_p`, `max_output_tokens`, and stop sequences).
- Includes provider-specific thinking configurations (such as Anthropic adaptive thinking or Gemini thinking budgets).
- Notes explicitly disabled parameters (`disabled_params`) and tool availability.

### Delivery

`deliverPromptSnapshot()` sends the file by DM as a Components V2 card: Discord draws plain attachments above embeds, so the file is a File component placed after the text, which keeps it at the bottom. The card ends with a warning not to share the file, since it can contain memories and chat text. If the DM fails, the same card goes in the private reply.

## Context usage panel (`/context`)

The `/context` command renders a 10x20 emoji grid where each cell represents 0.5% of the model's context window:

- **Token measurement**: NovelAI uses the exact rendered input count from its fitter, with approximate segment shares. Other providers use character estimates through `tokenEstimate.ts`.
- **Segment categorization**: Maps `ContextItemTag` values into seven visual categories (instructions, memories, notes, participants, tools, dialogue history, and media).
- **Window budgeting**: Ordinary providers reserve output and the generic truncation margin. NovelAI reserves its fitted output cap, native framing, and sentence-completion headroom against the actual subscription window.
- **Dynamic interaction**: Snapshot buttons route through global interaction handlers (`context:v1:snapshot:<personaId>:<format>`), re-evaluating member permissions on each click.

## Source pointers

- `src/commands/tool/prompt/snapshot.ts`: Snapshot export command.
- `src/commands/context.ts`: Context usage command.
- `src/utils/text/promptInspection/assemble.ts`: Shared prompt inspection assembly (`assemblePromptInspection`).
- `src/utils/text/promptInspection/delivery.ts`: Permission validation (`canViewPromptText`) and file delivery.
- `src/utils/text/promptInspection/serialize.ts`: Plain text and native JSON formatting.
- `src/utils/discord/ui/contextUsagePanel.ts`: Grid layout and legend rendering.
- `src/utils/provider/contextBudget.ts`: Generic truncation budgets.
- `src/providers/novelai/promptFitting.ts`: Shared NovelAI preparation and fitting.
