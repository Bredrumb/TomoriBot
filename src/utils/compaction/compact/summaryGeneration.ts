import {
  generateConversationSummaryForProvider,
  generateRoleplaySummaryForProvider,
} from "@/providers/utils/providerFeatureExecutors";
import type { CompactSummaryMode } from "@/types/misc/compact";
import { log } from "@/utils/misc/logger";
import type { ConversationContext } from "./types";

export function buildConversationPrompt(params: {
  conversationText: string;
  imageReferences: ConversationContext["imageReferences"];
  supplementaryContext: string;
  additionalInstructions?: string;
}): { systemPrompt: string; userPrompt: string } {
  return buildPrompt({
    ...params,
    systemPrompt:
      "You are a skilled conversation analyst who creates clear, readable summaries of Discord conversations. " +
      "Your goal is to distill the conversation into a well-written, human-readable narrative that captures the essential elements: " +
      "key facts, relationships between participants, important decisions, ongoing tasks, and the overall flow of discussion. " +
      "Write in natural prose that's easy to understand, avoiding unnecessary jargon or robotic phrasing. " +
      "Be concise but thorough: every sentence should add value. Output plain text only.",
    finalInstruction: "\nPlease keep the summary under 3500 characters.",
  });
}

export function buildRoleplayPrompt(params: {
  conversationText: string;
  imageReferences: ConversationContext["imageReferences"];
  supplementaryContext: string;
  additionalInstructions?: string;
}): { systemPrompt: string; userPrompt: string } {
  return buildPrompt({
    ...params,
    systemPrompt:
      "You are a skilled storyteller who crafts clear, engaging summaries of roleplay scenes. " +
      "Analyze the roleplay narrative and produce a structured JSON summary that captures the scene and each character's current state. " +
      "Write with clarity and literary quality: your descriptions should paint a vivid picture while remaining concise. " +
      "Base every detail on what's actually present in the context; if something isn't shown, mark it as 'Unknown' or 'Not specified'. " +
      "Keep each field brief but evocative: think short phrases or 2-3 well-crafted sentences that tell the story.\n\n" +
      "The JSON structure should contain:\n" +
      "- overall_scene_summary: A narrative overview of the current scene, setting, atmosphere, and what's happening\n" +
      "- characters: An array where each character has name, current_goals, emotional_status, physical_status, appearance_clothing, and inventory",
  });
}

export async function generateCompactSummary(params: {
  summaryType: CompactSummaryMode;
  providerName: string;
  apiKey: string;
  model: string;
  endpointUrl?: string;
  context: ConversationContext;
  supplementaryContext: string;
  additionalInstructions?: string;
  analyzeImages: boolean;
}) {
  const promptBuilder = params.summaryType === "conversation" ? buildConversationPrompt : buildRoleplayPrompt;
  const prompt = promptBuilder({
    conversationText: params.context.conversationText,
    imageReferences: params.context.imageReferences,
    supplementaryContext: params.supplementaryContext,
    additionalInstructions: params.additionalInstructions,
  });
  log.info(`[Compact] ${params.summaryType} system prompt:\n${prompt.systemPrompt}`);
  log.info(`[Compact] ${params.summaryType} user prompt:\n${prompt.userPrompt}`);

  const images = params.analyzeImages
    ? params.context.imageReferences.map((img) => ({ url: img.url, mimeType: img.mimeType }))
    : undefined;

  return params.summaryType === "conversation"
    ? await generateConversationSummaryForProvider({
        providerName: params.providerName,
        apiKey: params.apiKey,
        model: params.model,
        endpointUrl: params.endpointUrl,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        images,
      })
    : await generateRoleplaySummaryForProvider({
        providerName: params.providerName,
        apiKey: params.apiKey,
        model: params.model,
        endpointUrl: params.endpointUrl,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        images,
      });
}

function buildPrompt(params: {
  systemPrompt: string;
  conversationText: string;
  imageReferences: ConversationContext["imageReferences"];
  supplementaryContext: string;
  additionalInstructions?: string;
  finalInstruction?: string;
}): { systemPrompt: string; userPrompt: string } {
  const sections = ["MAIN CONTEXT (chronological):", params.conversationText || "(no recent messages)"];
  if (params.imageReferences.length > 0) {
    sections.push("\nIMAGE REFERENCES:", params.imageReferences.map((img) => `${img.label}: ${img.source}`).join("\n"));
  }
  if (params.supplementaryContext) sections.push("\nSUPPLEMENTARY CONTEXT:", params.supplementaryContext);
  if (params.additionalInstructions) sections.push("\nADDITIONAL INSTRUCTIONS:", params.additionalInstructions);
  if (params.finalInstruction) sections.push(params.finalInstruction);
  return { systemPrompt: params.systemPrompt, userPrompt: sections.join("\n") };
}
