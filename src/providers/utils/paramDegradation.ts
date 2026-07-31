/**
 * Pure request-degradation helpers shared by streaming provider adapters.
 *
 * Adapters use the same attempts at two failure points: an unsuccessful fetch
 * and a provider error event received before the stream is committed. A stream
 * is committed only after its first meaningful chunk is yielded; adapters must
 * never transparently restart after that point because doing so could duplicate
 * text, reasoning, tool calls, or usage observed by the consumer.
 */

/** Preferred order for probing request parameters that a backend may reject. */
const PARAM_DROP_PRIORITY = [
  "top_p",
  "top_k",
  "min_p",
  "frequency_penalty",
  "presence_penalty",
  "repetition_penalty",
  "logit_bias",
  "temperature",
  "max_tokens",
  "stop",
] as const;

/** Maximum number of message-derived attempts that an adapter may enqueue per request. */
export const MAX_TARGETED_DEGRADATION_ATTEMPTS = 3;

const REJECTABLE_PARAM_TOKENS = [...PARAM_DROP_PRIORITY, "stream_options"] as const;

/** A request body paired with the label adapters use in recovery logs. */
export interface DegradationAttempt {
  label: string;
  body: Record<string, unknown>;
}

/** The built-in reason that made an HTTP or SSE error eligible for degradation. */
export type DegradableErrorKind =
  | "generic_400"
  | "parameter_rejection_400"
  | "no_endpoints_404"
  | "backend_incompatible_502"
  | "provider_specific";

/** Input supplied to built-in and provider-specific degradation classifiers. */
export interface DegradableErrorInput {
  statusCode: number | null;
  message: string;
}

/** Provider hook for recognizing additional errors without forking the shared logic. */
type ExtraDegradationClassifier = (error: DegradableErrorInput) => boolean;

export interface ClassifyDegradableErrorOptions extends DegradableErrorInput {
  extraClassifiers?: readonly ExtraDegradationClassifier[];
  /**
   * Treat any 502 as a parameter-incompatibility signal. Only router-style
   * providers (OpenRouter) should enable this: their 502s often mean "the
   * selected backend rejected the request", whereas a direct provider's 502
   * is almost always a genuine outage that degradation cannot fix.
   */
  degradeOn502?: boolean;
}

export interface BuildDegradationAttemptsOptions {
  mandatoryKeys: ReadonlySet<string>;
  /** Adapter-owned message transformer because multimodal message shapes differ. */
  stripImages?: (messages: unknown) => unknown;
}

function cloneWithoutKeys(input: Record<string, unknown>, keysToRemove: readonly string[]): Record<string, unknown> {
  const cloned = { ...input };
  for (const key of keysToRemove) {
    delete cloned[key];
  }
  return cloned;
}

function isLikelyGenericErrorMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.length === 0 || normalized === "error" || normalized === "bad request" || normalized === "request failed"
  );
}

function isParameterRejectionError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("invalid api parameter") ||
    normalized.includes("unsupported parameter") ||
    normalized.includes("unknown parameter") ||
    normalized.includes("parameter not supported") ||
    normalized.includes("parameters are not yet supported")
  );
}

/**
 * Extract known droppable parameter names from an upstream error message.
 * Only parameters present on the failing request are returned.
 */
export function extractRejectedParams(errorMessage: string, requestBody: Record<string, unknown>): string[] {
  return REJECTABLE_PARAM_TOKENS.filter((param) => {
    if (!(param in requestBody)) return false;
    return new RegExp(`\\b${param}\\b`, "i").test(errorMessage);
  });
}

/** Classify whether an HTTP response or SSE error can be retried with fewer parameters. */
export function classifyDegradableError({
  statusCode,
  message,
  extraClassifiers = [],
  degradeOn502 = false,
}: ClassifyDegradableErrorOptions): DegradableErrorKind | null {
  if (statusCode === 400 && isLikelyGenericErrorMessage(message)) {
    return "generic_400";
  }
  if (statusCode === 400 && isParameterRejectionError(message)) {
    return "parameter_rejection_400";
  }
  if (statusCode === 404 && message.toLowerCase().includes("no endpoints found")) {
    return "no_endpoints_404";
  }
  if (statusCode === 502 && degradeOn502) {
    return "backend_incompatible_502";
  }
  if (extraClassifiers.some((classifier) => classifier({ statusCode, message }))) {
    return "provider_specific";
  }
  return null;
}

/**
 * Build the bounded static degradation ladder for a request body.
 * Duplicate serialized bodies are removed while preserving attempt order.
 */
export function buildDegradationAttempts(
  baseBody: Record<string, unknown>,
  { mandatoryKeys, stripImages }: BuildDegradationAttemptsOptions,
): DegradationAttempt[] {
  const attempts: DegradationAttempt[] = [];
  const seenSerializedBodies = new Set<string>();
  const addAttempt = (label: string, body: Record<string, unknown>) => {
    const serialized = JSON.stringify(body);
    if (seenSerializedBodies.has(serialized)) return;
    seenSerializedBodies.add(serialized);
    attempts.push({ label, body });
  };

  addAttempt("default", { ...baseBody });

  const probeBaseline = "stream_options" in baseBody ? cloneWithoutKeys(baseBody, ["stream_options"]) : { ...baseBody };
  addAttempt("no_stream_options", probeBaseline);

  const probeCandidateKeys = Object.keys(probeBaseline)
    .filter((key) => !mandatoryKeys.has(key) && key !== "tools")
    .sort((a, b) => {
      const aIdx = PARAM_DROP_PRIORITY.indexOf(a as (typeof PARAM_DROP_PRIORITY)[number]);
      const bIdx = PARAM_DROP_PRIORITY.indexOf(b as (typeof PARAM_DROP_PRIORITY)[number]);
      if (aIdx === -1 && bIdx === -1) return 0;
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });

  for (const key of probeCandidateKeys) {
    addAttempt(`probe_drop_${key}`, cloneWithoutKeys(probeBaseline, [key]));
  }

  let strippedMessages = probeBaseline.messages;
  if (stripImages && "messages" in probeBaseline) {
    strippedMessages = stripImages(probeBaseline.messages);
    addAttempt("strip_images", { ...probeBaseline, messages: strippedMessages });
  }

  if ("tools" in probeBaseline) {
    addAttempt("probe_drop_tools", cloneWithoutKeys(probeBaseline, ["tools"]));
  }

  const minimalBody: Record<string, unknown> = {};
  for (const key of mandatoryKeys) {
    if (key in probeBaseline) {
      minimalBody[key] = key === "messages" ? strippedMessages : probeBaseline[key];
    }
  }
  addAttempt("minimal_payload", minimalBody);

  return attempts;
}

/**
 * Detect endpoint errors that reject image/multimodal message content rather
 * than a sampler parameter. Covers vLLM deployments launched without
 * `--enable-multimodal` (surfaced as a 500) and common "no vision support"
 * phrasings from other OpenAI-compatible backends.
 */
export function isMultimodalRejectionError(message: string): boolean {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("multimodal") &&
    (normalized.includes("not enabled") ||
      normalized.includes("not supported") ||
      normalized.includes("--enable-multimodal"))
  ) {
    return true;
  }
  return (
    /does not support image/i.test(message) ||
    /image (?:input|content)s? (?:is|are) not supported/i.test(message) ||
    /vision is not (?:enabled|supported)/i.test(message)
  );
}

/** True when any OpenAI-format message carries an image content block. */
export function messagesContainImageBlocks(messages: readonly unknown[]): boolean {
  return messages.some((message) => {
    if (typeof message !== "object" || message === null) return false;
    const content = (message as Record<string, unknown>).content;
    return Array.isArray(content) && content.some(isImageContentBlock);
  });
}

/**
 * Replace image content blocks in OpenAI-format messages with a single text
 * notice per message. Unlike a silent filter, the notice keeps the model aware
 * an image existed so it neither hallucinates its contents nor ignores that
 * the user attached one. Messages without image blocks are returned unchanged.
 */
export function stripImageBlocksWithNotice(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return messages.map((message) => {
    const content = message.content;
    if (!Array.isArray(content)) return message;

    let removedCount = 0;
    let noticeIndex = -1;
    const filteredContent: unknown[] = [];
    for (const block of content) {
      if (isImageContentBlock(block)) {
        if (noticeIndex === -1) noticeIndex = filteredContent.length;
        removedCount += 1;
        continue;
      }
      filteredContent.push(block);
    }
    if (removedCount === 0) return message;

    const countLabel = removedCount === 1 ? "An attached image was" : `${removedCount} attached images were`;
    filteredContent.splice(noticeIndex, 0, {
      type: "text",
      text: `[System: ${countLabel} removed because this endpoint rejected image input. Do not guess or claim to see the image contents.]`,
    });
    return { ...message, content: filteredContent };
  });
}

/**
 * Build one targeted retry that strips image blocks from the current body,
 * or null when the body carries no image content worth stripping.
 */
export function buildImageStripAttempt(currentBody: Record<string, unknown>): DegradationAttempt | null {
  const messages = currentBody.messages;
  if (!Array.isArray(messages) || !messagesContainImageBlocks(messages)) return null;
  return {
    label: "targeted_strip_images",
    body: { ...currentBody, messages: stripImageBlocksWithNotice(messages as Array<Record<string, unknown>>) },
  };
}

function isImageContentBlock(block: unknown): boolean {
  if (typeof block !== "object" || block === null) return false;
  const type = (block as Record<string, unknown>).type;
  return type === "image_url" || type === "image";
}

/** Build one targeted retry that drops every message-named parameter at once. */
export function buildTargetedAttempt(
  currentBody: Record<string, unknown>,
  rejectedParams: readonly string[],
): DegradationAttempt {
  return {
    label: `targeted_drop_${rejectedParams.join("+")}`,
    body: cloneWithoutKeys(currentBody, rejectedParams),
  };
}
