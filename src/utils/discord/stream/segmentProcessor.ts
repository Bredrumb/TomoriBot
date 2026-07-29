import type { StreamContext } from "@/types/stream/interfaces";
import type { StreamState, TextProcessingConfig, TypingSimulationConfig } from "@/types/stream/types";
import { log } from "@/utils/misc/logger";
import { cleanLLMOutput, truncateBeforeGenericSpeakerLine } from "@/utils/text/processors/llmOutputProcessor";
import { filterDuplicateCustomEmojis } from "@/utils/text/emojiPenalty";
import { extractMarkdownTableSegments } from "@/utils/text/markdownTable";
import {
  MAX_EMPTY_RESPONSE_RETRIES,
  ORPHAN_PUNCTUATION_REGEX,
  PREFILL_WHITESPACE_SENTINEL,
} from "@/utils/discord/stream/constants";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import { resolveGuildMentions } from "@/utils/discord/stream/mentionResolver";
import type {
  BufferedDeliveryBoundary,
  StreamDeliveryOptions,
  StreamMessageDelivery,
} from "@/utils/discord/stream/messageDelivery";
import {
  collectRenderModifierSourceNames,
  isAllowedRenderModifierSpeakerLabel,
  type LeadingGenericSpeakerLabelMatch,
  matchesRenderModifierName,
  parseLeadingGenericSpeakerLabel,
  parseLeadingRenderModifier,
} from "@/utils/discord/renderModifierParser";
import {
  collectKnownSpeakerNames,
  resolveCopiedRenderModifierTarget,
  resolveSpriteRenderModifierTarget,
  type SpriteRenderModifierResolution,
} from "@/utils/discord/renderModifierResolver";
import { getCachedPersonaSprites } from "@/utils/cache/personaSpriteCache";
import { normalizePersonaSpriteKey } from "@/utils/persona/sprites";
import { advanceChannelSpriteGroupParity } from "@/utils/discord/stream/channelDeliveryContinuity";
import { isUserImpersonationStreamContext } from "@/utils/discord/stream/uiUpdater";

type StreamSegmentProcessorDependencies = {
  delivery: StreamMessageDelivery;
  requestStop: (channelId: string, requesterId?: string) => boolean;
};

/**
 * Loose detector for "something that LOOKS like a decorated speaker label" — a parenthesized
 * group followed by a colon, anywhere near the head of a segment. Deliberately far more
 * permissive than parseLeadingRenderModifier (no name allowlist, not anchored to the start)
 * so the diagnostic below fires precisely on the cases where the strict parser refused text
 * a human would call a sprite label.
 */
const SUSPECTED_RENDER_MODIFIER_LABEL_RE = /\([^()\n\r:：]{1,64}\)\s*[:：]/;

/** How much of a segment to echo into the diagnostic line. */
const RENDER_MODIFIER_DIAGNOSTIC_HEAD_CHARS = 80;

/**
 * Owns normalization and routing for flushed stream text segments before Discord delivery.
 */
export class StreamSegmentProcessor {
  public constructor(private readonly deps: StreamSegmentProcessorDependencies) {}

  public async sendBufferSegment(
    segment: string,
    boundary: BufferedDeliveryBoundary | undefined,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    state: StreamState,
  ): Promise<void> {
    if (!segment.trim()) return;

    const trimmedGuard = segment.trim();
    if (ORPHAN_PUNCTUATION_REGEX.test(trimmedGuard) && (trimmedGuard.length >= 3 || trimmedGuard.includes("…"))) {
      state.pendingOrphanPunctuation = (state.pendingOrphanPunctuation ?? "") + trimmedGuard;
      log.info(
        `Stream Orphan: Holding "${trimmedGuard}" (pending="${state.pendingOrphanPunctuation}") for next segment`,
      );
      return;
    }

    if (trimmedGuard.length === 1 && !/\w/u.test(trimmedGuard)) return;
    if (trimmedGuard === "..") return;

    let workingSegment = segment;
    // Track whether orphan punctuation was spliced onto the front, since that mutation
    // happens BEFORE the anchored render-modifier parse and can single-handedly defeat it.
    let orphanPrefixApplied: string | undefined;
    if (state.pendingOrphanPunctuation) {
      log.info(`Stream Orphan: Prepending held "${state.pendingOrphanPunctuation}" to next segment`);
      orphanPrefixApplied = state.pendingOrphanPunctuation;
      workingSegment = `${state.pendingOrphanPunctuation}${segment}`;
      state.pendingOrphanPunctuation = undefined;
    }

    const renderModifierSourceNames = collectRenderModifierSourceNames(textConfig.botName, textConfig.botNameAliases);
    const renderModifierChainSourceNames = collectRenderModifierChainSourceNames(textConfig, renderModifierSourceNames);
    let deliveryOptions: StreamDeliveryOptions | undefined;
    const canUseRenderModifier = !state.isInsideCodeBlock && !isUserImpersonationStreamContext(context);
    const renderModifierMatch = canUseRenderModifier
      ? parseLeadingRenderModifier(workingSegment, renderModifierSourceNames, renderModifierChainSourceNames)
      : null;
    this.logUnparsedRenderModifierLabel({
      renderModifierMatch: Boolean(renderModifierMatch),
      canUseRenderModifier,
      orphanPrefixApplied,
      rawSegment: segment,
      workingSegment,
      context,
      state,
      textConfig,
      renderModifierSourceNames,
      renderModifierChainSourceNames,
    });
    if (renderModifierMatch) {
      const sourceDisplayName = context.tomoriState.persona_nickname || textConfig.botName;
      workingSegment = renderModifierMatch.body;

      const spriteResolution = await resolveSpriteRenderModifierTarget(
        renderModifierMatch.modifier,
        context,
        sourceDisplayName,
      );
      const renderTarget =
        spriteResolution.status === "matched"
          ? spriteResolution.target
          : await resolveCopiedRenderModifierTarget(renderModifierMatch.modifier, context, sourceDisplayName);

      if (renderTarget) {
        // Non-identity sprites all share the clean persona username, so Discord —
        // which groups consecutive webhook messages by webhook + username and
        // ignores the per-message avatar — would render back-to-back sprites under
        // the first sprite's avatar. When a sprite change would collide with the
        // previous message's clean name, fall back to the decorated
        // "Persona (sprite)" name for that one message so Discord treats it as a
        // distinct author and renders its avatar. Identity sprites already use a
        // distinct decorated name, so they are excluded.
        const identity =
          renderTarget.spriteRecord && !renderTarget.isIdentitySprite
            ? this.resolveSpriteGroupBreakIdentity(
                renderTarget.identity,
                renderTarget.contextLabel,
                renderTarget.spriteRecord.spriteName,
                context.channel.id,
              )
            : renderTarget.identity;
        // The accumulated-text prefix keeps the decorated "Name (modifier): "
        // label so the model sees its own modifier usage, even when the webhook
        // username is the clean persona name (sprite renders).
        deliveryOptions = {
          identityOverride: identity,
          accumulatedTextPrefix: `${renderTarget.contextLabel}: `,
          spriteRecord: renderTarget.spriteRecord,
        };
        state.activeRenderModifier = {
          identity,
          spriteRecord: renderTarget.spriteRecord,
        };
      } else {
        await this.logUnresolvedRenderModifierTarget(renderModifierMatch.modifier, spriteResolution.status, context);
        state.activeRenderModifier = undefined;
      }
    } else if (canUseRenderModifier && state.activeRenderModifier) {
      deliveryOptions = {
        identityOverride: state.activeRenderModifier.identity,
        spriteRecord: state.activeRenderModifier.spriteRecord,
      };
    }

    // Opening-label leak guard: a response that OPENS with a speaker label the render-modifier
    // parse refused (e.g. "Chris (smug): ..." — a user name in the persona's decorated-label
    // grammar) would otherwise reach Discord verbatim, because the generic speaker guard
    // exempts the opening line and stripLeakedOwnNameLabels only covers the active persona.
    // Runs regardless of llm_stop_speaker_pattern_enabled: the shapes it fires on are
    // unambiguous leaks, unlike the broader mid-text guard.
    if (
      !renderModifierMatch &&
      canUseRenderModifier &&
      !state.accumulatedText.trim() &&
      !state.pendingAggregatedText.trim()
    ) {
      const leak = await this.matchLeadingSpeakerLeak(workingSegment, context, renderModifierSourceNames);
      if (leak) {
        const retryCount = context.emptyResponseRetryCount ?? 0;
        if (retryCount < MAX_EMPTY_RESPONSE_RETRIES) {
          // Budget remains: discard the whole attempt. The speaker_guard stop with nothing
          //    sent classifies the turn as empty_response, and maybeScheduleEmptyResponseRetry
          //    regenerates with the "reply only as {persona}" directive injected.
          log.warn(
            `Stream opening-label leak guard: discarding response opening with "${leak.matchedPrefix.trim()}" (retry ${retryCount + 1}/${MAX_EMPTY_RESPONSE_RETRIES} will be scheduled)`,
          );
          this.deps.requestStop(context.channel.id, "speaker_guard");
          return;
        }
        // Budget exhausted: better a stripped reply than silence — drop the leaked label
        //    and deliver the body as the active persona.
        log.warn(
          `Stream opening-label leak guard: retry budget exhausted, stripping leaked label "${leak.matchedPrefix.trim()}" and delivering body`,
        );
        workingSegment = leak.body;
        if (!workingSegment.trim()) return;
      }
    }

    const wasPrefillInjected = state.prefillInjected;
    const leadingWhitespaceMatch = workingSegment.match(/^\s+/);
    const leadingWhitespace = leadingWhitespaceMatch?.[0] ?? "";
    const normalizedLeadingWhitespace = textConfig.uncensorUnicodeSpacesEnabled
      ? leadingWhitespace.replace(/\u2800/g, " ")
      : leadingWhitespace;

    const filteredSegment = filterDuplicateCustomEmojis(workingSegment, context.contextItems);
    const cleanedSegment = cleanLLMOutput(
      filteredSegment,
      textConfig.botName,
      textConfig.emojiStrings,
      textConfig.emojiUsageEnabled,
      textConfig.mentionMap,
      textConfig.mentionIdSet,
      {
        unicodeSpacesEnabled: textConfig.uncensorUnicodeSpacesEnabled,
        sanitizeEnabled: textConfig.uncensorSanitizeEnabled,
      },
      textConfig.botNameAliases,
      textConfig.personaMentionMap,
    );

    const segmentMentionMap = textConfig.mentionMap ?? new Map<string, string[]>();
    const segmentMentionIdSet = textConfig.mentionIdSet ?? new Set<string>();
    textConfig.mentionMap = segmentMentionMap;
    textConfig.mentionIdSet = segmentMentionIdSet;
    let resolvedSegment = await resolveGuildMentions(
      cleanedSegment,
      context.channel,
      segmentMentionMap,
      segmentMentionIdSet,
      textConfig.personaMentionMap,
    );
    if (
      normalizedLeadingWhitespace &&
      resolvedSegment.length > 0 &&
      !resolvedSegment.startsWith(normalizedLeadingWhitespace)
    ) {
      resolvedSegment = normalizedLeadingWhitespace + resolvedSegment;
    }

    const strippedSegment = this.stripPrefillFromSegment(resolvedSegment, state);
    const prefixedSegment = this.applyPrefillToSegment(strippedSegment, state, context);
    let segmentToSend = prefixedSegment;
    const injectedPrefillThisSegment = !wasPrefillInjected && state.prefillInjected;
    if (injectedPrefillThisSegment && state.prefillTarget && /^\s+/.test(strippedSegment)) {
      segmentToSend = `${state.prefillTarget}${PREFILL_WHITESPACE_SENTINEL}${strippedSegment}`;
    }

    let shouldStopForSpeakerGuard = false;
    if (context.tomoriState.config.llm_stop_speaker_pattern_enabled ?? false) {
      const speakerGuardResult = truncateBeforeGenericSpeakerLine(segmentToSend, {
        includeStart: Boolean(state.accumulatedText.trim() || state.pendingAggregatedText.trim()),
        isAllowedSpeakerLabel: (label) => isAllowedRenderModifierSpeakerLabel(label, renderModifierSourceNames),
      });
      if (speakerGuardResult.stopTriggered) {
        log.warn(
          `Stream speaker guard: stopping before speaker label "${speakerGuardResult.matchedSpeaker ?? "unknown"}"`,
        );
        segmentToSend = speakerGuardResult.text;
        shouldStopForSpeakerGuard = true;
      }
    }

    if (!segmentToSend.trim()) {
      if (shouldStopForSpeakerGuard) {
        this.deps.requestStop(context.channel.id, "speaker_guard");
      }
      return;
    }

    // Copied identities (impersonating a user / another persona) expire at the end
    // of their line so the bot reverts to itself on the next line. Persona sprites
    // instead persist across newlines until a *different* sprite/identity label
    // appears, because an expression is a sustained visual state — e.g.
    //   "Touko (mad): ARGGHHH!\nFine... I'll do it"
    // keeps the "mad" sprite for the second line, and switching only happens when
    // a new "Touko (regret):" label is declared. Sprites (including is_identity
    // ones) are distinguished by carrying a spriteRecord; copied identities don't.
    const shouldClearActiveRenderModifier =
      Boolean(deliveryOptions?.identityOverride) &&
      !deliveryOptions?.spriteRecord &&
      (boundary === "newline" || segmentToSend.includes("\n"));
    const segmentedParts = extractMarkdownTableSegments(segmentToSend);
    const hasRenderedTable = segmentedParts.some((part) => part.type === "table");
    if (!hasRenderedTable) {
      await this.deps.delivery.sendSegment(
        segmentToSend,
        boundary,
        textConfig,
        typingConfig,
        context,
        state,
        deliveryOptions,
      );
    } else {
      let isFirstTextPart = true;
      let partDeliveryOptions = deliveryOptions;
      for (const part of segmentedParts) {
        if (part.type === "text") {
          if (!part.content.trim()) continue;
          await this.deps.delivery.sendSegment(
            part.content,
            isFirstTextPart ? boundary : undefined,
            textConfig,
            typingConfig,
            context,
            state,
            partDeliveryOptions,
          );
          isFirstTextPart = false;
          if (partDeliveryOptions) {
            partDeliveryOptions = {
              ...partDeliveryOptions,
              accumulatedTextPrefix: undefined,
            };
          }
          continue;
        }

        await this.deps.delivery.sendRenderedMarkdownTable(
          part.content,
          part.table.source,
          textConfig,
          typingConfig,
          context,
          state,
          partDeliveryOptions,
        );
        isFirstTextPart = false;
        if (partDeliveryOptions) {
          partDeliveryOptions = {
            ...partDeliveryOptions,
            accumulatedTextPrefix: undefined,
          };
        }
      }
    }

    if (shouldClearActiveRenderModifier) {
      state.activeRenderModifier = undefined;
    }

    if (shouldStopForSpeakerGuard) {
      this.deps.requestStop(context.channel.id, "speaker_guard");
    }
  }

  /**
   * Diagnostic probe for sprite/render-modifier labels that leak into Discord as literal text.
   *
   * A successful `parseLeadingRenderModifier` always strips the label from the segment, so a
   * label visible in the delivered message proves the parse returned null. This logs every
   * input that decision depends on, letting a leaked label be attributed to exactly one of:
   *
   * 1. `isInsideCodeBlock` / `isUserImpersonation` vetoing render modifiers outright.
   * 2. A name mismatch — the label's speaker name is absent from the allowlist built from
   *    `botName` + `botNameAliases`.
   * 3. Anchor loss — text (notably re-attached orphan punctuation) sits ahead of the label,
   *    so the `^\s*`-anchored pattern cannot reach it.
   *
   * Fires only when the strict parse failed AND the segment still looks like it carried a
   * decorated label, so ordinary prose never triggers it.
   *
   * @param args - Parse outcome plus every input that fed it
   */
  private logUnparsedRenderModifierLabel(args: {
    renderModifierMatch: boolean;
    canUseRenderModifier: boolean;
    orphanPrefixApplied: string | undefined;
    rawSegment: string;
    workingSegment: string;
    context: StreamContext;
    state: StreamState;
    textConfig: TextProcessingConfig;
    renderModifierSourceNames: readonly string[];
    renderModifierChainSourceNames: readonly string[];
  }): void {
    // Only interesting when the strict parser declined text that still looks like a label.
    if (args.renderModifierMatch) return;
    const labelHead = args.workingSegment.slice(0, RENDER_MODIFIER_DIAGNOSTIC_HEAD_CHARS);
    if (!SUSPECTED_RENDER_MODIFIER_LABEL_RE.test(labelHead)) return;

    // Echo raw vs working separately so an orphan-punctuation splice is visible as a diff.
    log.warn(
      `Stream RenderModifier Diagnostic: leading label not parsed in channel ${args.context.channel.id}. ` +
        `canUseRenderModifier=${args.canUseRenderModifier} ` +
        `isInsideCodeBlock=${args.state.isInsideCodeBlock} ` +
        `isUserImpersonation=${isUserImpersonationStreamContext(args.context)} ` +
        `isAlter=${args.context.tomoriState.is_alter} ` +
        `personaNickname=${JSON.stringify(args.context.tomoriState.persona_nickname)} ` +
        `botName=${JSON.stringify(args.textConfig.botName)} ` +
        `sourceNames=${JSON.stringify(args.renderModifierSourceNames)} ` +
        `chainSourceNames=${JSON.stringify(args.renderModifierChainSourceNames)} ` +
        `orphanPrefixApplied=${JSON.stringify(args.orphanPrefixApplied ?? null)} ` +
        `rawSegmentHead=${JSON.stringify(args.rawSegment.slice(0, RENDER_MODIFIER_DIAGNOSTIC_HEAD_CHARS))} ` +
        `workingSegmentHead=${JSON.stringify(labelHead)}`,
    );
  }

  /**
   * Diagnostic probe for the silent-drop branch: the model emitted a well-formed
   * "Name (modifier):" label, the parser accepted it and stripped it, but neither a sprite
   * nor a copied identity resolved. The message then ships under the default identity with
   * no sprite and no trace — visually identical to the model never having tried.
   *
   * Logs the persona the sprite lookup was performed against alongside that persona's actual
   * sprite keys, which distinguishes the two candidate causes:
   *
   * 1. Wrong persona — `personaId` is not the persona the model was told to speak as, so its
   *    sprite keys can never match (the failure mode expected on queued/chained turns).
   * 2. Right persona, unknown label — the model invented a sprite key, or the sprite exists
   *    but its avatar is unusable (`resolveSpriteIdentity` returning null).
   *
   * @param modifier - The modifier text the model used, e.g. "mad"
   * @param spriteStatus - Whether the sprite lookup matched before identity resolution
   * @param context - Active stream context (supplies the persona used for the lookup)
   */
  private async logUnresolvedRenderModifierTarget(
    modifier: string,
    spriteStatus: SpriteRenderModifierResolution["status"],
    context: StreamContext,
  ): Promise<void> {
    const personaId = context.tomoriState.persona_id;
    // Read back the sprite roster actually visible to the lookup; a cache miss here is
    //    itself a finding, so failures degrade to an explicit marker rather than throwing.
    let availableSpriteKeys: string[] | "lookup_failed" = "lookup_failed";
    if (typeof personaId === "number") {
      availableSpriteKeys = await getCachedPersonaSprites(personaId)
        .then((sprites) => sprites.map((sprite) => sprite.sprite_key))
        .catch(() => "lookup_failed" as const);
    }

    log.warn(
      `Stream RenderModifier Diagnostic: label parsed but no render target resolved in channel ${context.channel.id}. ` +
        `modifier=${JSON.stringify(modifier)} ` +
        `normalizedSpriteKey=${JSON.stringify(normalizePersonaSpriteKey(modifier))} ` +
        `spriteStatus=${spriteStatus} ` +
        `personaId=${personaId ?? "null"} ` +
        `personaNickname=${JSON.stringify(context.tomoriState.persona_nickname)} ` +
        `isAlter=${context.tomoriState.is_alter} ` +
        `availableSpriteKeys=${JSON.stringify(availableSpriteKeys)}`,
    );
  }

  /**
   * Returns the sprite identity with its webhook username chosen to avoid Discord's
   * consecutive-message grouping collapsing different sprites under one avatar.
   *
   * Discord groups webhook messages by `webhook_id` + `username` (ignoring the
   * per-message avatar) and strips zero-width/blank characters from usernames, so
   * the only reliable way to make two adjacent sprites distinct is a visibly
   * different name. We keep the clean persona name by default and only fall back to
   * the decorated `Persona (sprite)` name (`contextLabel`) on the *follow-up* of a
   * sprite change, so the suffix appears only at a boundary that would otherwise
   * merge. A parity toggle flipped on each sprite change guarantees that adjacent
   * different-sprite messages alternate clean/decorated and therefore never match;
   * same-sprite runs keep an identical username and still group naturally.
   *
   * The alternation is tracked per CHANNEL, not per stream. Discord's grouping spans turns,
   * so bookkeeping held in `StreamState` was reset at every turn boundary and let a queued
   * turn's first sprite collide with the previous turn's last sprite.
   * See {@link advanceChannelSpriteGroupParity}.
   */
  private resolveSpriteGroupBreakIdentity(
    identity: ResolvedWebhookIdentity,
    decoratedUsername: string,
    spriteKey: string,
    channelId: string,
  ): ResolvedWebhookIdentity {
    // The "false" half keeps the clean persona name; the "true" half uses the
    //    decorated "Persona (sprite)" name so it reads as a distinct Discord author.
    if (!advanceChannelSpriteGroupParity(channelId, spriteKey)) {
      return identity;
    }
    return { ...identity, username: decoratedUsername };
  }

  /**
   * Detects a leaked speaker label at the start of a response segment — a label the
   * render-modifier parse already refused (its source name is not the active persona/aliases).
   *
   * Firing rules, per shape:
   * 1. Decorated "Name (modifier):" — always a leak. The parenthetical grammar belongs
   *    exclusively to the active persona (sprites, copied identities), so ANY other name using
   *    it is the model cross-breeding history label formats ("Chris (smug): ...").
   * 2. Plain "Name:" — a leak only when Name is a known conversation participant (another
   *    persona or a user in the conversation). Ordinary prose openings ("Note:", "TL;DR:")
   *    never match a participant and pass through untouched.
   *
   * A leading chain of the persona's own plain labels ("Tomori: Chris (smug): hi") is peeled
   * before deciding, since those are stripped later by cleanLLMOutput anyway.
   *
   * @param segment - Segment text at response start (nothing accumulated or sent yet)
   * @param context - Stream context (guild + conversation participants for the known-name check)
   * @param allowedSourceNames - Active persona name + aliases (labels these own are not leaks)
   * @returns The leaked-label match (body = text after the label), or null when clean
   */
  private async matchLeadingSpeakerLeak(
    segment: string,
    context: StreamContext,
    allowedSourceNames: readonly string[],
  ): Promise<LeadingGenericSpeakerLabelMatch | null> {
    // Peel allowed plain self-labels ("Tomori:") so a leak hiding behind them is still seen.
    let working = segment;
    let match = parseLeadingGenericSpeakerLabel(working);
    while (match && !match.modifier && matchesRenderModifierName(match.sourceName, allowedSourceNames)) {
      working = match.body;
      match = parseLeadingGenericSpeakerLabel(working);
    }
    if (!match) return null;

    // A decorated label with an allowed source name is upstream's business (the render-modifier
    //    parse consumes it, including failed sprite resolutions) — never treat it as a leak here.
    if (matchesRenderModifierName(match.sourceName, allowedSourceNames)) return null;

    // Decorated + disallowed name: unambiguous leak.
    if (match.modifier) return match;

    // Plain label: only a leak when the name belongs to a known conversation participant.
    const knownNames = await collectKnownSpeakerNames(context);
    return matchesRenderModifierName(match.sourceName, knownNames) ? match : null;
  }

  public async prepareOutputPrefill(
    context: StreamContext,
    textConfig: TextProcessingConfig,
    state: StreamState,
  ): Promise<void> {
    const rawPrefill = context.outputPrefill?.trim();
    if (!rawPrefill) return;

    const filteredPrefill = filterDuplicateCustomEmojis(rawPrefill, context.contextItems);
    const cleanedPrefill = cleanLLMOutput(
      filteredPrefill,
      textConfig.botName,
      textConfig.emojiStrings,
      textConfig.emojiUsageEnabled,
      textConfig.mentionMap,
      textConfig.mentionIdSet,
      {
        unicodeSpacesEnabled: textConfig.uncensorUnicodeSpacesEnabled,
        sanitizeEnabled: textConfig.uncensorSanitizeEnabled,
      },
      textConfig.botNameAliases,
      textConfig.personaMentionMap,
    );

    const prefillMentionMap = textConfig.mentionMap ?? new Map<string, string[]>();
    const prefillMentionIdSet = textConfig.mentionIdSet ?? new Set<string>();
    textConfig.mentionMap = prefillMentionMap;
    textConfig.mentionIdSet = prefillMentionIdSet;
    const resolvedPrefill = await resolveGuildMentions(
      cleanedPrefill,
      context.channel,
      prefillMentionMap,
      prefillMentionIdSet,
      textConfig.personaMentionMap,
    );
    if (!resolvedPrefill.trim()) return;

    state.prefillTarget = resolvedPrefill;
    state.prefillMatched = 0;
    state.prefillMatchFailed = false;
    state.prefillInjected = Boolean(context.outputPrefillState?.sent);

    log.info(`Stream Prefill: Prepared output prefill (${resolvedPrefill.length} chars).`);
  }

  public async flushHeldOrphanPunctuation(
    boundary: BufferedDeliveryBoundary,
    textConfig: TextProcessingConfig,
    typingConfig: TypingSimulationConfig,
    context: StreamContext,
    state: StreamState,
  ): Promise<void> {
    const deliveryOptions =
      state.activeRenderModifier && !isUserImpersonationStreamContext(context)
        ? {
            identityOverride: state.activeRenderModifier.identity,
            spriteRecord: state.activeRenderModifier.spriteRecord,
          }
        : undefined;
    await this.deps.delivery.flushHeldOrphanPunctuation(
      boundary,
      textConfig,
      typingConfig,
      context,
      state,
      deliveryOptions,
    );
  }

  private applyPrefillToSegment(segment: string, state: StreamState, context: StreamContext): string {
    if (!state.prefillTarget) return segment;

    if (!state.prefillInjected) {
      if (!segment.trim()) return "";
      state.prefillInjected = true;
      if (context.outputPrefillState) {
        context.outputPrefillState.sent = true;
      }
      return state.prefillTarget + segment;
    }

    return segment;
  }

  private stripPrefillFromSegment(segment: string, state: StreamState): string {
    const target = state.prefillTarget;
    if (!target || state.prefillMatchFailed || state.prefillMatched >= target.length) {
      return segment;
    }

    let index = 0;
    while (index < segment.length && state.prefillMatched < target.length) {
      const expected = target[state.prefillMatched];
      const actual = segment[index];

      if (actual === expected) {
        state.prefillMatched += 1;
        index += 1;
        continue;
      }
      state.prefillMatchFailed = true;
      state.prefillMatched = target.length;
      return segment;
    }

    if (state.prefillMatched >= target.length) {
      return segment.slice(index);
    }

    return "";
  }
}

function collectRenderModifierChainSourceNames(
  textConfig: TextProcessingConfig,
  activeSourceNames: readonly string[],
): string[] {
  const knownPersonaLabels: string[] = [];
  if (textConfig.personaMentionMap) {
    for (const [alias, trigger] of textConfig.personaMentionMap) {
      knownPersonaLabels.push(alias, trigger);
    }
  }

  return collectRenderModifierSourceNames(textConfig.botName, [...activeSourceNames, ...knownPersonaLabels]);
}
