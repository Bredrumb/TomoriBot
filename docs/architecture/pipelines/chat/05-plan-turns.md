---
title: "05: Turn Planning"
---

Persona selection + per-turn state assembly.

**File:** `src/utils/chat/turnPlanner.ts:49-288`

## Mission

Decide which persona(s) will respond and in what order, and produce one
fully-populated `ChatTurn` per responding persona. Runs the long sequence of
gating checks (trigger validation, access, cooldown, credentials, persona match,
rate limit, quota) and assembles the per-turn closure that stages 06-per-turn
will consume.

## Input

`LockedChatTurn` (from stage 04). Carries the `RunnableChatAdmission` plus
channel-lock metadata.

## Output

`ChatTurnPlan`:

```ts
{
  lockedTurn: LockedChatTurn;
  turns: ChatTurn[];   // empty array means "skip — no response"
}
```

`turns: []` is the silent-skip signal for any failed gate (access denied,
cooldown rejected, no persona matched, quota exhausted, etc.) — the coordinator
treats it as "release lock, replay queue."

`ChatTurn` (one per responding persona — see `src/utils/chat/types.ts:141-171`):

- The chosen `persona: TomoriState` plus all sibling personas for context
- `userRow`, `triggererName`, `requestSnapshot` (privacy, blacklist, member ref)
- Channel/server name and description, DM flag, self-message flag
- Resolved credential policy (`textCredentialSource: "server" | "personal"`,
  `personalRoutingUserId`, `personalTextProvider`). `textCredentialSource` is copied
  into `StreamingContext` by `buildChatTurnContext` and on into `StreamContext`, so the
  provider error layer can name server- or personal-scoped recovery commands. See
  [Credential-scoped recovery tips](/architecture/pipelines/provider/03-chunk-normalization/#credential-scoped-recovery-tips).
- Text-quota preflight result (`shouldApplyTextQuota`, `textQuotaTriggerKey`,
  `textQuotaState`)
- User-error visibility (`shouldSurfaceUserErrors`) so passive autochat/random
  turns can fail quietly while deliberate mentions, trigger words, replies,
  DMs, reminders, and command-driven turns still get feedback.
- Forced mentions, impersonation flags

## Side effects

- **Trigger user registration** — `loadOrRegisterTriggerUser` registers
  first-seen users via `userRepository.register` and updates `admission.userRow`
  in place.
- **Autochat counter increment** — `updateAutochatCounter` advances
  `autoch_counter` and resets the next-target threshold via
  `configRepository.incrementTomoriCounter`. Skipped for thought-log channels,
  non-autochat channels, and non-real-user messages.
- **Trigger user mutation on admission** — `admission.locale`,
  `admission.userRow`, `admission.tomoriState`, `admission.allPersonas`,
  `incoming.isUserImpersonation`, `incoming.impersonatedUserId` are set on the
  carried admission/incoming objects so downstream stages share the resolved
  state.
- **Missing persona feedback** — direct user turns surface the localized setup
  error. Automated turns with `shouldSurfaceUserErrors: false`, including
  reminder retries, return an empty plan silently so their owning scheduler can
  apply its retry and final-fallback policy.
- **Multi-persona queueing** — if more than one persona matched (and the
  message is a real user message, non-stop-response, non-reminder),
  `queueAdditionalPersonaTurns` puts the *extra* personas at the *front* of the
  channel queue. Only the first persona runs in the current turn-sequence;
  others are replayed as queued messages immediately after.
- **Channel-lock active-turn state** — `setActiveChannelTurnState` records the
  first persona's ID, follow-up eligibility, impersonation flags so the channel
  lock can authorize follow-up interrupts.
- **Cooldown enforcement and setting** — `rejectOnMessageTriggerCooldown` may
  send a user-visible cooldown notice for deliberate turns, then
  `setMessageTriggerCooldownForAdmission` runs on success.
- **Credential errors** — `resolveTextCredentialPolicy` may send error embeds
  for `PersonalProviderRequiredError` or `CredentialUnavailableError` only when
  `shouldSurfaceUserErrors` is true, then returns `null` (causing `turns: []`).
- **Text-quota preflight** — `checkTextQuotaForAdmission` may send a
  quota-exceeded embed for deliberate turns and reject the turn. Passive turns
  reject silently.

## Invariants

After this stage runs:

- If `turns.length > 0`, every entry has a non-null `persona`, a resolved
  `userRow`, and a credential policy (`textCredentialSource` is set).
- If multi-persona response is needed, only `turns[0]` runs *now*; the rest are
  queued at the front of the channel queue and run after lock release.
- The channel lock's `activePersonaId`/`followUpEligible`/impersonation flags
  reflect the persona that will speak in this turn-sequence.
- All trigger/access/cooldown side effects (counter increment, cooldown set,
  blocked-by-quota handling) have fired *before* the per-turn loop starts —
  stages 06-per-turn never re-check these. Passive autochat/random turns may
  log and abort without emitting a user-facing error embed.

## Extension points

This stage is **the densest decision surface in the chat pipeline**, and most
of its decisions are delegated to named helpers. Each helper is the
plugin-relevant seam:

| Decision | Helper | Plugin-relevance |
|---|---|---|
| Direct-trigger validation (mention/reply/word-trigger) | `validateDirectChatTrigger` (`admissionGuards.ts`) | A plugin adding a new trigger style would extend here |
| Access policy (whitelist, spotlight, role gates) | `evaluateChatAccess` (`admissionGuards.ts`) | → plugin plan candidate if plugins want to add access rules |
| Per-persona reply decision | `shouldBotReply` (`replyDecision.ts`) | A plugin adding a new auto-reply mode hooks here |
| Persona matching | `determineMatchingPersonas` (`triggerProcessor.ts`) | Heavy logic; coupled to autochat/DTM/always-reply/personal-spotlight semantics |
| Credential resolution (server vs personal BYOK) | `resolveCapabilityCredentials` (`credentialResolver.ts`) | The credential-source abstraction is the plugin-relevant seam |
| Rate limit (per-user, per-server, global) | `enforceGlobalRateLimit` (`admissionGuards.ts`) | Internal — coupled to rate-limit metric names |
| Message-trigger cooldown | `rejectOnMessageTriggerCooldown`, `setMessageTriggerCooldownForAdmission` | Internal — coupled to `CooldownType` enum |
| Text-quota preflight | `checkTextQuotaForAdmission` (`admissionGuards.ts`) + `textQuotaManager` | Internal — coupled to quota table schema |
| Cascade trigger limit | `getSelfReplyChainState` (`selfReplyState.ts`) | Internal — coupled to self-reply chain semantics |

**The stage itself is internal.** A future plugin extension for "modify the
turn plan" would likely take the form of a post-plan hook
(`afterPlanTurns(plan) → plan'`) that adds or filters turns *after* the fixed
gating completes, not a wholesale override.

## Related docs

- Credential resolution: → [provider pipeline](../provider/).
- Autochat / DTM / always-reply mode semantics: → folded into `triggerProcessor.ts`; no dedicated doc yet.
- Cooldown types and behavior: → [`docs/architecture/subsystems/cooldowns.md`](../../subsystems/cooldowns).
- Text quota: → no dedicated doc yet; quota-manager helper only.
