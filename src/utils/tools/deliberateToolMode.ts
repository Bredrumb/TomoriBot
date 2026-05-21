import { log } from "@/utils/misc/logger";

export const PERSONAL_DELIBERATE_TOOL_MODES = ["off", "follow", "on"] as const;
export type PersonalDeliberateToolMode = (typeof PERSONAL_DELIBERATE_TOOL_MODES)[number];
export type DeliberateToolTrigger =
  | string
  | {
      type: "literal" | "regex";
      value: string;
    };
export type DeliberateToolTriggerMap = Record<string, DeliberateToolTrigger[]>;

export type DeliberateToolIntentMatchSource = "built-in" | "custom" | "follow-up";

export interface DeliberateToolIntentMatch {
  toolName: string;
  trigger: string;
  source: DeliberateToolIntentMatchSource;
}

export interface DeliberateToolIntentResult {
  allowedToolNames: string[];
  matches: DeliberateToolIntentMatch[];
}

const DEFAULT_TOOL_CONTEXT_TURNS = 4;
const MAX_TOOL_CONTEXT_TURNS = 10;

const URL_PATTERN = /\bhttps?:\/\/\S+/i;

const RELATIVE_TIME_PATTERN =
  /\b(?:in|for|after)\s+(?:about\s+|around\s+|like\s+|another\s+|a\s+)?\d+\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\b/i;
const SCHEDULE_TIME_PATTERN =
  /\b(?:tomorrow|tonight|today|later|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|from\s+now)\b/i;
const REMINDER_DIRECT_REQUEST_PATTERN =
  /\b(?:remind|ping|notify|poke|nudge)\s+(?:me|us|them|him|her|[A-Za-z0-9_@{}.-]+)\b/i;
const REMINDER_WAKE_REQUEST_PATTERN =
  /\b(?:wake\s+(?:me|us|them|him|her|[A-Za-z0-9_@{}.-]+)\s+up|get\s+(?:me|us|them|him|her|[A-Za-z0-9_@{}.-]+)\s+up)\b/i;
const REMINDER_CREATE_PATTERN =
  /\b(?:set|create|make|start|schedule|add)\b.{0,80}\b(?:reminder|timer|alarm|task|scheduled\s+task|task\s+reminder)\b/i;
const REMINDER_ANAPHORA_PATTERN =
  /\b(?:set|create|make|start|schedule|add|try|do)\b.{0,80}\b(?:one|another|it|that|the\s+same)\b.{0,80}\b(?:from\s+now|for\s+(?:a\s+)?(?:longer\s+)?time|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?)\b/i;
const REMINDER_TOOL_CORRECTION_PATTERN =
  /\b(?:didn'?t|did\s+not|forgot|failed|should(?:'ve|\s+have))\b.{0,100}\b(?:reminder|timer|alarm|create_task|scheduling?)\s+(?:tool|protocol)?\b/i;

function hasReminderCreationIntent(text: string): boolean {
  return (
    REMINDER_DIRECT_REQUEST_PATTERN.test(text) ||
    REMINDER_WAKE_REQUEST_PATTERN.test(text) ||
    REMINDER_CREATE_PATTERN.test(text) ||
    (REMINDER_ANAPHORA_PATTERN.test(text) && (RELATIVE_TIME_PATTERN.test(text) || SCHEDULE_TIME_PATTERN.test(text))) ||
    (REMINDER_TOOL_CORRECTION_PATTERN.test(text) &&
      (RELATIVE_TIME_PATTERN.test(text) || SCHEDULE_TIME_PATTERN.test(text)))
  );
}

const TOOL_INTENT_PATTERNS: RegExp[] = [
  /\b(search|web\s*search|look\s+up|browse|google|fetch|read\s+this\s+(?:url|link|page)|open\s+this\s+(?:url|link|page))\b/i,
  /\b(latest|today|current|currently|up[- ]?to[- ]?date|news|recent)\b/i,
  /\b(remember|save\s+(?:this|that|it)|forget|(?:delete|update)\s+(?:(?:this|that|your|my|the)\s+)?memory|store\s+(?:this|that|it))\b/i,
  /\b(look\s+at|analy[sz]e|inspect|describe|what(?:'s| is)\s+in)\b.*\b(image|picture|photo|pic|img|pfp|avatar|profile\s+picture|gif|video|youtube|attachment)\b/i,
  /\b(image|picture|photo|pic|img|pfp|avatar|profile\s+picture|gif|video|youtube|attachment)\b.*\b(look\s+at|analy[sz]e|inspect|describe|summari[sz]e)\b/i,
  /\b(generate|create|make|draw)\b.*\b(image|picture|photo|pic|img|pfp|video|voice|audio|speech|thread)\b/i,
  /\b(react|reply\s+to|delete|pin|unpin|edit|manage)\b.*\b(message|post|that|it)\b/i,
  /\b(create|make|start|open)\b.*\b(thread)\b/i,
];

const IMAGE_GENERATION_REQUEST_PATTERNS: RegExp[] = [
  /\b(?:can|could|may)\s+(?:i|we)\s+(?:have|get)\b.{0,80}\b(?:image|picture|photo|pic|img)\b/i,
  /\b(?:send|give)\s+(?:me|us)\b.{0,80}\b(?:image|picture|photo|pic|img)\b/i,
  /\b(?:i|we)\s+(?:want|would\s+like|need|could\s+use)\b.{0,80}\b(?:image|picture|photo|pic|img)\b/i,
];

const VIDEO_GENERATION_REQUEST_PATTERNS: RegExp[] = [
  /\b(?:can|could|may)\s+(?:i|we)\s+(?:have|get)\b.{0,80}\bvideo\b/i,
  /\b(?:send|give)\s+(?:me|us)\b.{0,80}\bvideo\b/i,
  /\b(?:i|we)\s+(?:want|would\s+like|need|could\s+use)\b.{0,80}\bvideo\b/i,
];

const VOICE_MESSAGE_INTENT_PATTERNS: RegExp[] = [
  /\b(?:voice|audio|spoken)\s+message\b/i,
  /\b(?:send|say|speak|record|deliver|do|make|generate|create)\b.{0,80}\b(?:voice|audio|spoken)\s+message\b/i,
  /\b(?:send|say|speak|record|deliver|make|generate|create)\b.{0,80}\bvoice\b/i,
  /\bvoice\b.{0,80}\b(?:please|instead|again|too|also|version|delivery)\b/i,
  /\b(?:supposed|meant|asked|prefer(?:red|ably)?|should(?:'ve| have)?)\b.{0,120}\b(?:voice|audio|spoken)\s+message\b/i,
  /\b(?:supposed|meant|asked|prefer(?:red|ably)?|should(?:'ve| have)?)\b.{0,120}\bvoice\b/i,
  /\b(?:as|via|through|with)\s+(?:a\s+)?(?:voice|audio|spoken)(?:\s+message)?\b/i,
];

const URL_TOOL_INTENT_PATTERNS: RegExp[] = [
  /\b(summari[sz]e|read|inspect|analy[sz]e|fetch|open|browse|check|look\s+at)\b/i,
  /\b(what(?:'s| is)\s+(?:this|on|in)|tell\s+me\s+about\s+this)\b/i,
];

const CROSS_CHANNEL_INTENT_PATTERNS: RegExp[] = [
  /\bcross[-_\s]?channel\b.{0,80}\b(?:message|send|post|peek|check|boomerang|tool|function)\b/i,
  /\b(?:send|post|say|tell|ask|message|write)\b.{0,120}\b(?:in|to|into|over\s+in)\s+(?:<#\d+>|#[^\s]+|`[^`]+`)/iu,
  /\b(?:go|hop|move|jump)\b.{0,80}\b(?:to|into|over\s+to)\s+(?:<#\d+>|#[^\s]+|`[^`]+`).{0,160}\b(?:send|post|say|tell|ask|message|write)\b/iu,
  /\b(?:go|hop|move|jump)\b.{0,80}\b(?:to|into|over\s+to)\s+(?:the\s+)?(?:channel|thread)\s+(?:named|called)?\s*(?:<#\d+>|#[^\s]+|`[^`]+`|[A-Za-z0-9_-]+)\b.{0,160}\b(?:send|post|say|tell|ask|message|write)\b/iu,
  /\b(?:send|post|say|tell|ask|message|write)\b.{0,120}\b(?:another|other|different|specific|target)\s+(?:channel|thread)\b/i,
  /\b(?:go|hop|peek|check|read|look)\b.{0,100}\b(?:another|other|different|specific|target|that|the)\s+(?:channel|thread)\b/i,
  /\b(?:peek|check|read|look)\b.{0,100}(?:<#\d+>|#[^\s]+|`[^`]+`)\b/iu,
  /\b(?:boomerang|report\s+back)\b.{0,120}\b(?:channel|thread|<#\d+>|#[^\s]+|`[^`]+`)\b/iu,
];

const STICKER_INTENT_PATTERNS: RegExp[] = [
  /\b(?:send|use|pick|choose|select|add)\b.{0,80}\b(?:sticker|stickers|emote|reaction\s+sticker)\b/i,
  /\b(?:sticker|stickers)\b.{0,80}\b(?:please|pls|plz|too|also|instead|for\s+that|with\s+that)\b/i,
];

const MESSAGE_METADATA_INTENT_PATTERNS: RegExp[] = [
  /\b(?:metadata|message\s+id|message\s+link|timestamp|jump\s+link)\b/i,
  /\b(?:when|what\s+time)\b.{0,80}\b(?:was|did)\b.{0,80}\b(?:sent|posted|say|write)\b/i,
  /\b(?:who|which\s+user)\b.{0,80}\b(?:sent|posted|said|wrote)\b/i,
];

const TOOL_FOLLOW_UP_PATTERNS: RegExp[] = [
  /\b(?:do|try|make|send|say|generate|run|repeat|redo)\b.{0,80}\b(?:that|it|this|one|again|same)\b/i,
  /\buse\s+(?:that|it|this|one|the\s+same)\b/i,
  /\b(?:that|it|this|one)\b.{0,60}\b(?:but|with|except)\b/i,
  /\bagain\b.{0,60}\b(?:but|with|except|more|less)\b/i,
  /\b(?:same\s+thing|like\s+that)\b/i,
  /\b(?:pretty\s+please|please\??|pls|plz)\b/i,
];

const WEB_TOOL_NAMES = [
  "web-search",
  "felo-search",
  "iask-search",
  "monica-search",
  "brave_web_search",
  "brave_image_search",
  "brave_video_search",
  "brave_news_search",
  "brave_local_search",
  "brave_summarizer",
  "fetch",
  "url-metadata",
];
const MEMORY_TOOL_NAMES = ["create_long_term_memory", "update_long_term_memory"];
const IMAGE_GENERATION_TOOL_NAMES = ["generate_image", "generate_image_nai"];
const VIDEO_GENERATION_TOOL_NAMES = ["generate_video"];
const VOICE_GENERATION_TOOL_NAMES = ["generate_voice_message"];
const MEDIA_ANALYSIS_TOOL_NAMES = [
  "analyze_image",
  "increase_media_context",
  "peek_profile_picture",
  "process_gif",
  "process_youtube_video",
  "read_file",
];
const MESSAGE_ACTION_TOOL_NAMES = ["interact_with_recent_message", "manage_message", "reveal_message_metadata"];
const CAPABILITY_TOOL_NAMES = ["review_capabilities"];
const STICKER_TOOL_NAMES = ["select_sticker_for_response"];

export const DELIBERATE_TOOL_TRIGGER_TARGETS = [
  { value: "image", label: "Image generation", toolNames: IMAGE_GENERATION_TOOL_NAMES },
  { value: "video", label: "Video generation", toolNames: VIDEO_GENERATION_TOOL_NAMES },
  { value: "voice", label: "Voice message", toolNames: VOICE_GENERATION_TOOL_NAMES },
  { value: "reminder", label: "Reminder/task", toolNames: ["create_task"] },
  { value: "cross-channel", label: "Cross-channel message", toolNames: ["cross_channel_message"] },
  { value: "search", label: "Web search/fetch", toolNames: WEB_TOOL_NAMES },
  { value: "memory", label: "Long-term memory", toolNames: MEMORY_TOOL_NAMES },
  { value: "media-analysis", label: "Media analysis", toolNames: MEDIA_ANALYSIS_TOOL_NAMES },
  { value: "message-action", label: "Message actions", toolNames: MESSAGE_ACTION_TOOL_NAMES },
  { value: "sticker", label: "Sticker selection", toolNames: STICKER_TOOL_NAMES },
  { value: "thread", label: "Thread creation", toolNames: ["create_thread"] },
  { value: "capabilities", label: "Capability review", toolNames: CAPABILITY_TOOL_NAMES },
] as const;

export type DeliberateToolTriggerTarget = (typeof DELIBERATE_TOOL_TRIGGER_TARGETS)[number]["value"];

const TOOL_NAMES_BY_TRIGGER_TARGET = new Map<string, string[]>(
  DELIBERATE_TOOL_TRIGGER_TARGETS.map((target) => [target.value, [...target.toolNames]]),
);

function uniqueToolNames(toolNames: string[]): string[] {
  return Array.from(new Set(toolNames));
}

function uniqueMatches(matches: DeliberateToolIntentMatch[]): DeliberateToolIntentMatch[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.toolName}\0${match.source}\0${match.trigger}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseDeliberateToolContextTurnsEnv(): number {
  const parsed = Number.parseInt(process.env.DELIBERATE_TOOL_CONTEXT_TURNS ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TOOL_CONTEXT_TURNS;
  return Math.min(Math.max(parsed, 0), MAX_TOOL_CONTEXT_TURNS);
}

export function resolveDeliberateToolContextTurns(configuredTurns: number | null | undefined): number {
  if (typeof configuredTurns === "number" && Number.isFinite(configuredTurns)) {
    return Math.min(Math.max(Math.trunc(configuredTurns), 0), MAX_TOOL_CONTEXT_TURNS);
  }

  return parseDeliberateToolContextTurnsEnv();
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeDeliberateToolTrigger(trigger: string | null | undefined): string {
  return (trigger ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizeDeliberateToolRegexTrigger(trigger: string | null | undefined): string {
  return (trigger ?? "").trim();
}

function literalTriggerMatches(text: string, trigger: string): boolean {
  const normalizedTrigger = normalizeDeliberateToolTrigger(trigger);
  if (!normalizedTrigger) return false;

  const escaped = escapeRegExpLiteral(normalizedTrigger).replace(/\s+/g, "\\s+");
  const wordLike = /^[\p{L}\p{N}_-]+$/u.test(normalizedTrigger);
  const pattern = wordLike
    ? new RegExp(`(^|[^\\p{L}\\p{N}_-])${escaped}($|[^\\p{L}\\p{N}_-])`, "iu")
    : new RegExp(escaped, "iu");
  return pattern.test(text);
}

function regexTriggerMatches(text: string, trigger: string): boolean {
  const normalizedTrigger = normalizeDeliberateToolRegexTrigger(trigger);
  if (!normalizedTrigger) return false;

  try {
    return new RegExp(normalizedTrigger, "iu").test(text);
  } catch (error) {
    log.warn(`Invalid custom deliberate tool regex trigger ignored: ${normalizedTrigger}`, error);
    return false;
  }
}

function getCustomTriggerValue(trigger: DeliberateToolTrigger): string {
  return typeof trigger === "string" ? trigger : trigger.value;
}

export function getDeliberateToolTriggerTargetLabel(targetValue: string): string {
  return DELIBERATE_TOOL_TRIGGER_TARGETS.find((target) => target.value === targetValue)?.label ?? targetValue;
}

export function getToolNamesForDeliberateTriggerTarget(targetValue: string): string[] {
  return TOOL_NAMES_BY_TRIGGER_TARGET.get(targetValue) ?? [];
}

function addToolMatches(
  allowedToolNames: string[],
  matches: DeliberateToolIntentMatch[],
  toolNames: string[],
  trigger: string,
  source: DeliberateToolIntentMatchSource,
): void {
  allowedToolNames.push(...toolNames);
  for (const toolName of toolNames) {
    matches.push({ toolName, trigger, source });
  }
}

function getRegexTrigger(text: string, pattern: RegExp, fallback: string): string {
  const match = text.match(pattern);
  return match?.[1]?.trim().toLowerCase() || fallback;
}

function hasToolFollowUpIntent(text: string): boolean {
  return TOOL_FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(text));
}

export function hasDeliberateToolIntent(
  content: string | null | undefined,
  customTriggers?: DeliberateToolTriggerMap | null,
): boolean {
  const text = content?.trim();
  if (!text) return false;

  if (getCustomDeliberateToolIntentResult(text, customTriggers).allowedToolNames.length > 0) {
    return true;
  }

  if (hasReminderCreationIntent(text)) {
    return true;
  }

  if (CROSS_CHANNEL_INTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  if (VOICE_MESSAGE_INTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  if (TOOL_INTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  if (IMAGE_GENERATION_REQUEST_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  if (VIDEO_GENERATION_REQUEST_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  if (STICKER_INTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  if (MESSAGE_METADATA_INTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  return URL_PATTERN.test(text) && URL_TOOL_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

function getCustomDeliberateToolIntentResult(
  text: string,
  customTriggers: DeliberateToolTriggerMap | null | undefined,
): DeliberateToolIntentResult {
  const allowedToolNames: string[] = [];
  const matches: DeliberateToolIntentMatch[] = [];
  if (!customTriggers) return { allowedToolNames, matches };

  for (const [targetValue, triggers] of Object.entries(customTriggers)) {
    const toolNames = getToolNamesForDeliberateTriggerTarget(targetValue);
    if (toolNames.length === 0 || !Array.isArray(triggers)) continue;

    for (const trigger of triggers) {
      if (typeof trigger === "string" || trigger.type === "literal") {
        const normalizedTrigger = normalizeDeliberateToolTrigger(getCustomTriggerValue(trigger));
        if (!normalizedTrigger || !literalTriggerMatches(text, normalizedTrigger)) continue;
        addToolMatches(allowedToolNames, matches, toolNames, normalizedTrigger, "custom");
        continue;
      }

      if (trigger.type === "regex") {
        const normalizedTrigger = normalizeDeliberateToolRegexTrigger(trigger.value);
        if (!normalizedTrigger || !regexTriggerMatches(text, normalizedTrigger)) continue;
        addToolMatches(allowedToolNames, matches, toolNames, `/${normalizedTrigger}/`, "custom");
      }
    }
  }

  return {
    allowedToolNames: uniqueToolNames(allowedToolNames),
    matches: uniqueMatches(matches),
  };
}

export function getDeliberateToolIntentResult(
  content: string | null | undefined,
  customTriggers?: DeliberateToolTriggerMap | null,
): DeliberateToolIntentResult {
  const text = content?.trim();
  if (!text) return { allowedToolNames: [], matches: [] };

  const allowedToolNames: string[] = [];
  const matches: DeliberateToolIntentMatch[] = [];

  const customResult = getCustomDeliberateToolIntentResult(text, customTriggers);
  allowedToolNames.push(...customResult.allowedToolNames);
  matches.push(...customResult.matches);

  if (hasReminderCreationIntent(text)) {
    addToolMatches(allowedToolNames, matches, ["create_task"], "reminder/timer request", "built-in");
  }

  if (
    /\b(search|web\s*search|look\s+up|browse|google|fetch|latest|today|current|currently|up[- ]?to[- ]?date|news|recent)\b/i.test(
      text,
    ) ||
    (URL_PATTERN.test(text) && URL_TOOL_INTENT_PATTERNS.some((pattern) => pattern.test(text)))
  ) {
    addToolMatches(
      allowedToolNames,
      matches,
      WEB_TOOL_NAMES,
      getRegexTrigger(
        text,
        /\b(search|web\s*search|look\s+up|browse|google|fetch|latest|today|current|currently|up[- ]?to[- ]?date|news|recent)\b/i,
        "url/web request",
      ),
      "built-in",
    );
  }

  if (
    /\b(remember|save\s+(?:this|that|it)|forget|delete\s+(?:that\s+)?memory|update\s+(?:your\s+)?memory|store\s+(?:this|that|it))\b/i.test(
      text,
    )
  ) {
    addToolMatches(
      allowedToolNames,
      matches,
      MEMORY_TOOL_NAMES,
      getRegexTrigger(
        text,
        /\b(remember|forget|delete\s+(?:that\s+)?memory|update\s+(?:your\s+)?memory|store)\b/i,
        "memory request",
      ),
      "built-in",
    );
  }

  if (
    /\b(look\s+at|analy[sz]e|inspect|describe|what(?:'s| is)\s+in)\b.*\b(image|picture|photo|pic|img|pfp|avatar|profile\s+picture|gif|video|youtube|attachment|file|document|pdf)\b/i.test(
      text,
    ) ||
    /\b(image|picture|photo|pic|img|pfp|avatar|profile\s+picture|gif|video|youtube|attachment|file|document|pdf)\b.*\b(look\s+at|analy[sz]e|inspect|describe|summari[sz]e|read)\b/i.test(
      text,
    )
  ) {
    addToolMatches(allowedToolNames, matches, MEDIA_ANALYSIS_TOOL_NAMES, "media analysis request", "built-in");
  }

  if (VOICE_MESSAGE_INTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    addToolMatches(allowedToolNames, matches, VOICE_GENERATION_TOOL_NAMES, "voice message", "built-in");
  }

  if (IMAGE_GENERATION_REQUEST_PATTERNS.some((pattern) => pattern.test(text))) {
    addToolMatches(
      allowedToolNames,
      matches,
      IMAGE_GENERATION_TOOL_NAMES,
      getRegexTrigger(text, /\b(image|picture|photo|pic|img)\b/i, "image request"),
      "built-in",
    );
  }

  if (VIDEO_GENERATION_REQUEST_PATTERNS.some((pattern) => pattern.test(text))) {
    addToolMatches(
      allowedToolNames,
      matches,
      VIDEO_GENERATION_TOOL_NAMES,
      getRegexTrigger(text, /\b(video)\b/i, "video request"),
      "built-in",
    );
  }

  const generationTargetMatch = text.match(
    /\b(?:generate|create|make|draw)\b.*\b(image|picture|photo|pic|img|pfp|video|voice|audio|speech)\b/i,
  );
  if (generationTargetMatch) {
    const target = generationTargetMatch[1]?.toLowerCase();
    const generationToolNames =
      target === "video"
        ? VIDEO_GENERATION_TOOL_NAMES
        : target === "voice" || target === "audio" || target === "speech"
          ? VOICE_GENERATION_TOOL_NAMES
          : IMAGE_GENERATION_TOOL_NAMES;
    addToolMatches(allowedToolNames, matches, generationToolNames, target || "generation request", "built-in");
  }

  if (/\b(react|reply\s+to|delete|pin|unpin|edit|manage)\b.*\b(message|post|that|it)\b/i.test(text)) {
    addToolMatches(allowedToolNames, matches, MESSAGE_ACTION_TOOL_NAMES, "message action request", "built-in");
  }

  if (MESSAGE_METADATA_INTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    addToolMatches(allowedToolNames, matches, ["reveal_message_metadata"], "message metadata request", "built-in");
  }

  if (CROSS_CHANNEL_INTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    addToolMatches(allowedToolNames, matches, ["cross_channel_message"], "cross-channel request", "built-in");
  }

  if (STICKER_INTENT_PATTERNS.some((pattern) => pattern.test(text))) {
    addToolMatches(allowedToolNames, matches, STICKER_TOOL_NAMES, "sticker request", "built-in");
  }

  if (/\b(create|make|start|open)\b.*\b(thread)\b/i.test(text)) {
    addToolMatches(allowedToolNames, matches, ["create_thread"], "thread request", "built-in");
  }

  if (
    /\b(capabilities|what\s+can\s+you\s+do|available\s+(?:tools|commands|settings)|review\s+(?:your\s+)?(?:capabilities|settings))\b/i.test(
      text,
    )
  ) {
    addToolMatches(allowedToolNames, matches, CAPABILITY_TOOL_NAMES, "capability review request", "built-in");
  }

  return {
    allowedToolNames: uniqueToolNames(allowedToolNames),
    matches: uniqueMatches(matches),
  };
}

export function getDeliberateToolAllowedNames(
  content: string | null | undefined,
  customTriggers?: DeliberateToolTriggerMap | null,
): string[] {
  return getDeliberateToolIntentResult(content, customTriggers).allowedToolNames;
}

export function getFollowUpToolAllowedNames(
  content: string | null | undefined,
  recentToolNames: string[] | null | undefined,
): string[] {
  return getFollowUpToolIntentResult(content, recentToolNames).allowedToolNames;
}

export function getFollowUpToolIntentResult(
  content: string | null | undefined,
  recentToolNames: string[] | null | undefined,
): DeliberateToolIntentResult {
  const text = content?.trim();
  if (!text || !recentToolNames?.length || !hasToolFollowUpIntent(text)) {
    return { allowedToolNames: [], matches: [] };
  }
  const allowedToolNames = uniqueToolNames(recentToolNames);
  return {
    allowedToolNames,
    matches: allowedToolNames.map((toolName) => ({
      toolName,
      trigger: "recent tool follow-up",
      source: "follow-up",
    })),
  };
}

export function filterDeliberateToolNames(
  toolNames: string[],
  allowedToolNames: string[] | null | undefined,
): string[] {
  if (!allowedToolNames?.length) return toolNames;
  const allowedSet = new Set(allowedToolNames);
  return toolNames.filter((toolName) => allowedSet.has(toolName));
}

export function isToolAllowedByDeliberateMode(
  toolName: string,
  allowedToolNames: string[] | null | undefined,
): boolean {
  return !allowedToolNames?.length || allowedToolNames.includes(toolName);
}

export function applyDeliberateToolAllowlist<T extends { name: string }>(params: {
  providerLabel: string;
  builtInTools: T[];
  mcpFunctionNames: string[];
  allowedToolNames?: string[] | null;
}): { builtInTools: T[]; mcpFunctionNames: string[] } {
  const { providerLabel, builtInTools, mcpFunctionNames, allowedToolNames } = params;
  if (!allowedToolNames?.length) {
    return { builtInTools, mcpFunctionNames };
  }

  const filteredBuiltInTools = builtInTools.filter((tool) => isToolAllowedByDeliberateMode(tool.name, allowedToolNames));
  const filteredMcpFunctionNames = filterDeliberateToolNames(mcpFunctionNames, allowedToolNames);

  log.info(
    `${providerLabel}: Applied deliberate tool allowlist: ${builtInTools.length} -> ${filteredBuiltInTools.length} built-in, ${mcpFunctionNames.length} -> ${filteredMcpFunctionNames.length} MCP tools`,
  );

  return {
    builtInTools: filteredBuiltInTools,
    mcpFunctionNames: filteredMcpFunctionNames,
  };
}

export function resolveDeliberateToolMode(
  serverDeliberateToolMode: boolean | null | undefined,
  personalMode: PersonalDeliberateToolMode | null | undefined,
): boolean {
  if (personalMode === "on") return true;
  if (personalMode === "off") return false;
  return Boolean(serverDeliberateToolMode);
}
