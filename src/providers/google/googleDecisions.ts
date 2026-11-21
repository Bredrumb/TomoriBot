import type { ProviderDecisionRequest } from "@/types/provider/featureInterfaces";
import {
  encodeNamedDecisionQuestions,
  executeDecisionTransport,
  parseNamedDecisionAnswers,
} from "@/providers/utils/decisions";

export async function callGoogleDecisions(
  request: ProviderDecisionRequest,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
) {
  return await executeDecisionTransport(request, {
    url: "https://generativelanguage.googleapis.com/v1beta/decisions",
    body: { model: request.model, input: request.evidence, questions: encodeNamedDecisionQuestions(request) },
    fetch: fetchImpl,
    parseAnswers: (payload) => parseNamedDecisionAnswers(payload, request),
  });
}
