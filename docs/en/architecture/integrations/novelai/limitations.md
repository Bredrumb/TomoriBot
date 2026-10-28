---
title: "NovelAI provider limitations"
aiGenerated: true
---

NovelAI text models accept text prompts and return streamed text. They accept no image or video
input and expose no function calling. NovelAI image generation uses a separate pipeline and remains
available through commands and through tools called by another text provider.

## Model templates and access

`modelProfiles.ts` owns each model's endpoint, renderer, tokenizer, sampling defaults, output policy,
and subscription allowances. Unknown codenames fail profile lookup. GLM uses a chat template; Kayra
and Erato use story prompts with ATTG. GLM puts personality and memories at the start of the first
user turn. These three models have no system block. Xialong uses NovelAI's recommended English
system prompt verbatim, with ATTG as the first entry under `Relevant persistent information:` in
the first user turn. Its stars default to 4; Erato emits stars only when configured, and Kayra
omits them.

Selecting Xialong checks the saved server or personal credential for an active Opus subscription
before writing the selection. A registered provider with no key permits selection. Adding or
replacing a key refreshes subscription facts and checks the saved model before storage. Server
changes also check the active model and include rotation keys. A tier rejection
during generation uses the same localized Opus notice. GLM remains the default and smartest model.
Xialong's published sampling preset is available as `Default-Xialong`.

Model switches use the default row for the serving model's preset target: `Carefree-Kayra`,
`Erato-Shosetsu`, or `Default-Xialong`. GLM uses its profile defaults and clears the previous preset.
Server selection updates both active configuration and the saved NovelAI provider row; personal
selection updates the user's provider row. Applying a preset resets temperature, top-k, top-p, and
min-p and enables those samplers. Later edits remain active until another model switch or preset
application. Configured reply length is preserved. Key replacement on the same model preserves
sampler edits.

Kayra, Erato, and Xialong derive their base samplers from the same typed catalog used to seed the database.
Request preparation resolves a saved preset within the serving model's target and excludes
incompatible preset parameters. Fallback attempts use matching model defaults for inherited
samplers without writing them back to the primary configuration. Personal and cross-provider
overlays carry the scope's own preset name, so a server's loaded preset cannot replace a personal
selection. Prompt inspection uses the same preparation path.

## Prompt content and saved settings

`promptFitting.ts` admits personality, sample dialogue, server and visible personal memories,
short-term memory, and actual conversation text. Other tags and untagged instructions are excluded.
The native context survives preset reassembly separately, so each actual NovelAI attempt can use it
without imported preset instructions or depth injections. History carries its conversation text
separately from generated timestamps, attachment hints, and tail directives. Explicit assistant
prefills remain part of the request.

History simplification carries `completionContent` before adding reply references, reactions, and
media instructions. Classified notices supply semantic text: gestures become actions, while scene
descriptions and summaries lose their system wrapper. Administrative notices are omitted. Forwarded
text and available transcripts remain prose. `completionSpeaker: false` marks narration that needs
no author label. Same-author merging preserves this content separately; literal user quotations are
never stripped by matching a system-looking prefix. Inspection uses the same notice projection.

The `General Behavior` panel displays a localized notice while the workspace's text model is
NovelAI. Saved system, persona, and channel prompts, context notes, humanizer rules, conditioning,
and SillyTavern instructions remain stored but inactive. Personality and sample dialogue remain
active. The user-facing [content table](/features/knowledge/inside-the-prompt/#novelai-special-handling)
owns the complete list of settings and memory-trimming behavior. Thinking directives follow the
active model profile; see [Thinking Level](/architecture/subsystems/thinking-level/#novelai).

Each profile enables text polishing before rendering and counting. The NovelAI fitter applies it
to user and persona history, both sides of sample dialogue, and admitted memories. Known persona
names come from the active persona, history senders, and existing participant target metadata.
Explicit prefills and continuation fragments remain exact. The user-facing
[polishing rules](/features/knowledge/inside-the-prompt/#text-polishing-and-discord-delivery) own
the formatting details and protected content.

Polishing is independent of the humanizer degree. The shared Discord delivery pipeline still
applies the configured humanizer. Later context is reconstructed from Discord messages, so lost
punctuation cannot be recovered exactly; no original unhumanized transcript is stored. These
formatting rules do not rewrite grammar. Other providers retain their existing prompt paths.

Participant hydration supplies plain memory contents with internal identities and recency after the
ordinary privacy, blacklist, lineage, channel, and corpus filters. NovelAI omits database IDs, tag
prefixes, and added owner labels from long-term memory text. Names and placeholders are resolved
before rendering; GLM separates entries with single line breaks. Other providers retain their
combined participant block and tool-targeting IDs. Inline and deferred short-term memory remain
eligible for NovelAI.

Short-term memory update nudges carry an empty `completionText` projection. Fitting honors that
projection even when another provider built the context before a personal override or fallback.
Actual memory contents remain eligible; instructions to call memory tools are excluded.

The fitter renders the complete prompt, counts it locally, and removes extra sample exchanges,
memories, then oldest history exchanges. It protects personality and ATTG, one sample exchange,
two recent history exchanges, and the triggering message when its identity is supplied. Memory
eligibility has no relevance score: older dated entries leave first, with source order breaking ties;
undated blocks use the same stable ordering. Memory content is bounded to one fifth of the window.
An oversized protected floor fails with a localized error.

## Allowances and tokenizer assets

Active subscription facts are cached for 24 hours by the actual request credential. Inactive results
remain uncached so renewal can take effect on the next request. A failed lookup,
inactive subscription, or unsupported tier fails preparation instead of granting a default allowance.
The initial budgets use published base windows: GLM has 8,192 tokens on Tablet and 28,672 on Scroll
and Opus; Kayra has 4,096 on Tablet and 8,192 on Scroll and Opus; Erato has 8,192 on Opus; Xialong has
28,672 on Opus. Scroll behavior has not been measured. Rollover context is excluded from these budgets.

Required tokenizers come from pinned MIT definitions provisioned by `bun run setup:tokenizers`.
The loader checks their hashes and caches definitions and load failures. Each fitting session owns
its encoder because upstream's fragment cache has no eviction. Prompts exceeding one million UTF-16
characters or containing more than 1,024 consecutive non-whitespace code points fail before encoding
to bound the upstream encoder's cost. Missing or invalid assets require provisioning and a restart.
The separate `glm_zai` encoder continues to serve logit bias unchanged.

The configured output length wins over sampling-preset length. Native requests follow the API
schema's 2,048-token output ceiling. Completion profiles have no known output ceiling and request
the configured length within the remaining window. Default lengths are 1,024 for completion
profiles and 150 for native profiles; actual generation maxima remain unmeasured. Fitting can
reduce the output cap at the protected floor. Kayra reserves one extra native framing token.
Native sentence completion reserves another 64 tokens because it can exceed the requested output
length; this headroom still needs production validation.

## Stream termination and continuation

The provider-owned adapter keeps one Discord delivery session across at most two continuation
requests. Unexpected EOF or read inactivity can continue a held fragment using the cumulative raw
output as a prefill. Every request is fitted again and subtracts locally counted generated tokens
from one total output budget, including thinking text. Complete sentences already delivered are not
replayed. Requested-length endings do not start a fresh budget. Normal stops flush unpunctuated
replies without a retry. Speaker stops and cancellation end the session.

An exhausted empty continuation becomes a localized provider error, so shared empty-response retry
cannot multiply its bound. Thinking text remains separate from visible output. The trigger and retry
bound still require conversational quality validation against real provider cutoffs.

All NovelAI profiles automatically stop at known foreign speaker labels. The serving persona's
name, aliases, and render-modifier labels remain allowed; the shared speaker-stop toggle does not
disable this provider rule. Speaker names come from dialogue and existing participant metadata.
Configured exact stop strings still apply.

Standalone `---` and `***` lines also end the response. The local guard holds partial markers until
the next character distinguishes a separator from emphasis, and recognizes a final separator at EOF.
API separator stops include both surrounding newlines to preserve triple emphasis in prose.

The prepared request carries newline-prefixed foreign-name stops. Completion profiles send literal
strings, while native profiles encode token sequences; Erato includes punctuation-prefixed variants
to account for tokenization at the boundary. Native requests cap the sequence list at 1,024.
The local guard covers the full speaker list, including labels at the start of the response,
bold/decorated labels, full-width colons, and labels split across chunks. It holds incomplete
prefixes before delivery and ends the attempt without continuation when a foreign label completes.
Its parser preserves code, headings, and inline name mentions. API stop strings are literal, so
an exact foreign-name or separator stop inside generated code can still end generation upstream.

## Prompt diagnostics

[Prompt inspection](/architecture/subsystems/prompt-snapshot/) uses the same preparation function
as generation. Text exports begin with the rendered prompt; JSON exports contain the profile's
request parameters and fitting report. Both expose included, excluded, and trimmed identities,
exact input count, window, and effective output cap. The context panel uses the exact total with
approximate segment shares. Inspection reconstructs the resolved personal or server credential's
current request without selecting a rotation key or exporting its identity. It does not capture
an earlier request or subsequent continuation attempts.

## Source pointers

- `src/providers/novelai/modelProfiles.ts` and `promptFitting.ts`: request policy and fitting.
- `src/providers/novelai/promptRenderers.ts`: prompt templates and ATTG.
- `src/providers/novelai/novelaiStreamAdapter.ts` and `novelaiService.ts`: delivery guards and transport termination.
- `src/utils/provider/localTokenizerRegistry.ts` and `tokenizers/manifest.json`: required local assets.
- `src/utils/text/context/participants.ts` and `dialogueHistory.ts`: provider-specific content projections.
- `src/utils/text/promptInspection/assemble.ts`: shared inspection preparation.
