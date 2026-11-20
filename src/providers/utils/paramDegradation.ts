import { isDeepStrictEqual } from "node:util";

// Adapters must not retry degradation attempts once the first meaningful chunk is yielded because restarting
// mid-stream duplicates observed output.

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

export const MAX_TARGETED_DEGRADATION_ATTEMPTS = 3;

const REJECTABLE_PARAM_TOKENS = [
  ...PARAM_DROP_PRIORITY,
  "stream_options",
  "max_context_length",
  "options",
  "cache_control",
] as const;

// Word-like keys require quotes when matching errors because bare 'options' in prose would otherwise drop Ollama's
// options.num_ctx and shrink context.
const QUOTED_ONLY_PARAM_TOKENS: ReadonlySet<string> = new Set(["options"]);

function errorNamesParam(errorMessage: string, param: string): boolean {
  const pattern = QUOTED_ONLY_PARAM_TOKENS.has(param) ? `['"\`]${param}['"\`]` : `\\b${param}\\b`;
  return new RegExp(pattern, "i").test(errorMessage);
}

export interface DegradationAttempt {
  label: string;
  body: Record<string, unknown>;
}

export function areDegradationBodiesEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  // Compare bodies without serialization because retry deduplication must not allocate copies of inline media.
  const leftKeys = Object.keys(left).filter((key) => left[key] !== undefined);
  const rightKeys = Object.keys(right).filter((key) => right[key] !== undefined);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(right, key) && isDeepStrictEqual(left[key], right[key]))
  );
}

export type DegradableErrorKind =
  | "generic_400"
  | "parameter_rejection_400"
  | "no_endpoints_404"
  | "backend_incompatible_502"
  | "opaque_5xx"
  | "provider_specific";

export interface DegradableErrorInput {
  statusCode: number | null;
  message: string;
}

type ExtraDegradationClassifier = (error: DegradableErrorInput) => boolean;

export interface ClassifyDegradableErrorOptions extends DegradableErrorInput {
  extraClassifiers?: readonly ExtraDegradationClassifier[];
  // Intended only for router providers such as OpenRouter because their 502s often reflect backend rejection while
  // direct 502s mean outages.
  degradeOn502?: boolean;
  // Enabled for backends such as NVIDIA NIM vLLM V2 because they emit opaque 5xx mid-SSE on unsupported keys, while
  // generic gating keeps outages failing fast.
  degradeOnOpaque5xx?: boolean;
}

export interface BuildDegradationAttemptsOptions {
  mandatoryKeys: ReadonlySet<string>;
  stripImages?: (messages: unknown) => unknown;
  // Only safe-to-drop adapter-injected keys belong here so they probe before samplers, while reply-shaping keys stay
  // in mandatoryKeys to prevent silent loss.
  priorityKeys?: readonly string[];
}

function cloneWithoutKeys(input: Record<string, unknown>, keysToRemove: readonly string[]): Record<string, unknown> {
  const cloned = { ...input };
  for (const key of keysToRemove) {
    delete cloned[key];
  }
  if (keysToRemove.includes("cache_control")) {
    if (Array.isArray(input.system)) cloned.system = stripCacheBlocks(input.system);
    if (Array.isArray(input.messages)) {
      cloned.messages = input.messages.map((message: Record<string, unknown>) =>
        Array.isArray(message.content) ? { ...message, content: stripCacheBlocks(message.content) } : message,
      );
    }
  }
  return cloned;
}

function stripCacheBlocks(blocks: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return blocks.map((block) => {
    const { cache_control: _cacheControl, ...rest } = block;
    return rest;
  });
}

function hasCacheControl(body: Record<string, unknown>): boolean {
  const hasBlocks = (blocks: unknown): boolean =>
    Array.isArray(blocks) && blocks.some((block: Record<string, unknown>) => "cache_control" in block);
  return (
    "cache_control" in body ||
    hasBlocks(body.system) ||
    (Array.isArray(body.messages) &&
      body.messages.some((message: Record<string, unknown>) => hasBlocks(message.content)))
  );
}

function isLikelyGenericErrorMessage(message: string): boolean {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[.!\s]+$/, "");
  return (
    normalized.length === 0 ||
    normalized === "error" ||
    normalized === "bad request" ||
    normalized === "request failed" ||
    normalized === "invalid request" ||
    // Xiaomi's backend, relayed through OpenRouter, rejects without naming a field.
    normalized === "invalid request. please check your input and try again" ||
    normalized === "internal server error" ||
    normalized === "internal error"
  );
}

function isParameterRejectionError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("invalid api parameter") ||
    normalized.includes("unsupported parameter") ||
    normalized.includes("unknown parameter") ||
    normalized.includes("parameter not supported") ||
    normalized.includes("parameters are not yet supported") ||
    /property ['"][^'"]+['"] is unsupported/.test(normalized)
  );
}

export function extractRejectedParams(errorMessage: string, requestBody: Record<string, unknown>): string[] {
  return REJECTABLE_PARAM_TOKENS.filter((param) => {
    if (param === "cache_control" ? !hasCacheControl(requestBody) : !(param in requestBody)) return false;
    return errorNamesParam(errorMessage, param);
  });
}

export function errorMessageNamesRejectableParam(errorMessage: string): boolean {
  return REJECTABLE_PARAM_TOKENS.some((param) => errorNamesParam(errorMessage, param));
}

export function classifyDegradableError({
  statusCode,
  message,
  extraClassifiers = [],
  degradeOn502 = false,
  degradeOnOpaque5xx = false,
}: ClassifyDegradableErrorOptions): DegradableErrorKind | null {
  if (statusCode === 400 && isLikelyGenericErrorMessage(message)) {
    return "generic_400";
  }
  if (statusCode === 400 && (isParameterRejectionError(message) || errorNamesParam(message, "cache_control"))) {
    return "parameter_rejection_400";
  }
  if (statusCode === 404 && message.toLowerCase().includes("no endpoints found")) {
    return "no_endpoints_404";
  }
  if (statusCode === 502 && degradeOn502) {
    return "backend_incompatible_502";
  }
  if (degradeOnOpaque5xx && statusCode !== null && statusCode >= 500 && isLikelyGenericErrorMessage(message)) {
    return "opaque_5xx";
  }
  if (extraClassifiers.some((classifier) => classifier({ statusCode, message }))) {
    return "provider_specific";
  }
  return null;
}

function describeDegradableErrorKind(kind: DegradableErrorKind): string {
  switch (kind) {
    case "generic_400":
      return "generic HTTP 400";
    case "parameter_rejection_400":
      return "parameter rejection (400)";
    case "no_endpoints_404":
      return "no endpoints found (404)";
    case "backend_incompatible_502":
      return "backend incompatible with parameters (502)";
    case "opaque_5xx":
      return "an opaque server error with no diagnostic message (5xx)";
    case "provider_specific":
      return "provider-specific parameter rejection";
  }
}

function describeDegradationTrigger(kind: DegradableErrorKind | null, queuedImageStrip: boolean): string {
  if (kind) return describeDegradableErrorKind(kind);
  if (queuedImageStrip) return "a multimodal/image-input rejection";
  return "an error naming request parameters";
}

export interface DegradationRetryPlanInput extends DegradableErrorInput {
  attempts: DegradationAttempt[];
  attemptIndex: number;
  body: Record<string, unknown>;
  classifyOptions?: Omit<ClassifyDegradableErrorOptions, "statusCode" | "message">;
  prepareAttempts: () => void;
  queueTargetedAttempt: (attemptIndex: number, body: Record<string, unknown>, errorMessage: string) => boolean;
  queueImageStripAttempt: (attemptIndex: number, body: Record<string, unknown>, errorMessage: string) => boolean;
}

export interface DegradationRetryPlan {
  trigger: string;
}

// Queue callbacks run before the remaining-attempt check because queueing appends to attempts, allowing even the
// final rung's failure to extend the ladder.
export function planDegradationRetry(input: DegradationRetryPlanInput): DegradationRetryPlan | null {
  const queuedTargeted = input.queueTargetedAttempt(input.attemptIndex, input.body, input.message);
  const queuedImageStrip = input.queueImageStripAttempt(input.attemptIndex, input.body, input.message);
  const kind = classifyDegradableError({
    statusCode: input.statusCode,
    message: input.message,
    ...input.classifyOptions,
  });

  if (!kind && !queuedTargeted && !queuedImageStrip) return null;
  input.prepareAttempts();
  if (input.attemptIndex >= input.attempts.length - 1) return null;
  return { trigger: describeDegradationTrigger(kind, queuedImageStrip) };
}

export function buildDegradationAttempts(
  baseBody: Record<string, unknown>,
  { mandatoryKeys, stripImages, priorityKeys = [] }: BuildDegradationAttemptsOptions,
): DegradationAttempt[] {
  const attempts: DegradationAttempt[] = [];
  const addAttempt = (label: string, body: Record<string, unknown>) => {
    if (attempts.some((attempt) => areDegradationBodiesEqual(attempt.body, body))) return;
    attempts.push({ label, body });
  };

  addAttempt("default", { ...baseBody });

  const probeBaseline = "stream_options" in baseBody ? cloneWithoutKeys(baseBody, ["stream_options"]) : { ...baseBody };
  addAttempt("no_stream_options", probeBaseline);
  if (hasCacheControl(probeBaseline)) {
    addAttempt("probe_drop_cache_control", cloneWithoutKeys(probeBaseline, ["cache_control"]));
  }

  // Probe adapter-injected priority keys before user samplers because the user never asked for them and reaching that
  // rung sooner cuts retries.
  const probeRank = (key: string): number => {
    const priorityIdx = priorityKeys.indexOf(key);
    if (priorityIdx !== -1) return priorityIdx;
    const standardIdx = PARAM_DROP_PRIORITY.indexOf(key as (typeof PARAM_DROP_PRIORITY)[number]);
    if (standardIdx !== -1) return priorityKeys.length + standardIdx;
    return priorityKeys.length + PARAM_DROP_PRIORITY.length;
  };

  const probeCandidateKeys = Object.keys(probeBaseline)
    .filter((key) => !mandatoryKeys.has(key) && key !== "tools")
    .sort((a, b) => probeRank(a) - probeRank(b));

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
  addAttempt(
    "minimal_payload",
    hasCacheControl(minimalBody) ? cloneWithoutKeys(minimalBody, ["cache_control"]) : minimalBody,
  );

  return attempts;
}

export function createDegradationQueue(baseBody: Record<string, unknown>, options: BuildDegradationAttemptsOptions) {
  const attempts: DegradationAttempt[] = [{ label: "default", body: baseBody }];
  let prepared = false;
  const prepareAttempts = () => {
    if (prepared) return;
    prepared = true;
    for (const attempt of buildDegradationAttempts(baseBody, options).slice(1)) {
      if (!attempts.some((queued) => areDegradationBodiesEqual(queued.body, attempt.body))) {
        attempts.push(attempt);
      }
    }
  };
  return { attempts, prepareAttempts };
}

// Multimodal rejections are matched by message because vLLM without --enable-multimodal returns HTTP 500 and
// OpenAI-compatible backends vary their wording.
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

export function messagesContainImageBlocks(messages: readonly unknown[]): boolean {
  return messages.some((message) => {
    if (typeof message !== "object" || message === null) return false;
    const content = (message as Record<string, unknown>).content;
    return Array.isArray(content) && content.some(isImageContentBlock);
  });
}

// Image blocks are replaced with a text notice instead of silently filtered, so the model knows an image existed
// without hallucinating or ignoring it.
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

export function buildTargetedAttempt(
  currentBody: Record<string, unknown>,
  rejectedParams: readonly string[],
): DegradationAttempt {
  return {
    label: `targeted_drop_${rejectedParams.join("+")}`,
    body: cloneWithoutKeys(currentBody, rejectedParams),
  };
}
