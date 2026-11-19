import { ThinkingLevel } from "@google/genai";
import type { LlmRow, TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import type { ChatIncoming, ToolHistoryEntry } from "@/utils/chat/types";
import { log } from "@/utils/misc/logger";
import { providerUsesApiFamily } from "@/utils/provider/providerInfoRegistry";
import { buildBotSpeakerLabelPattern } from "@/utils/text/processors/regexUtils";
import { buildGoogleThinkingConfig } from "@/utils/provider/thinkingControl";
import {
  providerPrefixCompletionExcludesTools,
  providerRequiresPrefixCompletion,
} from "@/providers/utils/strictChatCompat";
import { resolveToolsEnabled } from "@/utils/tools/toolUseGate";

export const ASSISTANT_PREFILL_MAX_LENGTH = 2000;

// `continuation` holds already-posted model output from a failed attempt, so callers must not expand it as a
// template.
export type PrefillSource = "manual" | "server" | "continuation";
export type PrefillMode = "native" | "instruction" | "skip";

export type PrefillBlocker = "model" | "thinking" | "tools";

// Tool macros in text stay unexpanded here because they resolve per provider and fallback attempts may switch
// providers.
export interface TurnPrefill {
  text: string;
  source: PrefillSource;
}

interface PrefillCapabilityState {
  llm: Pick<
    LlmRow,
    "llm_provider" | "llm_codename" | "has_tools" | "supports_prefix_completion" | "supports_assistant_prefill"
  >;
  config: Pick<TomoriState["config"], "thinking_level" | "tool_use_enabled">;
}

// Server prefill skips non-persona turns (just as system prompt skips impersonation), because those replies are not
// the persona answering chat.
export function selectTurnPrefillText(
  incoming: Pick<
    ChatIncoming,
    | "manualPrefill"
    | "isUserImpersonation"
    | "reasoningQuery"
    | "reminderRecipientID"
    | "reminderData"
    | "sceneTurn"
    | "isStopResponse"
  >,
  serverPrefill: string | null | undefined,
): { text: string; source: PrefillSource } | null {
  const manual = incoming.manualPrefill?.trim();
  if (manual) return { text: manual, source: "manual" };

  const server = serverPrefill?.trim();
  if (!server) return null;
  if (
    incoming.isUserImpersonation ||
    incoming.reasoningQuery ||
    incoming.reminderRecipientID ||
    incoming.reminderData ||
    incoming.sceneTurn ||
    incoming.isStopResponse
  ) {
    return null;
  }
  return { text: server, source: "server" };
}

// Pre-gated because unlisted models silently ignore prefill and Gemini leaks non-minimal thinking as visible text
// when a prefill is present.
export function resolvePrefillBlocker(state: PrefillCapabilityState, forceReason?: boolean): PrefillBlocker | null {
  const { llm } = state;
  if (llm.llm_provider === "novelai") return null;
  if (providerPrefixCompletionExcludesTools(llm.llm_provider) && resolveToolsEnabled(state, llm.has_tools)) {
    return "tools";
  }
  if (providerRequiresPrefixCompletion(llm.llm_provider) || llm.supports_prefix_completion) return null;
  if (!llm.supports_assistant_prefill) return "model";

  if (providerUsesApiFamily(llm.llm_provider, "google-genai")) {
    const thinking = buildGoogleThinkingConfig(llm.llm_codename, state.config.thinking_level, forceReason);
    const thinkingOff = thinking?.thinkingBudget === 0 || thinking?.thinkingLevel === ThinkingLevel.MINIMAL;
    if (!thinkingOff) return "thinking";
  }
  return null;
}

export function resolvePrefillMode(source: PrefillSource, blocker: PrefillBlocker | null): PrefillMode {
  if (!blocker) return "native";
  return source === "server" ? "skip" : "instruction";
}

const TRAILING_OWN_MESSAGE_DIRECTIVE =
  "Your own message above is the latest one in the chat and has already been sent. Write your next message without repeating it.";

// Must run per attempt because fallback models differ on prefill support, and adapters rely on exact outputPrefill
// equality for prefix:true and echo stripping.
export async function applyAssistantPrefill(args: {
  contextItems: StructuredContextItem[];
  prefill: TurnPrefill | null;
  tomoriState: TomoriState;
  forceReason?: boolean;
}): Promise<{ contextItems: StructuredContextItem[]; outputPrefill: string | undefined }> {
  const applied = await applyTurnPrefill(args);
  if (
    args.tomoriState.llm.llm_provider === "novelai" ||
    applied.contextItems.at(-1)?.role !== "model" ||
    endsWithNativePrefill(applied.contextItems, applied.outputPrefill)
  ) {
    return applied;
  }

  const { buildTailDirectiveMessage } = await import("@/utils/chat/contextAnnotations");
  const directive = buildTailDirectiveMessage(TRAILING_OWN_MESSAGE_DIRECTIVE);
  return directive ? { ...applied, contextItems: [...applied.contextItems, directive] } : applied;
}

async function applyTurnPrefill(args: Parameters<typeof applyAssistantPrefill>[0]): Promise<{
  contextItems: StructuredContextItem[];
  outputPrefill: string | undefined;
}> {
  if (!args.prefill) return { contextItems: args.contextItems, outputPrefill: undefined };

  const llm = args.tomoriState.llm;
  const blocker = resolvePrefillBlocker(args.tomoriState, args.forceReason);
  const mode = resolvePrefillMode(args.prefill.source, blocker);
  if (mode === "skip") {
    log.warn(
      `Server response prefill skipped: ${llm.llm_provider}:${llm.llm_codename} cannot continue a prefill (${blocker}).`,
    );
    return { contextItems: args.contextItems, outputPrefill: undefined };
  }

  // Lazy so the config panel can import the capability checks above without the tool registry and
  // context builder graphs, which the command loader must not pull in at module evaluation.
  const [{ createToolPromptMacroResolverForState }, { buildTailDirectiveMessage }] = await Promise.all([
    import("@/utils/tools/toolPromptMacros"),
    import("@/utils/chat/contextAnnotations"),
  ]);
  const text =
    args.prefill.source === "continuation"
      ? args.prefill.text.trim()
      : (await createToolPromptMacroResolverForState(args.tomoriState).expand(args.prefill.text)).trim();
  if (!text) return { contextItems: args.contextItems, outputPrefill: undefined };

  const botName = args.tomoriState.persona_nickname || process.env.DEFAULT_BOTNAME || "Tomori";
  // A prefill that already names the speaker keeps its sprite label but takes the real name,
  // because nothing expands `{bot}` on this path.
  const label = text.match(buildBotSpeakerLabelPattern(botName));
  const outputPrefill = label
    ? `${botName}${label[1]}: ${text.slice(label[0].length)}`.trimEnd()
    : `${botName}: ${text}`;

  if (mode === "native") {
    return {
      contextItems: [
        ...args.contextItems,
        {
          role: "model",
          completionText: outputPrefill,
          parts: [{ type: "text", text: outputPrefill }],
          metadataTag: ContextItemTag.DIALOGUE_HISTORY,
        },
      ],
      outputPrefill,
    };
  }

  // A continuation is already in the channel, so the model is not asked to echo it: the echo strip
  // matches character by character, and one divergence in a long echo reposts the whole reply.
  const directive = buildTailDirectiveMessage(
    args.prefill.source === "continuation"
      ? `Your reply was cut off after you had already sent this part: "${text}". That part is already in the chat, so write only what comes after it and do not repeat any of it.`
      : `Begin your next reply with: "${outputPrefill}". Continue directly after it without repeating the prefix.`,
  );
  return { contextItems: directive ? [...args.contextItems, directive] : args.contextItems, outputPrefill };
}

function endsWithNativePrefill(contextItems: StructuredContextItem[], outputPrefill: string | undefined): boolean {
  const trailing = contextItems.at(-1);
  const trailingText =
    trailing?.parts.length === 1 && trailing.parts[0].type === "text" ? trailing.parts[0].text : null;
  return Boolean(outputPrefill) && trailing?.role === "model" && trailingText === outputPrefill;
}

// Native prefill must remain the final context item, so strict backends treat it as a continuation and
// foldPrefillIntoToolHistory still finds it.
export function insertBeforeNativePrefill(
  contextItems: StructuredContextItem[],
  outputPrefill: string | undefined,
  item: StructuredContextItem,
): StructuredContextItem[] {
  return endsWithNativePrefill(contextItems, outputPrefill)
    ? [...contextItems.slice(0, -1), item, ...contextItems.slice(-1)]
    : [...contextItems, item];
}

// Must return new arrays so key-rotation retries keep the trailing prefill, because folding avoids consecutive
// assistant turns that Gemini rejects.
export function foldPrefillIntoToolHistory(
  contextItems: StructuredContextItem[],
  outputPrefill: string | undefined,
  functionHistory: ToolHistoryEntry[],
): { contextItems: StructuredContextItem[]; functionHistory: ToolHistoryEntry[] } {
  const [first, ...rest] = functionHistory;
  if (!first || !outputPrefill || !endsWithNativePrefill(contextItems, outputPrefill)) {
    return { contextItems, functionHistory };
  }

  return {
    contextItems: contextItems.slice(0, -1),
    functionHistory: [
      {
        ...first,
        preToolCallTextParts: [{ type: "text", text: outputPrefill }, ...(first.preToolCallTextParts ?? [])],
      },
      ...rest,
    ],
  };
}
