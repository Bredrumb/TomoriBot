import { spyOn } from "bun:test";
import * as openrouterSpeech from "@/providers/openrouter/openrouterSpeech";

const settleOpenRouterSpeechCost = openrouterSpeech.settleOpenRouterSpeechCost;

export function settleSpeechCostImmediately() {
  const spy = spyOn(openrouterSpeech, "settleOpenRouterSpeechCost").mockImplementation((apiKey, model, generationId) =>
    settleOpenRouterSpeechCost(apiKey, model, generationId, [0]),
  );
  return {
    settled: async () => {
      await Promise.all(spy.mock.results.map((result) => result.value));
    },
    mockRestore: () => spy.mockRestore(),
  };
}
