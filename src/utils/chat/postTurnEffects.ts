import type { ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";

export async function runPostTurnEffects(context: ChatTurnContext, result: GenerationTurnResult): Promise<void> {
  void context;
  void result;
}
