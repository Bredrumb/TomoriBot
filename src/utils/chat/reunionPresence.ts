/**
 * Reunion presence — the behavioral "when did this persona last see this person"
 * clock behind reunion notes.
 *
 * The clock is deliberately **presence**, not the `message_sent` telemetry metric.
 * That metric's recording rules exist for leaderboard correctness (guild-only,
 * successful turns, triggerer only), and reading them as relationship state made
 * DM conversations and bystanders look like weeks of absence.
 *
 * ## Two-phase protocol
 *
 * This module owns both halves, which run in different pipeline phases:
 *
 *  1. {@link resolveReunionNotes} — at **context build** (`contextPipeline`).
 *     Resolves who the persona can see, reads their clocks in one grouped query,
 *     and returns the notes to inject plus the presence scope to commit later.
 *  2. {@link recordReunionPresence} — at **post-turn** (`postTurnEffects`).
 *     Commits that scope as `presence_seen` ticks.
 *
 * Splitting them is load-bearing in both directions:
 *
 *  - Writing during phase 1 would let the read see the turn's own tick, so a turn
 *    would consume the grace window it just opened.
 *  - Writing during phase 1 would also tick turns that never answered. A failed or
 *    silent turn delivered no acknowledgment, so it must not consume the reunion —
 *    it would burn today's grace and, worse, reset tomorrow's day gap, permanently
 *    losing a reunion the user never received.
 *
 * Keep the two functions together: editing one without the other breaks the clock
 * in ways no type error will catch.
 */
import { getCachedUserRow } from "@/utils/cache/userCache";
import { statRepository } from "@/utils/db/repositories";
import type { TomoriState } from "@/types/db/schema";
import type { ChatTurn, GenerationTurnResult } from "@/utils/chat/types";
import type { SimplifiedMessageForContext } from "@/utils/text/contextBuilder";
import {
  buildReunionNote,
  TIME_AWARENESS_MAX_REUNION_NOTES,
  TIME_AWARENESS_PRESENCE_WINDOW,
} from "@/utils/text/context/timeAwareness";

/**
 * Who the answering persona could see this turn, pending a post-turn commit.
 * Null when reunion tracking did not apply (capability off, impersonation,
 * stat tracking disabled, or no resolvable people).
 */
export interface ReunionPresenceScope {
  serverId: number;
  lineageId: number;
  userIds: number[];
}

/** One person the persona can currently see, in reunion-note priority order. */
interface ReunionCandidate {
  displayName: string;
  timezoneOffset: number | null;
  isTriggerer: boolean;
}

/**
 * Phase 1 — builds this turn's reunion notes and the presence scope to commit
 * once the turn produces a response.
 *
 * @param args - Turn scope, the effective persona, and the identities to exclude.
 * @returns `notes` — raw bodies (the dialogue-history stage wraps them in
 *          `[System: ]`), triggerer first, capped at TIME_AWARENESS_MAX_REUNION_NOTES —
 *          and `presence`, the scope handed to {@link recordReunionPresence}.
 */
export async function resolveReunionNotes(args: {
  turn: ChatTurn;
  effectivePersona: TomoriState;
  simplifiedMessages: SimplifiedMessageForContext[];
  isUserImpersonation: boolean;
  impersonatedUserId?: string;
  botUserDiscId?: string;
}): Promise<{ notes: string[]; presence: ReunionPresenceScope | null }> {
  const { turn, effectivePersona } = args;
  const lineageId = effectivePersona.persona_lineage_id;
  const serverId = effectivePersona.server_id;

  // Preconditions. Stat tracking is one of them: with the write side off every
  //    read returns "no history", which would greet everyone as a stranger forever.
  if (
    effectivePersona.config.time_awareness_enabled === false ||
    args.isUserImpersonation ||
    !statRepository.isTrackingEnabled ||
    typeof lineageId !== "number" ||
    !Number.isInteger(lineageId) ||
    lineageId < 0 ||
    typeof serverId !== "number" ||
    !Number.isInteger(serverId)
  ) {
    return { notes: [], presence: null };
  }

  // Candidate set, insertion-ordered: the triggerer first, then the distinct
  //    human authors of the trailing presence window, most recent first.
  const candidates = new Map<number, ReunionCandidate>();
  const triggererUserId = turn.userRow.user_id;
  if (typeof triggererUserId === "number" && Number.isInteger(triggererUserId)) {
    candidates.set(triggererUserId, {
      displayName: turn.triggererName,
      timezoneOffset: turn.userRow.timezone_offset ?? null,
      isTriggerer: true,
    });
  }

  const windowMessages = args.simplifiedMessages.slice(-TIME_AWARENESS_PRESENCE_WINDOW);
  const visitedAuthorDiscIds = new Set<string>();
  for (let index = windowMessages.length - 1; index >= 0; index--) {
    const msg = windowMessages[index];
    if (msg.authorType !== "user" || !msg.authorId) continue;
    if (msg.authorId === args.botUserDiscId || msg.authorId === args.impersonatedUserId) continue;
    if (visitedAuthorDiscIds.has(msg.authorId)) continue;
    visitedAuthorDiscIds.add(msg.authorId);

    // Bridged/synthetic authors have no users row; skip them rather than
    //     registering an account as a side effect of building context.
    const userRow = await getCachedUserRow(msg.authorId).catch(() => null);
    const userId = userRow?.user_id;
    if (typeof userId !== "number" || !Number.isInteger(userId) || candidates.has(userId)) continue;
    candidates.set(userId, {
      // Use the transcript's own name so the note references someone the model
      // can actually find in the dialogue above it.
      displayName: msg.authorName,
      timezoneOffset: userRow?.timezone_offset ?? null,
      isTriggerer: false,
    });
  }
  if (candidates.size === 0) return { notes: [], presence: null };

  // One grouped read for the whole candidate set. A failed read yields null,
  //    which must mean "say nothing" — never "nobody here has any history".
  const reunionInfoByUserId = await statRepository.getUsersPersonaReunionInfo(Array.from(candidates.keys()), lineageId);
  if (!reunionInfoByUserId) return { notes: [], presence: null };

  // Presence scope for the post-turn commit (see the module header for why it
  //    is not written here).
  const presence: ReunionPresenceScope = { serverId, lineageId, userIds: Array.from(candidates.keys()) };

  // Notes in candidate order (triggerer first), capped so a channel waking up
  //    doesn't bury the conversation under greetings.
  const notes: string[] = [];
  for (const [userId, candidate] of candidates) {
    if (notes.length >= TIME_AWARENESS_MAX_REUNION_NOTES) break;
    const reunionInfo = reunionInfoByUserId.get(userId) ?? { lastPreviousDayAt: null, todayCount: 0 };
    const note = buildReunionNote({
      ...reunionInfo,
      personalOffset: candidate.timezoneOffset,
      serverOffset: effectivePersona.config.timezone_offset,
      displayName: candidate.displayName,
      isTriggerer: candidate.isTriggerer,
    });
    if (note) notes.push(note);
  }
  return { notes, presence };
}

/**
 * Phase 2 — commits the turn's `presence_seen` ticks.
 *
 * Only runs when the turn actually produced a response (see the module header).
 * Unlike `recordUsageStats` this deliberately does NOT skip DMs: excluding them is
 * a leaderboard-hygiene rule, and applying it to a relationship clock is exactly
 * what made DM conversations look like weeks of absence.
 *
 * @param presence - Scope resolved by {@link resolveReunionNotes}; null is a no-op.
 * @param result   - The turn result; an empty personaResponses list records nothing.
 */
export function recordReunionPresence(presence: ReunionPresenceScope | null, result: GenerationTurnResult): void {
  if (!presence || result.personaResponses.length === 0) return;
  for (const userId of presence.userIds) {
    statRepository.recordStat({
      serverId: presence.serverId,
      userId,
      lineageId: presence.lineageId,
      metric: "presence_seen",
    });
  }
}
