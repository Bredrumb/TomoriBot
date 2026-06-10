import type { SceneTurnMetadata } from "@/utils/chat/types";

export function buildSceneTurnDirective(sceneTurn: SceneTurnMetadata): string {
  const speaker = sceneTurn.sequence[sceneTurn.turnIndex];
  const personaName = speaker?.personaName.trim() || "the selected character";
  const baseDirective = `Begin your next reply as ${personaName}. Write only this character's next message.`;
  const additionalInstructions = sceneTurn.additionalInstructions?.trim();

  return additionalInstructions ? `${additionalInstructions} ${baseDirective}` : baseDirective;
}

export function buildSceneTextQuotaTriggerKey(sceneTurn: SceneTurnMetadata): string {
  return `scene:${sceneTurn.commandId}:${sceneTurn.turnIndex}`;
}
