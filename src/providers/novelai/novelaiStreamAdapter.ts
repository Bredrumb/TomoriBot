/**
 * NovelAI-specific streaming adapter
 *
 * This adapter implements the StreamProvider interface for NovelAI's API,
 * handling the unique requirements of NovelAI's text-based prompt format.
 *
 * Key responsibilities:
 * - Convert structured context to NovelAI's flat text prompt format
 * - Handle SSE streaming from NovelAI API
 * - Convert NovelAI chunks to normalized ProcessedChunk format
 * - Map NovelAI errors to normalized ProviderError type
 *
 * NovelAI Specifics:
 * - Uses flat text prompts with "{username}: {message}\n" format
 * - Uses `prefix` parameter to force bot name at start of generation
 * - Uses `stop_sequences` to prevent multi-speaker generation
 */

import type { ThoughtLogEntry } from "@/types/provider/interfaces";
import { ContextItemTag } from "@/types/misc/context";
import { log } from "@/utils/misc/logger";
import {
  formatProviderErrorCodeForDisplay,
  isProviderTimeoutMessage,
} from "@/utils/provider/providerErrorClassification";
import { localizer } from "@/utils/text/localizer";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";
import { findMarkdownCodeRanges } from "@/utils/text/processors/llmOutputProcessor";
import { BaseStreamAdapter } from "@/types/stream/interfaces";
import type {
  ProcessedChunk,
  ProviderError,
  RawStreamChunk,
  StreamConfig,
  StreamContext,
} from "@/types/stream/interfaces";
import {
  novelaiGenerateStream,
  getParametersForModel,
  isNovelAIApiKeyError,
  isNovelAICreditsError,
  isNovelAIRateLimitError,
  usesOpenAIEndpoint,
  type NovelAIGenerationRequest,
  type NovelAIStreamChunk,
  type NovelAIParameters,
} from "./novelaiService";
import { buildProviderStopStrings } from "@/providers/utils/stopStrings";
import { isParamDisabled } from "@/utils/provider/samplingControl";
import { buildAttgBlock, assembleNovelAIPrompt, assembleGlmChatPrompt } from "@/providers/novelai/promptRenderers";
import { NAI_KAYRA_CHARS_PER_TOKEN, NAI_KAYRA_CONTEXT_LIMIT } from "@/utils/cache/novelaiCapabilityCache";
import { getCachedContextTokens } from "@/utils/cache/novelaiSubscriptionCache";

/**
 * Whether to include the bot's persona name as a "{char}:" prefix in GLM 4.6 assistant turns.
 *
 * When ON (default): bot name is preserved in sample dialogue and conversation history turns,
 * mirroring how other providers (Google, OpenRouter) format their context. The generation prompt
 * also appends "{botName}:" after <think></think> as a true prefill, steering the model to respond
 * in the persona's voice from the very first token.
 *
 * When OFF: bot name is stripped from assistant turns: <|assistant|> is sufficient as the
 * structural signal. The original motivation for stripping was garbled name artifacts
 * (e.g., "Tomo", "Tomorleasing"), but keeping the prefix has shown better persona consistency.
 *
 * Only affects GLM 4.6; Kayra already appends the bot name as a prefill at prompt assembly.
 */
const NAI_GLM_CHAR_PREFIX_ENABLED = (process.env.NAI_GLM_CHAR_PREFIX_ENABLED ?? "true").toLowerCase() === "true";

/**
 * Characters-per-token ratio used to estimate GLM 4.6 input token count from prompt length.
 *
 * GLM 4.6 actual tokenization runs ~2.2-2.5 chars/token, far below the 4 chars/token
 * assumed by contextTruncator. This value is used by the dynamic max_length cap to
 * re-estimate token usage from the final assembled prompt (which includes formatting
 * overhead not present in the raw context items seen by the truncator).
 *
 * Lower values = more conservative, more clamping; higher values = less clamping.
 */
const NAI_GLM_CHARS_PER_TOKEN = 2.5;

/**
 * Hard context window ceiling (input + output tokens combined) for GLM 4.6.
 *
 * Matches the real NovelAI API limit. The dynamic max_length cap uses this to compute
 * how many output tokens remain after accounting for estimated input token usage.
 */
const NAI_GLM_CONTEXT_LIMIT = 12288;

/**
 * Budgeting warms the selected credential's allowance before streaming. A cold entry retains
 * the existing default, including direct adapter callers that do not run generic budgeting.
 */
export function resolveKayraContextLimit(apiKey: string): number {
  return getCachedContextTokens(apiKey) ?? NAI_KAYRA_CONTEXT_LIMIT;
}

/**
 * Extracts non-schema preset parameters from a raw preset parameters record.
 * Removes the four fields that are handled via split server config columns
 * (temperature, top_k, top_p, min_p) so they don't double-apply.
 * The remaining fields (order, tail_free_sampling, phrase_rep_pen, mirostat_*,
 * typical_p, top_a, repetition_penalty_*, etc.) are passed as preset overrides
 * to getParametersForModel() for NAI-specific sampling behaviour.
 *
 * @param params - Raw parameters record from NaiPresetRow.parameters
 * @returns Partial NovelAIParameters containing only non-schema fields
 */
function extractNonSchemaPresetParams(params: Record<string, unknown>): Partial<NovelAIParameters> {
  // These four keys are written to split server config tables and applied via the existing
  // override logic in getParametersForModel, so exclude them here to avoid conflicts.
  const schemaKeys = new Set(["temperature", "top_k", "top_p", "min_p"]);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!schemaKeys.has(key)) {
      result[key] = value;
    }
  }
  return result as Partial<NovelAIParameters>;
}

/**
 * NovelAI streaming adapter implementation
 *
 * NovelAI requires a flat text prompt with speaker labels:
 * [System instructions]
 *
 * Username1: message1
 * BotName: response1
 * Username2: message2
 * BotName:
 */
export class NovelaiStreamAdapter extends BaseStreamAdapter {
  private insideThinkBlock = false;
  private pendingThinkBlockThoughtText = "";

  /**
   * Speaker names extracted from DIALOGUE_HISTORY for no-colon turn detection.
   * Populated in startStream() and used by processVisibleText().
   * Contains only user/other-character names: never the bot's own name.
   */
  private knownSpeakers: Set<string> = new Set();
  private speakerStopPatternEnabled = false;

  /**
   * Whether the current stream is using GLM 4.6 (enables sentence-boundary buffering).
   * Set in startStream() based on model type.
   */
  private isGlmModel = false;

  /**
   * Sentence-boundary trailing buffer for GLM 4.6.
   *
   * NAI's ~150-token hard cap often cuts text mid-sentence. Instead of trying
   * to continue (which causes garbled artifacts), we hold back text after the
   * last sentence boundary and silently drop it when the stream ends.
   *
   * Only active for GLM 4.6; Kayra uses generate_until_sentence at the API level.
   */
  private sentenceTrailingBuffer = "";

  /**
   * Incomplete trailing sentence saved when the stream ends mid-sentence.
   *
   * Set in processChunk() when a trailing fragment is dropped (no sentence boundary).
   * Retrieved by NovelaiProvider after streamToDiscord() returns so it can attach the
   * fragment to the StreamResult and forward it as a prompt continuation on the next retry.
   *
   * Reset at the start of each startStream() call so stale values never leak across turns.
   */
  private pendingContinuationPrefill: string | undefined = undefined;

  constructor() {
    super({
      name: "novelai",
      version: "1.0",
      supportsFunctionCalling: false,
    });
  }

  /**
   * Returns the incomplete trailing sentence from the most recent stream, if any.
   *
   * NovelaiProvider calls this after the orchestrator finishes to surface the fragment
   * through StreamResult.naiContinuationPrefill for use as a prompt continuation.
   *
   * @returns The dropped trailing text, or undefined if the stream ended cleanly
   */
  getPendingContinuationPrefill(): string | undefined {
    return this.pendingContinuationPrefill;
  }

  /** Regex matching characters that indicate a natural sentence/thought boundary.
   * NOTE: Single quote (') is intentionally excluded because contractions like "How's",
   * "don't", "it's" are far more common than closing single quotes, causing
   * false positives that cut mid-word (e.g., "How'" instead of "How's it going?").
   */
  private static readonly SENTENCE_BOUNDARY_PATTERN = /[.!?*~)\]"\u300D\u2026\u2014]\s*$/;

  /**
   *
   * For GLM 4.6 (OpenAI endpoint):
   * - Uses the official GLM chat template with <|system|>, <|user|>, <|assistant|> tags
   * - Single-pass generation; no continuation loop (NAI's ~150-token cap is accepted)
   * - Incomplete trailing sentences are silently dropped via sentence-boundary buffering
   * - Uses regex speaker detection for turn boundaries (GLM doesn't emit <|user|> tokens)
   *
   * For Kayra (native endpoint):
   * - Uses flat text prompt with "Username: message" format
   * - Uses generate_until_sentence for clean endings
   * - Uses regex speaker detection for turn boundaries
   */
  async *startStream(config: StreamConfig, context: StreamContext): AsyncGenerator<RawStreamChunk, void, unknown> {
    log.info("NovelAIStreamAdapter: Initializing NovelAI streaming");

    this.generationBuffer = "";
    this.sentenceTrailingBuffer = "";
    this.pendingContinuationPrefill = undefined;
    this.kayraHoldBuffer = "";
    this.kayraSpeakerBoundaryStopPending = false;
    this.pendingThinkBlockThoughtText = "";
    this.insideThinkBlock = false;
    if (!config.model) {
      throw new Error("Model must be specified in config. Use NovelAIProvider.getDefaultModel() if needed.");
    }

    const isGlm = usesOpenAIEndpoint(config.model);
    this.isGlmModel = isGlm;

    let prompt: string;
    if (isGlm) {
      // GLM 4.6: Official chat template with role tags and forced thinking
      prompt = assembleGlmChatPrompt(
        context.contextItems,
        context.tomoriState.persona_nickname,
        NAI_GLM_CHAR_PREFIX_ENABLED,
        {
          thinkingLevel: context.tomoriState.config.thinking_level,
          forceReason: config.forceReason,
        },
      );
    } else {
      // Kayra: Flat text prompt with NAI prompt-convention formatting
      // Build ATTG block from persona metadata (null if not configured)
      const attgBlock = buildAttgBlock(context.tomoriState, config.model);
      const basePrompt = assembleNovelAIPrompt(context.contextItems, context.tomoriState.persona_nickname, {
        attgBlock,
      });
      // Append bot name to signal it should generate the bot's response, unless
      // /respond already injected a final assistant prefill turn as the tail.
      // In that case, adding another "{botName}:" creates an extra empty turn and
      // breaks true continuation for Kayra/Erato.
      const outputPrefillTail = context.outputPrefill?.trim() ?? "";
      const hasTailPrefill = outputPrefillTail.length > 0 && basePrompt.trimEnd().endsWith(outputPrefillTail);
      prompt = hasTailPrefill ? basePrompt : `${basePrompt}\n${context.tomoriState.persona_nickname}: `;
      if (hasTailPrefill) {
        log.info("NovelAI Kayra: Detected assistant prefill at prompt tail; skipping trailing bot-name cue");
      }
    }

    // For GLM 4.6: if a previous stream was cut off mid-sentence, append the trailing
    // fragment to the prompt so the model continues from that exact point rather than
    // generating a brand-new response. The prompt currently ends with "BotName:" (when
    // NAI_GLM_CHAR_PREFIX_ENABLED is true) or "/nothink", so we append with a single
    // space separator to stay on the same line.
    if (isGlm && context.naiContinuationPrefill?.trim()) {
      const prefill = context.naiContinuationPrefill.trimStart();
      if (NAI_GLM_CHAR_PREFIX_ENABLED) {
        prompt = `${prompt} ${prefill}`;
      } else {
        prompt = `${prompt}\n${prefill}`;
      }
      log.info(
        `NovelAI GLM: Appended continuation prefill to prompt ` +
          `(${prefill.length} chars): "${prefill.substring(0, 80)}"`,
      );
    }

    log.info(`Assembled NovelAI prompt (${isGlm ? "GLM" : "Kayra"}). Length: ${prompt.length} characters`);

    log.section("NovelAI Full Prompt");
    if (!context.holdResponseText) log.info(prompt);

    // Neutral values (topK=0, topP=1.0, minP=0.0) preserve the model preset defaults.
    // Non-schema NAI preset fields (order, TFS, phrase_rep_pen, etc.) are extracted
    // from the active preset and merged before DB schema overrides are applied.
    const { llm_top_k, llm_top_p, llm_min_p, llm_disabled_params } = context.tomoriState.config;
    const disabledParams = config.disabledParams ?? llm_disabled_params ?? [];
    const temperature = isParamDisabled(disabledParams, "temperature") ? undefined : config.temperature;
    const topK = isParamDisabled(disabledParams, "topK") ? undefined : llm_top_k;
    const topP = isParamDisabled(disabledParams, "topP") ? undefined : llm_top_p;
    const minP = isParamDisabled(disabledParams, "minP") ? undefined : llm_min_p;
    const naiPresetOverrides = extractNonSchemaPresetParams(context.tomoriState.nai_preset?.parameters ?? {});
    const parameters = getParametersForModel(config.model, temperature, topK, topP, minP, naiPresetOverrides);

    // Dynamic max_length safety cap for GLM 4.6.
    //
    // contextTruncator runs earlier on raw context items using a 4 chars/token estimate.
    // GLM 4.6 actually tokenizes at ~2.2-2.5 chars/token, so the assembled prompt (which
    // also includes GLM role tags and /nothink directives not present
    // in raw context items) can still exceed the API's 12 288-token ceiling.
    //
    // Here we re-estimate input tokens from the final prompt length and shrink
    // max_length if needed so that input + output ≤ NAI_GLM_CONTEXT_LIMIT × 0.95.
    // A floor of 50 ensures we always request at least a minimal response.
    if (isGlm) {
      const estimatedInputTokens = Math.ceil(prompt.length / NAI_GLM_CHARS_PER_TOKEN);
      const maxAllowedOutput = Math.floor((NAI_GLM_CONTEXT_LIMIT - estimatedInputTokens) * 0.95);
      const clampedMaxLength = Math.max(50, maxAllowedOutput);

      const currentMaxLength = parameters.max_length ?? 0;
      if (clampedMaxLength < currentMaxLength) {
        log.warn(
          `NovelAI GLM: Clamping max_length ${currentMaxLength} → ${clampedMaxLength} ` +
            `(prompt ${prompt.length} chars ≈ ${estimatedInputTokens} tokens, ` +
            `context limit: ${NAI_GLM_CONTEXT_LIMIT})`,
        );
        parameters.max_length = clampedMaxLength;
      }
    } else {
      // Dynamic max_length safety cap for Kayra/Erato. contextTruncator budgets at 4 chars/token,
      // but Kayra tokenizes at roughly 3.0-3.5, so the assembled prompt can still overshoot the
      // tier ceiling. Re-estimating here clamps max_length when the output would overflow, and
      // warns when the input alone already does, which output clamping cannot fix.
      const kayraContextLimit = resolveKayraContextLimit(config.apiKey);
      const estimatedInputTokens = Math.ceil(prompt.length / NAI_KAYRA_CHARS_PER_TOKEN);
      const maxAllowedOutput = kayraContextLimit - estimatedInputTokens;
      const currentMaxLength = parameters.max_length ?? 0;
      if (maxAllowedOutput <= 0) {
        log.warn(
          `NovelAI Kayra: Prompt likely exceeds context limit — ` +
            `prompt ${prompt.length} chars ≈ ${estimatedInputTokens} tokens, ` +
            `limit: ${kayraContextLimit}. Shorten the prompt.`,
        );
      } else if (maxAllowedOutput < currentMaxLength) {
        const clampedMaxLength = Math.max(1, maxAllowedOutput);
        log.warn(
          `NovelAI Kayra: Clamping max_length ${currentMaxLength} → ${clampedMaxLength} ` +
            `(prompt ${prompt.length} chars ≈ ${estimatedInputTokens} tokens, ` +
            `context limit: ${kayraContextLimit})`,
        );
        parameters.max_length = clampedMaxLength;
      }
    }

    // Collect unique user speaker names from DIALOGUE_HISTORY items, which is the only
    // tag guaranteeing the "AuthorName: message" prefix. These feed this.knownSpeakers
    // so processVisibleText() can detect turn boundaries even when the model omits the
    // colon (story format). Speaker stopping is text-based only: logit_bias_exp looks
    // like the natural tool because it takes sequences, but its sequence entries are
    // Kayra token IDs rather than UTF-8 bytes, so passing text there produces garbage
    // special tokens at generation start (for example <|reserved5|>, <|maskend|>).
    this.speakerStopPatternEnabled = context.tomoriState.config.llm_stop_speaker_pattern_enabled ?? false;
    if (!isGlm && this.speakerStopPatternEnabled) {
      const speakerSet = new Set<string>();
      for (const item of context.contextItems) {
        if (item.metadataTag !== ContextItemTag.DIALOGUE_HISTORY) continue;
        if (item.role !== "user") continue;
        const text = item.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as { type: "text"; text: string }).text)
          .join("\n");
        const speakerLinePattern = /^(?!\[System:)([^:\n]+):\s+/gm;
        for (const match of text.matchAll(speakerLinePattern)) {
          const speaker = match[1].trim();
          if (speaker) speakerSet.add(speaker);
        }
      }
      // Exclude the bot's own name because it may legitimately appear on new lines
      // as it continues its own turn across multiple sentences.
      speakerSet.delete(context.tomoriState.persona_nickname);
      this.knownSpeakers = speakerSet;
    } else {
      this.knownSpeakers = new Set();
    }

    const openAIStopStrings = buildProviderStopStrings({
      providerName: "novelai",
      model: config.model,
      personaName: context.tomoriState.persona_nickname,
      configuredStops: context.tomoriState.config.llm_stop_strings,
      includePersonaSpeakerStop: this.speakerStopPatternEnabled,
    });
    const request: NovelAIGenerationRequest = {
      input: prompt,
      model: config.model,
      parameters,
      openAIStopStrings,
    };

    this.logSanitizedRequest(request, prompt.length);

    try {
      // Single-pass streaming for both models:
      // - Kayra: generate_until_sentence handles clean endings
      // - GLM 4.6: sentence-boundary buffering drops incomplete trailing fragments
      yield* this.streamSinglePass(request, config);
    } catch (error) {
      yield this.createProviderErrorChunk(error, context);
    }
  }

  /** For Kayra; there is no continuation loop. */
  private async *streamSinglePass(
    request: NovelAIGenerationRequest,
    config: StreamConfig,
  ): AsyncGenerator<RawStreamChunk, void, unknown> {
    const stream = novelaiGenerateStream(request, {
      apiKey: config.apiKey,
      timeout: config.inactivityTimeoutMs,
    });

    for await (const chunk of stream) {
      yield {
        data: chunk,
        provider: "novelai",
        metadata: {
          timestamp: Date.now(),
          model: config.model,
        },
      };
    }
  }

  /**
   * Accumulated buffer for detecting speaker transitions
   * NovelAI sometimes continues generating and starts a new speaker's turn
   * We need to detect and strip this out
   */
  private generationBuffer = "";
  /** Buffer holding back text from the last "\n" onward, pending speaker-prefix resolution for Kayra. */
  private kayraHoldBuffer = "";
  /** When true, Kayra has already hit a held speaker boundary and should return done on next token. */
  private kayraSpeakerBoundaryStopPending = false;

  /**
   * Process a raw NovelAI chunk into normalized format
   */
  processChunk(chunk: RawStreamChunk): ProcessedChunk {
    const novelaiChunk = chunk.data as NovelAIStreamChunk & {
      error?: ProviderError;
    };
    const withThoughts = (result: ProcessedChunk): ProcessedChunk => this.attachPendingThoughts(result);

    if (novelaiChunk.error) {
      if (typeof novelaiChunk.error === "object" && "type" in novelaiChunk.error) {
        return withThoughts({
          type: "error",
          error: novelaiChunk.error as ProviderError,
        });
      }

      return withThoughts({
        type: "error",
        error: this.handleProviderError(novelaiChunk.error),
      });
    }

    if (novelaiChunk.final) {
      // For GLM 4.6: check if the sentence trailing buffer has a complete thought.
      // If it ends at a sentence boundary, flush it before signaling done.
      // If not (NAI cut off mid-sentence), silently drop it for a clean ending.
      let finalFlush = "";
      if (this.isGlmModel && this.sentenceTrailingBuffer.trim()) {
        if (NovelaiStreamAdapter.SENTENCE_BOUNDARY_PATTERN.test(this.sentenceTrailingBuffer)) {
          finalFlush = this.sentenceTrailingBuffer;
        } else {
          // Incomplete sentence, so save it as a continuation prefill for the retry.
          // NovelaiProvider reads this via getPendingContinuationPrefill() after the
          // stream ends and attaches it to StreamResult.naiContinuationPrefill so
          // tomoriChat can append it to the next prompt instead of starting over.
          this.pendingContinuationPrefill = this.sentenceTrailingBuffer;
          log.info(
            `NovelAI GLM: Trailing fragment saved for continuation ` +
              `(${this.sentenceTrailingBuffer.length} chars): ` +
              `"${this.sentenceTrailingBuffer.substring(0, 80)}..."`,
          );
        }
      }

      // For Kayra: flush held-back speaker-prefix buffer if stream ended without a match.
      // A pending fragment that never triggered a speaker stop is safe to emit.
      let kayraFinalFlush = "";
      if (!this.isGlmModel && this.kayraHoldBuffer.trim()) {
        kayraFinalFlush = this.kayraHoldBuffer;
      }

      this.generationBuffer = "";
      this.sentenceTrailingBuffer = "";
      this.insideThinkBlock = false;
      this.kayraHoldBuffer = "";
      this.kayraSpeakerBoundaryStopPending = false;

      // If we have a final flush (Kayra hold-buffer or GLM trailing buffer), emit as text.
      // The stream's own termination signals "done" to the orchestrator.
      const flushContent = kayraFinalFlush || finalFlush;
      if (flushContent) {
        return withThoughts({
          type: "text",
          content: flushContent,
        });
      }

      return withThoughts({
        type: "done",
      });
    }

    if (novelaiChunk.token) {
      // GLM 4.6: Strip any <think>...</think> blocks before visible text processing.
      // With /nothink removed, the model may emit thinking blocks in its response.
      if (this.isGlmModel) {
        const stripped = this.stripThinkBlocks(novelaiChunk.token);
        if (!stripped) {
          return withThoughts({ type: "text", content: "" });
        }
        return withThoughts(this.processVisibleText(stripped));
      }

      return withThoughts(this.processVisibleText(novelaiChunk.token));
    }

    return withThoughts({
      type: "text",
      content: "",
    });
  }

  /**
   * Process visible text with speaker detection and sentence-boundary buffering.
   *
   * For GLM 4.6: Text is routed through a sentence-boundary-aware trailing buffer.
   * Only text up to the last confirmed sentence boundary is emitted to the orchestrator.
   * The trailing fragment (potentially incomplete sentence) is held back and silently
   * dropped if the stream ends mid-sentence (NAI's ~150-token cap).
   *
   * For Kayra: Text is passed through directly (generate_until_sentence handles endings).
   *
   * Both models use regex-based speaker transition detection to stop generation
   * when the model starts another character's turn.
   */
  private processVisibleText(text: string): ProcessedChunk {
    if (!text) {
      return {
        type: "text",
        content: "",
      };
    }

    // Kayra: once we detect a held speaker boundary, stop on subsequent tokens.
    if (!this.isGlmModel && this.kayraSpeakerBoundaryStopPending) {
      this.generationBuffer = "";
      this.sentenceTrailingBuffer = "";
      this.kayraHoldBuffer = "";
      return { type: "done" };
    }

    // GLM 4.6: Detect stray </think> tags in visible text.
    // After the initial <think></think> block is consumed by stripThinkBlocks(),
    // any subsequent </think> in the visible text phase indicates model debris:
    // the model hallucinates garbage after the tag (e.g., "oggers:</think>\nI'll kill you").
    // Stop the stream immediately and only emit clean text before the tag.
    if (this.isGlmModel) {
      const thinkCloseIdx = text.indexOf("</think>");
      if (thinkCloseIdx !== -1) {
        const cleanBefore = text.slice(0, thinkCloseIdx).trim();
        log.warn(
          `NovelAI GLM: Stray </think> detected in visible text — stopping stream. ` +
            `Clean text before tag: "${cleanBefore.substring(0, 80)}"`,
        );
        // Clear buffers, so stream will end naturally after this return
        this.generationBuffer = "";
        this.sentenceTrailingBuffer = "";
        if (cleanBefore) {
          // Emit clean text directly (skip speaker detection since we're stopping).
          return { type: "text", content: cleanBefore };
        }
        return { type: "done" };
      }
    }

    this.generationBuffer += text;

    if (!this.speakerStopPatternEnabled) {
      if (!this.isGlmModel) {
        this.generationBuffer = "";
        return { type: "text", content: text };
      }
      this.generationBuffer = "";
    } else {
      // Detect speaker transitions: the model has started another character's turn. Kayra has no
      // API stop sequences, and GLM 4.6 does not emit <|user|> in completions mode, so both are
      // caught from the text. Three conditions, checked in order: a dinkus scene break, only
      // matched after a newline so a censored word at the response start survives; a generic
      // `\nName:` label; and a `\nName ` turn, restricted to known speakers so mid-sentence proper
      // nouns do not trip it.
      const markdownCodeRanges = findMarkdownCodeRanges(this.generationBuffer);
      let speakerMatch =
        this.findFirstMarkdownSafeMatch(
          this.generationBuffer,
          /\n\*\*\*/g,
          markdownCodeRanges,
          (match) => match.index + 1,
        ) ??
        this.findFirstMarkdownSafeMatch(this.generationBuffer, /\n+([^\n:]+):\s*/g, markdownCodeRanges, (match) => {
          const rawLabel = match[1] ?? "";
          return match.index + match[0].indexOf(rawLabel);
        });

      if (!speakerMatch && this.knownSpeakers.size > 0) {
        const escaped = [...this.knownSpeakers].map(escapeRegExp).join("|");
        speakerMatch = this.findFirstMarkdownSafeMatch(
          this.generationBuffer,
          new RegExp(`\\n+(${escaped})\\s`, "g"),
          markdownCodeRanges,
          (match) => {
            const rawLabel = match[1] ?? "";
            return match.index + match[0].indexOf(rawLabel);
          },
        );
      }

      if (speakerMatch) {
        this.generationBuffer = "";
        this.sentenceTrailingBuffer = "";
        this.kayraHoldBuffer = "";
        // Stream orchestrator continues reading until provider final;
        // latch stop so subsequent Kayra/Erato tokens are ignored.
        this.kayraSpeakerBoundaryStopPending = !this.isGlmModel;
        return {
          type: "done",
        };
      }

      // Kayra/Erato: also treat sentence-colon boundaries as turn transitions.
      // Example: "... It is not healthy.: Please, don't say that..."
      // We stop on either:
      // - A complete boundary with following speaker text in-buffer.
      // - A trailing boundary ending in ":" (next token would start the other turn).
      if (!this.isGlmModel) {
        const sentenceColonBoundary = /[.!?…]["')\]]?\s*:\s+(?=[A-Z*"])/;
        const trailingSentenceColonBoundary = /[.!?…]["')\]]?\s*:\s*$/;
        if (
          sentenceColonBoundary.test(this.generationBuffer) ||
          trailingSentenceColonBoundary.test(this.generationBuffer)
        ) {
          this.generationBuffer = "";
          this.sentenceTrailingBuffer = "";
          this.kayraHoldBuffer = "";
          this.kayraSpeakerBoundaryStopPending = true;
          return { type: "done" };
        }
      }
    }

    // For Kayra: hold-back buffering to prevent partial speaker-prefix leakage.
    // Kayra streams one token at a time; Name" arrives before the space that
    // would complete a knownSpeakers match. Without buffering, Name" is emitted
    // before the regex fires on the following token.
    // Strategy: always hold back from the last in the combined text, releasing
    // it once the next token confirms it is NOT a speaker prefix (or stops if it is).
    if (!this.isGlmModel) {
      const combined = this.kayraHoldBuffer + text;
      this.kayraHoldBuffer = "";
      const lastNewlineIdx = combined.lastIndexOf("\n");
      if (lastNewlineIdx !== -1) {
        const safeToEmit = combined.slice(0, lastNewlineIdx);
        const trailingLine = combined.slice(lastNewlineIdx + 1);
        const trailingLineStartIndex = this.generationBuffer.length - trailingLine.length;
        const markdownCodeRanges = findMarkdownCodeRanges(this.generationBuffer);

        // Line-aware speaker boundary stop:
        // keep one trailing line held; if it starts with another speaker,
        // emit everything before the newline and stop before flushing that line.
        if (this.shouldStopAtKayraHeldLine(this.generationBuffer, trailingLineStartIndex, markdownCodeRanges)) {
          this.generationBuffer = "";
          this.sentenceTrailingBuffer = "";
          this.kayraHoldBuffer = "";
          if (safeToEmit.length > 0) {
            this.kayraSpeakerBoundaryStopPending = true;
            return { type: "text", content: safeToEmit };
          }
          this.kayraSpeakerBoundaryStopPending = true;
          return { type: "done" };
        }

        this.kayraHoldBuffer = combined.slice(lastNewlineIdx);
        return { type: "text", content: safeToEmit };
      }
      return { type: "text", content: combined };
    }

    // GLM 4.6: Sentence-boundary buffering
    // Accumulate text in the trailing buffer, then emit everything up to the
    // last sentence boundary. The remainder stays buffered in case NAI cuts
    // the output mid-sentence, so it gets silently dropped in processChunk on "final".
    this.sentenceTrailingBuffer += text;

    const lastBoundaryIndex = this.findLastSentenceBoundary(this.sentenceTrailingBuffer);

    if (lastBoundaryIndex === -1) {
      return {
        type: "text",
        content: "",
      };
    }

    const emitText = this.sentenceTrailingBuffer.slice(0, lastBoundaryIndex + 1);
    this.sentenceTrailingBuffer = this.sentenceTrailingBuffer.slice(lastBoundaryIndex + 1);

    return {
      type: "text",
      content: emitText,
    };
  }

  private findFirstMarkdownSafeMatch(
    text: string,
    pattern: RegExp,
    markdownCodeRanges: ReturnType<typeof findMarkdownCodeRanges>,
    getProtectedIndex: (match: RegExpExecArray) => number,
  ): RegExpExecArray | null {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = null;

    while (true) {
      match = pattern.exec(text);
      if (match === null) {
        return null;
      }

      if (!this.isIndexInsideMarkdownCodeRanges(getProtectedIndex(match), markdownCodeRanges)) {
        return match;
      }

      if (match[0].length === 0) {
        pattern.lastIndex++;
      }
    }
  }

  private isIndexInsideMarkdownCodeRanges(
    index: number,
    markdownCodeRanges: ReturnType<typeof findMarkdownCodeRanges>,
  ): boolean {
    return markdownCodeRanges.some((range) => index >= range.start && index < range.end);
  }

  private shouldStopAtKayraHeldLine(
    text: string,
    lineStartIndex: number,
    markdownCodeRanges: ReturnType<typeof findMarkdownCodeRanges>,
  ): boolean {
    const line = text.slice(lineStartIndex);
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("[System:")) {
      return false;
    }

    const trimmedStartIndex = lineStartIndex + (line.length - trimmed.length);
    if (this.isIndexInsideMarkdownCodeRanges(trimmedStartIndex, markdownCodeRanges)) {
      return false;
    }

    if (/^[^\n:]{1,80}:\s*/.test(trimmed)) {
      return true;
    }

    if (trimmed.startsWith("***")) {
      return true;
    }

    // Known no-colon speaker line (e.g., "Misuzu Sorry...").
    if (this.knownSpeakers.size > 0) {
      const escaped = [...this.knownSpeakers].map(escapeRegExp).join("|");
      return new RegExp(`^(?:${escaped})(?:\\s|[.!?,:;\\-]|$)`).test(trimmed);
    }

    return false;
  }

  /**
   * Find the index of the last sentence boundary character in the given text.
   *
   * Sentence boundaries are characters that typically end a complete thought:
   * punctuation (. ! ? …), closing quotes/brackets (" ) ] 」), markdown
   * formatting (* ~), em dash (—), and newlines.
   * NOTE: Single quote (') excluded because contractions (How's, don't) cause false cuts.
   *
   */
  private findLastSentenceBoundary(text: string): number {
    for (let i = text.length - 1; i >= 0; i--) {
      const char = text[i];
      if (
        char === "." ||
        char === "!" ||
        char === "?" ||
        char === "*" ||
        char === "~" ||
        char === ")" ||
        char === "]" ||
        char === '"' ||
        char === "\u300D" || // 」
        char === "\u2026" || // …
        char === "\u2014" || // —
        char === "\n"
      ) {
        return i;
      }
    }

    return -1;
  }

  private stripThinkBlocks(text: string): string {
    if (!text) return "";

    let output = "";
    let cursor = 0;

    while (cursor < text.length) {
      if (!this.insideThinkBlock) {
        const startIdx = text.indexOf("<think>", cursor);
        const endIdx = text.indexOf("</think>", cursor);

        if (startIdx === -1 && endIdx === -1) {
          output += text.slice(cursor);
          break;
        }

        if (endIdx !== -1 && (startIdx === -1 || endIdx < startIdx)) {
          output += text.slice(cursor, endIdx);
          cursor = endIdx + "</think>".length;
          continue;
        }

        if (startIdx !== -1) {
          output += text.slice(cursor, startIdx);
          this.insideThinkBlock = true;
          cursor = startIdx + "<think>".length;
        }
      } else {
        const endIdx = text.indexOf("</think>", cursor);
        if (endIdx === -1) {
          this.captureThinkBlockThoughtText(text.slice(cursor));
          cursor = text.length;
          break;
        }

        this.captureThinkBlockThoughtText(text.slice(cursor, endIdx));
        this.insideThinkBlock = false;
        cursor = endIdx + "</think>".length;
      }
    }

    return output;
  }

  private captureThinkBlockThoughtText(text: string): void {
    if (!text) {
      return;
    }

    this.pendingThinkBlockThoughtText += text;
  }

  private consumePendingThinkBlockThoughts(): ThoughtLogEntry[] {
    if (!this.pendingThinkBlockThoughtText) {
      return [];
    }

    const content = this.pendingThinkBlockThoughtText;
    this.pendingThinkBlockThoughtText = "";
    return [
      {
        kind: "raw",
        content,
      },
    ];
  }

  private attachPendingThoughts(chunk: ProcessedChunk): ProcessedChunk {
    const pendingThoughts = this.consumePendingThinkBlockThoughts();
    const chunkThoughts = chunk.thoughts ?? [];
    const thoughts =
      chunkThoughts.length > 0 || pendingThoughts.length > 0 ? [...chunkThoughts, ...pendingThoughts] : undefined;

    if (!thoughts) {
      return chunk;
    }

    return {
      ...chunk,
      thoughts,
    };
  }

  protected override onProviderError(error: unknown, providerError: ProviderError, context?: StreamContext): void {
    super.onProviderError(error, providerError, context);
    log.warn(
      `NovelAI provider error (${providerError.code ?? "unknown"}, ${providerError.type}, retryable: ${providerError.retryable}): ${providerError.message.slice(0, 500)}`,
      undefined,
      { serverId: context?.tomoriState?.server_id ?? null },
    );
  }

  /**
   * Handle NovelAI-specific errors
   */
  handleProviderError(error: unknown): ProviderError {
    const errorMessage = error instanceof Error ? error.message : String(error);

    let statusCode: number | undefined;

    // First, check if error has statusCode or status property
    if (error && typeof error === "object") {
      if ("statusCode" in error && typeof error.statusCode === "number") {
        statusCode = error.statusCode;
      } else if ("status" in error && typeof error.status === "number") {
        statusCode = error.status;
      }
    }

    // Fallback: try to extract from error message
    if (!statusCode) {
      // (?!\d) stops a longer number from yielding its first three digits: "(32826 tokens)" is not a 328.
      const statusMatch = errorMessage.match(/(?:\bstatus(?:\s+code)?\s*[:=]?\s*|\bhttp\s+|\()(\d{3})(?!\d)/i);
      if (statusMatch) {
        statusCode = Number.parseInt(statusMatch[1], 10);
      }
    }

    let errorType: ProviderError["type"];
    let retryable: boolean;

    if (statusCode === 400) {
      errorType = "api_error";
      retryable = false;
    } else if (statusCode === 401 || isNovelAIApiKeyError(errorMessage, statusCode)) {
      errorType = "api_error";
      retryable = false;
    } else if (statusCode === 402 || isNovelAICreditsError(errorMessage, statusCode)) {
      errorType = "api_error";
      retryable = false;
    } else if (statusCode === 429 || isNovelAIRateLimitError(errorMessage, statusCode)) {
      errorType = "rate_limit";
      retryable = true;
    } else if (statusCode === 408) {
      errorType = "timeout";
      retryable = true;
    } else if (statusCode === 500 || statusCode === 502) {
      errorType = "api_error";
      retryable = true;
    } else if (statusCode === 503) {
      errorType = "provider_overloaded";
      retryable = true;
    } else if (statusCode === 504 || isProviderTimeoutMessage(errorMessage)) {
      errorType = "timeout";
      retryable = true;
    } else {
      errorType = "api_error";
      retryable = false;
    }

    const formattedMessage = errorMessage.startsWith("NovelAI API error")
      ? errorMessage
      : `NovelAI API error${statusCode ? ` (${statusCode})` : ""}: ${errorMessage}`;

    return {
      type: errorType,
      message: formattedMessage,
      code: statusCode?.toString() || "unknown",
      retryable,
      originalError: error,
    };
  }

  createErrorDescription(error: ProviderError, locale: string): string | null {
    const errorCode = error.code;
    let messageKey: string;

    const errorMessage = error.message.toLowerCase();
    if (errorCode === "400" && (errorMessage.includes("recaptcha") || errorMessage.includes("trial generation"))) {
      messageKey = "genai.novelai.400_trial_message";
    } else {
      switch (error.type) {
        case "rate_limit":
          messageKey = "genai.novelai.429_default_message";
          break;
        case "timeout":
          messageKey = "genai.novelai.504_default_message";
          break;
        case "provider_overloaded":
          messageKey = "genai.novelai.503_default_message";
          break;
        case "api_error":
          if (errorCode === "400") {
            messageKey = "genai.novelai.400_default_message";
          } else if (errorCode === "401") {
            messageKey = "genai.novelai.401_default_message";
          } else if (errorCode === "402") {
            messageKey = "genai.novelai.402_default_message";
          } else {
            messageKey = "genai.novelai.unknown_default_message";
          }
          break;
        default:
          messageKey = "genai.novelai.unknown_default_message";
          break;
      }
    }

    // Upstream text stays in the operator log (see StreamErrorUi); the message only picked the key.
    return `Error Code ${formatProviderErrorCodeForDisplay(errorCode)}: ${localizer(locale, messageKey)}`;
  }

  private logSanitizedRequest(request: NovelAIGenerationRequest, promptLength: number): void {
    log.section("NovelAIStreamAdapter: Request Details");

    log.info(`Model: ${request.model}`);
    log.info(`Prompt Length: ${promptLength} characters`);
    log.info(`Parameters: temperature=${request.parameters.temperature}, max_length=${request.parameters.max_length}`);
  }
}
