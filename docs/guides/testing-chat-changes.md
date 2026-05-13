<!-- ARCH-ALIGNMENT: prereq-phase-5 -->

# Testing Chat Changes

This guide covers the chat regression harness introduced in Phase 5 (#12a). The harness protects the highest-risk chat decision behavior across the Phase 5 (#12b) deconstruction.

## TL;DR

```bash
# Run only chat regression tests
bun test tests/regression/chat/

# Run all tests; chat regression tests are included
bun test tests/
```

## What the harness covers

The first harness is fixture-driven and targets chat decision functions:

- `shouldBotReply()` in `src/utils/chat/admission.ts` for reply/no-reply decisions
- `determineMatchingPersonas()` in `src/utils/chat/triggerProcessor.ts` for persona routing and deterministic ordering

Fixtures live in `tests/regression/chat/fixtures/conversations.json`. Expected decisions live in `tests/regression/chat/fixtures/expected-decisions.json`.

The initial fixture set records representative golden paths for:

| Fixture | Provider label | Behavior protected |
|---|---|---|
| `google-direct-mention-main` | Google | Direct bot mention routes to the main persona |
| `openrouter-deliberate-alter-trigger` | OpenRouter | Deliberate trigger mode accepts `@trigger` for an alter |
| `novelai-autochat-channel-alter` | NovelAI | Always-reply autochat channel routes to its assigned alter |
| `google-multi-persona-trigger-order` | Google | Multi-persona triggers keep deterministic first-match ordering |
| `openrouter-deliberate-mode-ignores-plain-trigger` | OpenRouter | Deliberate trigger mode rejects plain trigger words without `@` |
| `google-persona-webhook-self-trigger` | Google | Persona webhook messages are treated as self-generated and cannot trigger themselves |

The provider labels document the three required provider families for Phase 5 (#12a). These fixtures do not call live providers; they freeze chat orchestration decisions that happen before provider streaming.

## Running the tests

```bash
# Fast local loop
bun test tests/regression/chat/chat.regression.test.ts

# Full chat harness
bun test tests/regression/chat/

# Full project test command; this is what CI should run
bun test tests/
```

The harness does not require Discord credentials, provider API keys, or a database. It builds mocked Discord `Message`, `Client`, and `TextChannel` objects with only the fields needed by the decision functions.

## Adding a fixture

1. Add a new entry to `tests/regression/chat/fixtures/conversations.json`.
2. Use stable fake Discord IDs (`user_004`, `channel_001`, etc.).
3. Add the expected result to `tests/regression/chat/fixtures/expected-decisions.json`.
4. Run `bun test tests/regression/chat/`.

Keep fixtures small. Each fixture should protect one behavior: a reply trigger, a no-reply guard, persona ordering, a webhook/self-trigger edge case, an autochat path, or a reply-reference path.

For Phase 5 (#12b), prefer adding fixtures against `src/utils/chat/triggerProcessor.ts` whenever extracted trigger logic changes. The harness should keep proving behavior at the new module boundary instead of depending only on `tomoriChat.ts`.

## Verifying the harness catches regressions

`chat.regression.test.ts` includes a skipped probe test:

```ts
it.skip("[REGRESSION PROBE] fails when a fixture expectation is deliberately inverted", () => {
  // ...
});
```

To smoke test the smoke test:

1. Temporarily remove `.skip` from the probe.
2. Run `bun test tests/regression/chat/`.
3. Confirm the probe fails.
4. Restore `.skip`.
5. Re-run the harness and confirm it passes.

## Expanding for Phase 5 (#12b)

When deconstructing the temporary chat turn runner further, add fixtures for every behavior the extraction touches:

- Golden-path message handling
- Function-call tool trigger and response routing
- REST and MCP tool routing decisions
- Multi-persona triggering and ordering
- Webhook self-trigger suppression
- Empty mentions and malformed reply references
- Rate-limit and cooldown rejection paths
- Provider fallback or credential-unavailable branches

When a post-refactor chat bug is fixed, add a fixture for it in the same PR. The harness is a living regression suite, not a one-time checkpoint.
