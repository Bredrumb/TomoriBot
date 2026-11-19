import type { StPresetNodeRow } from "@/types/db/schema";
import { findUnsupportedPresetMacros } from "@/utils/text/stPresetEngine";

export const MAX_PRESET_FILE_SIZE_MB = 2;

export const MAX_PRESET_NAME_LENGTH = 100;
const LEGACY_POST_HISTORY_INJECTION_ORDER = 10_000;
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
const LEGACY_STORY_TRIM_REGEX = /\{\{trim\}\}/gi;
const LEGACY_STORY_BLOCK_REGEX = /\{\{#if\s+([a-zA-Z_][\w]*)\}\}([\s\S]*?)\{\{\/if\}\}/gi;

// Matches SillyTavern nodes with only `{{// comment}}` blocks and `{{trim}}` macros, since both resolve to empty
// output.
const COMMENT_ONLY_REGEX = /^(\s*\{\{\/\/[^}]*\}\}\s*|\s*\{\{trim\}\}\s*)+$/;

interface RawSTPromptNode {
  identifier: string;
  name: string;
  role?: string;
  content?: string;
  system_prompt?: boolean;
  marker?: boolean;
  enabled?: boolean;
  injection_position?: number;
  injection_depth?: number;
  injection_order?: number;
  forbid_overrides?: boolean;
}

interface RawSTPromptOrderEntry {
  identifier: string;
  enabled: boolean;
}

export interface RawSTPreset {
  prompts?: RawSTPromptNode[];
  prompt_order?: {
    character_id: number;
    order: RawSTPromptOrderEntry[];
  }[];
  [key: string]: unknown;
}

export interface ParseResult {
  nodes: Omit<StPresetNodeRow, "node_id" | "preset_id">[];
  commentOnlyCount: number;
  disabledByPreset: number;
  sourceKind: "modern" | "legacy_text_completion";
}

type JsonObject = Record<string, unknown>;
type PresetSourceKind = "modern" | "legacy_text_completion";

export interface NormalizedPresetShape {
  preset: RawSTPreset;
  sourceKind: PresetSourceKind;
}

export class InvalidPresetIntegerError extends Error {
  constructor(
    readonly promptName: string,
    readonly field: string,
  ) {
    super(`Invalid ${field} in prompt ${promptName}`);
  }
}

function presetInteger(rawValue: unknown, fallback: number, prompt: RawSTPromptNode, field: string): number {
  if (rawValue === undefined || rawValue === null) return fallback;
  // Hand-edited and third-party presets sometimes quote whole numbers, which imported before this
  // validation existed, so only strings that are not a whole number are rejected.
  const value = typeof rawValue === "string" && /^\s*-?\d+\s*$/.test(rawValue) ? Number(rawValue) : rawValue;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new InvalidPresetIntegerError(String(prompt.name || prompt.identifier), field);
  }
  if (field === "injection_position" && value !== 0 && value !== 1) {
    throw new InvalidPresetIntegerError(String(prompt.name || prompt.identifier), field);
  }
  return Math.min(INT32_MAX, Math.max(INT32_MIN, value));
}

export function validateAttachment(
  filename: string,
  contentType?: string | null,
): {
  isValid: boolean;
  errorKey?: string;
} {
  const lowerFilename = filename.toLowerCase();

  if (!lowerFilename.endsWith(".json")) {
    return { isValid: false, errorKey: "invalid_format" };
  }

  // Discord may omit attachment contentType, so skip the MIME check when absent.
  if (contentType && !contentType.includes("json")) {
    return { isValid: false, errorKey: "invalid_format" };
  }

  return { isValid: true };
}

export function isCommentOnly(content: string): boolean {
  return COMMENT_ONLY_REGEX.test(content.trim());
}

export function derivePresetName(filename: string): string {
  const name = filename
    .trim()
    .replace(/\.json$/i, "")
    .trim();
  return name.length > MAX_PRESET_NAME_LENGTH ? name.slice(0, MAX_PRESET_NAME_LENGTH) : name;
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonObject;
}

function getStringField(obj: JsonObject | null, key: string): string | null {
  if (!obj) {
    return null;
  }

  const value = obj[key];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeLegacyStorySegment(content: string): string {
  return content.replace(LEGACY_STORY_TRIM_REGEX, "");
}

function hasMeaningfulLegacyStorySegment(content: string): boolean {
  return sanitizeLegacyStorySegment(content).trim().length > 0;
}

function createLegacyContentNode(identifier: string, name: string, content: string): RawSTPromptNode | null {
  const sanitizedContent = sanitizeLegacyStorySegment(content);
  if (sanitizedContent.trim().length === 0) {
    return null;
  }

  return {
    identifier,
    name,
    role: "system",
    content: sanitizedContent,
    enabled: true,
  };
}

function createLegacyMarkerNode(identifier: string, name: string): RawSTPromptNode {
  return {
    identifier,
    name,
    role: "system",
    marker: true,
    enabled: true,
  };
}

function buildLegacyTextCompletionPreset(raw: RawSTPreset): NormalizedPresetShape | null {
  const root = asObject(raw);
  const context = asObject(root?.context);
  const sysprompt = asObject(root?.sysprompt);

  const storyString = getStringField(context, "story_string");
  const syspromptContent = getStringField(sysprompt, "content");
  if (!storyString || !syspromptContent) {
    return null;
  }

  const prompts: RawSTPromptNode[] = [];
  let contentNodeIndex = 0;
  const usedMarkers = new Set<string>();

  const addContentNode = (name: string, content: string) => {
    const identifierSuffix = contentNodeIndex;
    contentNodeIndex += 1;
    const identifier = `legacyTextContent_${identifierSuffix}`;
    const node = createLegacyContentNode(identifier, name, content);
    if (!node) {
      return;
    }

    prompts.push(node);
  };

  const addMarkerNode = (identifier: string, name: string) => {
    if (usedMarkers.has(identifier)) {
      return;
    }

    usedMarkers.add(identifier);
    prompts.push(createLegacyMarkerNode(identifier, name));
  };

  const insertPlaceholderNodes = (
    body: string,
    placeholder: string,
    prefixName: string,
    replacementNodes: RawSTPromptNode[],
    suffixName = prefixName,
  ) => {
    const lowerBody = body.toLowerCase();
    const lowerPlaceholder = placeholder.toLowerCase();
    const placeholderIndex = lowerBody.indexOf(lowerPlaceholder);
    if (placeholderIndex === -1) {
      addContentNode(prefixName, body);
      return;
    }

    const prefix = body.slice(0, placeholderIndex);
    const suffix = body.slice(placeholderIndex + placeholder.length);

    addContentNode(`${prefixName} Prefix`, prefix);
    for (const node of replacementNodes) {
      if (node.marker) {
        addMarkerNode(node.identifier, node.name);
      } else if (node.content) {
        addContentNode(node.name, node.content);
      }
    }
    addContentNode(`${suffixName} Suffix`, suffix);
  };

  let lastIndex = 0;
  for (const match of storyString.matchAll(LEGACY_STORY_BLOCK_REGEX)) {
    const matchIndex = match.index ?? 0;
    const precedingLiteral = storyString.slice(lastIndex, matchIndex);
    if (hasMeaningfulLegacyStorySegment(precedingLiteral)) {
      addContentNode("Legacy Story Text", precedingLiteral);
    }

    const blockKey = match[1]?.trim().toLowerCase();
    const blockBody = match[2] ?? "";

    switch (blockKey) {
      case "system":
        insertPlaceholderNodes(blockBody, "{{system}}", "Legacy System Prompt", [
          createLegacyMarkerNode("main", "Main System Prompt"),
          {
            identifier: "legacyImportedSystemPrompt",
            name: "Imported Legacy System Prompt",
            role: "system",
            content: syspromptContent,
            enabled: true,
          },
        ]);
        break;
      case "wibefore":
        insertPlaceholderNodes(blockBody, "{{wiBefore}}", "Legacy World Info Before", [
          createLegacyMarkerNode("worldInfoBefore", "World Info Before"),
        ]);
        break;
      case "wiafter":
        insertPlaceholderNodes(blockBody, "{{wiAfter}}", "Legacy World Info After", [
          createLegacyMarkerNode("worldInfoAfter", "World Info After"),
        ]);
        break;
      case "description":
        insertPlaceholderNodes(blockBody, "{{description}}", "Legacy Character Description", [
          createLegacyMarkerNode("charDescription", "Character Description"),
        ]);
        break;
      case "personality":
        insertPlaceholderNodes(blockBody, "{{personality}}", "Legacy Character Personality", [
          createLegacyMarkerNode("charPersonality", "Character Personality"),
        ]);
        break;
      case "mesexamples":
        insertPlaceholderNodes(blockBody, "{{mesExamples}}", "Legacy Example Dialogue", [
          createLegacyMarkerNode("dialogueExamples", "Example Dialogues"),
        ]);
        break;
      case "persona":
      case "scenario":
      case "anchorbefore":
      case "anchorafter":
        break;
      default:
        if (hasMeaningfulLegacyStorySegment(blockBody)) {
          addContentNode(`Legacy ${blockKey ?? "Story"} Block`, blockBody);
        }
        break;
    }

    lastIndex = matchIndex + match[0].length;
  }

  const trailingLiteral = storyString.slice(lastIndex);
  if (hasMeaningfulLegacyStorySegment(trailingLiteral)) {
    addContentNode("Legacy Story Tail", trailingLiteral);
  }

  addMarkerNode("chatHistory", "Chat History");

  if (prompts.length === 0) {
    return null;
  }

  return {
    preset: {
      ...raw,
      prompts,
      prompt_order: [
        {
          character_id: 100001,
          order: prompts.map((prompt) => ({
            identifier: prompt.identifier,
            enabled: prompt.enabled !== false,
          })),
        },
      ],
    },
    sourceKind: "legacy_text_completion",
  };
}

export function normalizePresetShape(raw: RawSTPreset): NormalizedPresetShape | null {
  if (Array.isArray(raw.prompts) && raw.prompts.length > 0) {
    return {
      preset: raw,
      sourceKind: "modern",
    };
  }

  return buildLegacyTextCompletionPreset(raw);
}

// Modern SillyTavern exports can still place legacy post-history fields outside `prompts`, so synthesize depth nodes
// for the pipeline.
function buildLegacyPromptNodes(raw: RawSTPreset, prompts: RawSTPromptNode[]): RawSTPromptNode[] {
  const root = asObject(raw);
  const sysprompt = asObject(root?.sysprompt);
  const context = asObject(root?.context);

  const existingDepthContents = new Set(
    prompts
      .filter((prompt) => prompt.marker !== true && (prompt.injection_position ?? 0) === 1)
      .map((prompt) => prompt.content?.trim())
      .filter((content): content is string => Boolean(content)),
  );
  const seenLegacyContents = new Set<string>();

  const candidates: Array<{
    content: string | null;
    identifier: string;
    name: string;
  }> = [
    {
      identifier: "legacyPostHistory",
      name: "Legacy Post-History",
      content: getStringField(root, "post_history"),
    },
    {
      identifier: "legacySyspromptPostHistory",
      name: "Legacy Sysprompt Post-History",
      content: getStringField(sysprompt, "post_history"),
    },
    {
      identifier: "legacyContextPostHistory",
      name: "Legacy Context Post-History",
      content: getStringField(context, "post_history"),
    },
  ];

  const legacyNodes: RawSTPromptNode[] = [];
  for (const candidate of candidates) {
    if (!candidate.content) {
      continue;
    }

    if (seenLegacyContents.has(candidate.content) || existingDepthContents.has(candidate.content)) {
      continue;
    }

    seenLegacyContents.add(candidate.content);
    legacyNodes.push({
      identifier: candidate.identifier,
      name: candidate.name,
      role: "system",
      content: candidate.content,
      enabled: true,
      injection_position: 1,
      injection_depth: 0,
      // Keep legacy post-history last among same-depth injections.
      injection_order: LEGACY_POST_HISTORY_INJECTION_ORDER,
    });
  }

  return legacyNodes;
}

export function parsePresetNodes(normalizedPreset: NormalizedPresetShape): ParseResult | null {
  const basePrompts = normalizedPreset.preset.prompts;
  if (!Array.isArray(basePrompts) || basePrompts.length === 0) {
    return null;
  }

  const legacyPromptNodes = buildLegacyPromptNodes(normalizedPreset.preset, basePrompts);
  const prompts = [...basePrompts, ...legacyPromptNodes];
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return null;
  }

  const promptMap = new Map<string, RawSTPromptNode>();
  for (const prompt of prompts) {
    if (prompt.identifier) {
      promptMap.set(prompt.identifier, prompt);
    }
  }

  // SillyTavern stores user-prompt order under character_id 100001 with system-prompt order 100000 as fallback.
  const promptOrders = normalizedPreset.preset.prompt_order;
  let orderEntries: RawSTPromptOrderEntry[] | null = null;

  if (Array.isArray(promptOrders)) {
    const userOrder = promptOrders.find((po) => po.character_id === 100001);
    const systemOrder = promptOrders.find((po) => po.character_id === 100000);
    const baseOrderEntries = userOrder?.order ?? systemOrder?.order ?? null;
    if (baseOrderEntries) {
      orderEntries = [
        ...baseOrderEntries,
        ...legacyPromptNodes.map((prompt) => ({
          identifier: prompt.identifier,
          enabled: prompt.enabled !== false,
        })),
      ];
    }
  }

  if (!orderEntries) {
    orderEntries = prompts.map((p) => ({
      identifier: p.identifier,
      enabled: p.enabled !== false,
    }));
  }

  const nodes: Omit<StPresetNodeRow, "node_id" | "preset_id">[] = [];
  let nodeOrder = 0;
  let commentOnlyCount = 0;
  let disabledByPreset = 0;

  for (const entry of orderEntries) {
    const prompt = promptMap.get(entry.identifier);
    if (!prompt) continue;

    const content = prompt.content ?? "";
    const isMarker = prompt.marker === true;

    // Comment-only nodes stay stored for the toggle UI so users see them, while never injecting even when enabled.
    const isComment = !isMarker && isCommentOnly(content);
    if (isComment) {
      commentOnlyCount++;
    }

    if (!isMarker && !isComment && !entry.enabled) {
      disabledByPreset++;
    }

    nodes.push({
      identifier: prompt.identifier,
      name: prompt.name ?? prompt.identifier,
      role: prompt.role ?? "system",
      content,
      is_marker: isMarker,
      is_enabled: entry.enabled,
      is_comment: isComment,
      node_order: nodeOrder++,
      injection_position: presetInteger(prompt.injection_position, 0, prompt, "injection_position"),
      injection_depth: presetInteger(prompt.injection_depth, 4, prompt, "injection_depth"),
      injection_order: presetInteger(prompt.injection_order, 100, prompt, "injection_order"),
    });
  }

  if (nodes.length === 0) return null;
  return {
    nodes,
    commentOnlyCount,
    disabledByPreset,
    sourceKind: normalizedPreset.sourceKind,
  };
}

export function collectUnsupportedEnabledMacros(nodes: Omit<StPresetNodeRow, "node_id" | "preset_id">[]): string[] {
  const labels = new Set<string>();

  for (const node of nodes) {
    if (!node.is_enabled || node.is_marker || node.is_comment) {
      continue;
    }

    for (const label of findUnsupportedPresetMacros(node.content)) {
      labels.add(label);
    }
  }

  return [...labels];
}
