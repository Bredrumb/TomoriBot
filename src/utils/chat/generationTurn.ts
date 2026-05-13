import { runChatTurn } from "@/utils/chat/turnRunner";
import type { ChatResponseSink, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";

export async function runGenerationTurn(
  context: ChatTurnContext,
  responseSink: ChatResponseSink,
): Promise<GenerationTurnResult> {
  const incoming = context.turn.lockedTurn.admission.incoming;

  await runChatTurn(incoming);

  const result: GenerationTurnResult = {
    status: "completed",
    streamResults: [],
    personaResponses: [],
  };
  await responseSink.finalize(result);
  return result;
}
