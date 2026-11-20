// Identity macros ({{user}}, {{char}}) stay unresolved here so contextBuilder.ts handles them downstream with its
// stable User placeholder.

import type { StPresetNodeRow } from "@/types/db/schema";
import { log } from "@/utils/misc/logger";
import { formatDateWithOffset, formatTimeWithOffset } from "@/utils/text/timezoneHelper";
import { flattenConditionals, renderStConditionals } from "@/utils/tools/promptConditionals";

export interface MacroContext {
  userName: string;
  charName: string;
  personality: string;
  description: string;
  scenario: string;
  mesExamples: string;
  lastChatMessage: string;
  model: string;
  provider: string;
  charVersion: string;
  utcOffsetHours: number | null;
  nowMs: number;
}

export interface ResolvedNode {
  identifier: string;
  name: string;
  role: "system" | "user" | "model";
  content: string;
  is_marker: boolean;
  is_enabled: boolean;
  is_comment: boolean;
  node_order: number;
  injection_position: number;
  injection_depth: number;
  injection_order: number;
  hasHtmlWarning: boolean;
}

const COMMENT_REGEX = /\{\{\/\/[^}]*\}\}/g;

const VAR_DECLARATION_REGEX = /\{\{(setvar|addvar)::([^:}]+)::([^}]*)\}\}/g;

const GETVAR_REGEX = /\{\{getvar::([^}]+)\}\}/g;

// Negative lookahead prevents matching {{random::...}} double-colon syntax because comma macros run before
// double-colon macros.
const RANDOM_COMMA_REGEX = /\{\{random:(?!:)\s*([^}]+)\}\}/gi;

const RANDOM_DOUBLE_COLON_REGEX = /\{\{random::([^}]+)\}\}/gi;

const ROLL_REGEX = /\{\{roll:\s*(\d+)d(\d+)\}\}/gi;

const TRIM_REGEX = /\{\{trim\}\}/g;

const SIMPLE_SUPPORTED_MACRO_REGEX =
  /\{\{(?:user|char|bot|personality|description|scenario|mesExamples|lastChatMessage|time|date|weekday|isotime|isodate|model|provider|char_version|input)\}\}/gi;

const GENERIC_MACRO_REGEX = /\{\{([^{}]+)\}\}/g;

const HTML_TAG_REGEX =
  /<(?:div|span|style|br|p|h[1-6]|table|tr|td|th|ul|ol|li|details|summary|img|a|strong|em|b|i|u|s|pre|code)\b[^>]*>/i;

function applyCompatibilityPatches(text: string, userName: string, charName: string): string {
  // Non-standard ST preset placeholders (<USER>, <BOT>) stay case-sensitive so lowercase HTML tags never match.
  let result = text.replaceAll("<USER>", userName);
  result = result.replaceAll("<BOT>", charName);

  return result;
}

function stripComments(text: string): string {
  return text.replace(COMMENT_REGEX, "");
}

function processVarDeclarations(
  text: string,
  targetVars?: Map<string, string>,
): {
  cleaned: string;
  vars: Map<string, string>;
} {
  const vars = targetVars ?? new Map<string, string>();

  const cleaned = text.replace(VAR_DECLARATION_REGEX, (_match, mode: string, key: string, value: string) => {
    const normalizedKey = key.trim();

    if (mode === "addvar") {
      vars.set(normalizedKey, `${vars.get(normalizedKey) ?? ""}${value}`);
    } else {
      vars.set(normalizedKey, value);
    }

    return "";
  });

  return { cleaned, vars };
}

export function findUnsupportedPresetMacros(text: string): string[] {
  let malformedConditional = false;
  const flattened = flattenConditionals(stripComments(text), () => {
    malformedConditional = true;
  });
  const stripped = flattened
    .replace(VAR_DECLARATION_REGEX, "")
    .replace(GETVAR_REGEX, "")
    .replace(RANDOM_COMMA_REGEX, "")
    .replace(RANDOM_DOUBLE_COLON_REGEX, "")
    .replace(ROLL_REGEX, "")
    .replace(TRIM_REGEX, "")
    .replace(SIMPLE_SUPPORTED_MACRO_REGEX, "");

  GENERIC_MACRO_REGEX.lastIndex = 0;

  const labels = new Set<string>();
  if (malformedConditional) labels.add("{{#if ...}} (malformed)");
  for (const match of stripped.matchAll(GENERIC_MACRO_REGEX)) {
    const body = match[1]?.trim();
    if (!body) continue;

    if (body.startsWith("roll:")) {
      labels.add("{{roll:...}}");
      continue;
    }

    const macroName = body.match(/^([a-zA-Z_][\w-]*)/u)?.[1];
    if (macroName) {
      labels.add(`{{${macroName}}}`);
      continue;
    }

    labels.add(`{{${body}}}`);
  }

  return [...labels];
}

function processGetVars(text: string, vars: Map<string, string>): string {
  return text.replace(GETVAR_REGEX, (_match, key: string) => {
    return vars.get(key.trim()) ?? "";
  });
}

function processContentMacros(text: string, ctx: MacroContext, expanded: Set<string>): string {
  // trackingKey records which native markers were already expanded so presetContextBuilder avoids duplicating them.
  const macroMap: Array<{
    pattern: RegExp;
    value: string;
    trackingKey: string;
  }> = [
    {
      pattern: /\{\{personality\}\}/gi,
      value: ctx.personality,
      trackingKey: "personality",
    },
    {
      pattern: /\{\{description\}\}/gi,
      value: ctx.description,
      trackingKey: "description",
    },
    {
      pattern: /\{\{scenario\}\}/gi,
      value: ctx.scenario,
      trackingKey: "scenario",
    },
    {
      pattern: /\{\{mesExamples\}\}/gi,
      value: ctx.mesExamples,
      trackingKey: "mesExamples",
    },
    {
      pattern: /\{\{lastChatMessage\}\}/gi,
      value: ctx.lastChatMessage,
      trackingKey: "lastChatMessage",
    },
  ];

  let result = text;
  for (const { pattern, value, trackingKey } of macroMap) {
    if (pattern.test(result)) {
      pattern.lastIndex = 0;
      result = result.replace(pattern, value);
      if (value.length > 0) {
        expanded.add(trackingKey);
      }
    }
  }

  return result;
}

const MILLISECONDS_PER_HOUR = 3_600_000;

const RUNTIME_MACRO_REGEX = /\{\{(time|date|weekday|isotime|isodate|model|provider|char_version|input)\}\}/gi;

const CLOCK_ONLY: Intl.DateTimeFormatOptions = { year: undefined, month: undefined, day: undefined };

function formatTemporalMacro(name: string, nowMs: number, offsetHours: number): string {
  const shiftedIso = new Date(nowMs + offsetHours * MILLISECONDS_PER_HOUR).toISOString();
  switch (name) {
    case "isodate":
      return shiftedIso.slice(0, 10);
    case "isotime":
      return shiftedIso.slice(11, 16);
    case "date":
      return formatDateWithOffset(nowMs, offsetHours);
    case "weekday":
      return formatTimeWithOffset(new Date(nowMs), offsetHours, {
        ...CLOCK_ONLY,
        hour: undefined,
        minute: undefined,
        weekday: "long",
      });
    default:
      return formatTimeWithOffset(new Date(nowMs), offsetHours, { ...CLOCK_ONLY, hour: "numeric", minute: "2-digit" });
  }
}

function processRuntimeMacros(text: string, ctx: MacroContext): string {
  return text.replace(RUNTIME_MACRO_REGEX, (_match, rawName: string) => {
    const name = rawName.toLowerCase();
    switch (name) {
      case "model":
        return ctx.model;
      case "provider":
        return ctx.provider;
      case "char_version":
        return ctx.charVersion;
      case "input":
        return ctx.lastChatMessage;
      default:
        return ctx.utcOffsetHours === null ? "" : formatTemporalMacro(name, ctx.nowMs, ctx.utcOffsetHours);
    }
  });
}

function resolveValueMacros(text: string, vars: Map<string, string>, ctx: MacroContext, expanded: Set<string>): string {
  return processRuntimeMacros(processContentMacros(processGetVars(text, vars), ctx, expanded), ctx);
}

const BARE_CONDITION_REGEX = /^[a-z_][\w-]*(?:::[^{}]*)?$/i;

function resolveConditionExpression(expression: string, vars: Map<string, string>, ctx: MacroContext): string {
  const source = BARE_CONDITION_REGEX.test(expression) ? `{{${expression}}}` : expression;
  // A condition only tests a value, so it must not count as the expansion that suppresses a native marker.
  const resolved = resolveValueMacros(source, vars, ctx, new Set<string>())
    .replace(/\{\{user\}\}/gi, ctx.userName)
    .replace(/\{\{(?:char|bot)\}\}/gi, ctx.charName);
  return resolved.replace(GENERIC_MACRO_REGEX, "");
}

function processRandom(text: string): string {
  const pickRandomItem = (items: string[]) => {
    if (items.length === 0) {
      return "";
    }

    return items[Math.floor(Math.random() * items.length)];
  };

  const commaResolved = text.replace(RANDOM_COMMA_REGEX, (_match, options: string) => {
    const items = options
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return pickRandomItem(items);
  });

  return commaResolved.replace(RANDOM_DOUBLE_COLON_REGEX, (_match, options: string) => {
    const items = options
      .split("::")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return pickRandomItem(items);
  });
}

function processRoll(text: string): string {
  return text.replace(ROLL_REGEX, (_match, countStr: string, sidesStr: string) => {
    const count = Math.min(Number.parseInt(countStr, 10), 100);
    const sides = Math.min(Number.parseInt(sidesStr, 10), 1000);
    if (count <= 0 || sides <= 0) return "0";

    let sum = 0;
    for (let i = 0; i < count; i++) {
      sum += Math.floor(Math.random() * sides) + 1;
    }
    return sum.toString();
  });
}

function processTrim(text: string): { result: string; isEmpty: boolean } {
  const hasTrim = TRIM_REGEX.test(text);
  if (!hasTrim) {
    return { result: text, isEmpty: false };
  }

  TRIM_REGEX.lastIndex = 0;
  const cleaned = text.replace(TRIM_REGEX, "").trim();
  return { result: cleaned, isEmpty: cleaned.length === 0 };
}

function detectHtmlContent(text: string): boolean {
  return HTML_TAG_REGEX.test(text);
}

function mapStRole(stRole: string): "system" | "user" | "model" {
  switch (stRole.toLowerCase()) {
    case "assistant":
      return "model";
    case "user":
      return "user";
    default:
      return "system";
  }
}

export function resolvePresetMacros(
  nodes: StPresetNodeRow[],
  macroContext: MacroContext,
): { resolved: ResolvedNode[]; expandedContentMacros: Set<string> } {
  const expandedContentMacros = new Set<string>();
  const globalVars = new Map<string, string>();
  const selectedText = new Map<StPresetNodeRow, string>();
  const warn = (message: string) => log.warn(`[ST Preset Engine] ${message}`);

  // Conditions run once against declarations seen so far, while text lookups retain final-value semantics.
  for (const node of nodes) {
    if (!node.is_enabled || node.is_marker || node.is_comment) continue;
    selectedText.set(
      node,
      renderStConditionals(stripComments(node.content), {
        resolveCondition: (expression) => resolveConditionExpression(expression, globalVars, macroContext),
        transformText: (text) => processVarDeclarations(text, globalVars).cleaned,
        warn,
      }),
    );
  }

  if (globalVars.size > 0) {
    log.info(`[ST Preset Engine] Collected ${globalVars.size} variable(s) from enabled nodes`);
  }

  const resolved: ResolvedNode[] = [];
  let htmlWarningCount = 0;

  for (const node of nodes) {
    let content = node.content;

    if (node.is_marker) {
      resolved.push({
        identifier: node.identifier,
        name: node.name,
        role: mapStRole(node.role),
        content: "",
        is_marker: true,
        is_enabled: node.is_enabled,
        is_comment: false,
        node_order: node.node_order,
        injection_position: node.injection_position,
        injection_depth: node.injection_depth,
        injection_order: node.injection_order,
        hasHtmlWarning: false,
      });
      continue;
    }

    // Disabled or comment-only nodes are included in output (for UI tracking) but not processed
    if (!node.is_enabled || node.is_comment) {
      resolved.push({
        identifier: node.identifier,
        name: node.name,
        role: mapStRole(node.role),
        content,
        is_marker: false,
        is_enabled: node.is_enabled,
        is_comment: node.is_comment,
        node_order: node.node_order,
        injection_position: node.injection_position,
        injection_depth: node.injection_depth,
        injection_order: node.injection_order,
        hasHtmlWarning: false,
      });
      continue;
    }

    content = resolveValueMacros(selectedText.get(node) ?? "", globalVars, macroContext, expandedContentMacros);

    content = processRandom(content);

    content = processRoll(content);

    content = applyCompatibilityPatches(content, macroContext.userName, macroContext.charName);

    // Trim runs last because earlier macro expansions must finish first.
    const { result: trimmedContent, isEmpty } = processTrim(content);
    content = trimmedContent;

    const hasHtml = content.length > 0 && detectHtmlContent(content);
    if (hasHtml) htmlWarningCount++;

    resolved.push({
      identifier: node.identifier,
      name: node.name,
      role: mapStRole(node.role),
      content,
      is_marker: false,
      is_enabled: !isEmpty,
      is_comment: false,
      node_order: node.node_order,
      injection_position: node.injection_position,
      injection_depth: node.injection_depth,
      injection_order: node.injection_order,
      hasHtmlWarning: hasHtml,
    });
  }

  if (htmlWarningCount > 0) {
    log.warn(`[ST Preset Engine] ${htmlWarningCount} node(s) contain HTML content (may render poorly in Discord)`);
  }

  return { resolved, expandedContentMacros };
}
