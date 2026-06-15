import type { StreamContext } from "@/types/stream/interfaces";
import type { StreamState, TextProcessingConfig, TypingSimulationConfig } from "@/types/stream/types";
import { log } from "@/utils/misc/logger";
import { cleanLLMOutput, truncateBeforeGenericSpeakerLine } from "@/utils/text/processors/llmOutputProcessor";
import { filterDuplicateCustomEmojis } from "@/utils/text/emojiPenalty";
import { extractMarkdownTableSegments } from "@/utils/text/markdownTable";
import { ORPHAN_PUNCTUATION_REGEX, PREFILL_WHITESPACE_SENTINEL } from "@/utils/discord/stream/constants";
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
  parseLeadingRenderModifier,
} from "@/utils/discord/renderModifierParser";
import {
  resolveCopiedRenderModifierTarget,
  resolveSpriteRenderModifierTarget,
} from "@/utils/discord/renderModifierResolver";
import { isUserImpersonationStreamContext } from "@/utils/discord/stream/uiUpdater";

type StreamSegmentProcessorDependencies = {
  delivery: StreamMessageDelivery;
  requestStop: (channelId: string, requesterId?: string) => boolean;
};

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
    if (state.pendingOrphanPunctuation) {
      log.info(`Stream Orphan: Prepending held "${state.pendingOrphanPunctuation}" to next segment`);
      workingSegment = `${state.pendingOrphanPunctuation}${segment}`;
      state.pendingOrphanPunctuation = undefined;
    }

    const renderModifierSourceNames = collectRenderModifierSourceNames(textConfig.botName, textConfig.botNameAliases);
    let deliveryOptions: StreamDeliveryOptions | undefined;
    const canUseRenderModifier = !state.isInsideCodeBlock && !isUserImpersonationStreamContext(context);
    const renderModifierMatch = canUseRenderModifier
      ? parseLeadingRenderModifier(workingSegment, renderModifierSourceNames)
      : null;
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
                state,
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
        state.activeRenderModifier = undefined;
      }
    } else if (canUseRenderModifier && state.activeRenderModifier) {
      deliveryOptions = {
        identityOverride: state.activeRenderModifier.identity,
        spriteRecord: state.activeRenderModifier.spriteRecord,
      };
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
   */
  private resolveSpriteGroupBreakIdentity(
    identity: ResolvedWebhookIdentity,
    decoratedUsername: string,
    spriteKey: string,
    state: StreamState,
  ): ResolvedWebhookIdentity {
    // 1. Flip parity only when switching away from a *previous* sprite. Skipping the
    //    very first sprite (no prior key) keeps it on the clean name.
    if (state.lastDeliveredSpriteKey !== undefined && state.lastDeliveredSpriteKey !== spriteKey) {
      state.spriteGroupParity = !state.spriteGroupParity;
    }
    state.lastDeliveredSpriteKey = spriteKey;

    // 2. The "false" half keeps the clean persona name; the "true" half uses the
    //    decorated "Persona (sprite)" name so it reads as a distinct Discord author.
    if (!state.spriteGroupParity) {
      return identity;
    }
    return { ...identity, username: decoratedUsername };
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
