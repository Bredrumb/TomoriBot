const ZAI_TOP_P_DECIMAL_PLACES = 2;

export function normalizeZaiRequestSamplingParams(requestBody: Record<string, unknown>): void {
  if (typeof requestBody.top_p === "number" && Number.isFinite(requestBody.top_p)) {
    requestBody.top_p = roundZaiTopP(requestBody.top_p);
  }
}

export function roundZaiTopP(topP: number): number {
  const scale = 10 ** ZAI_TOP_P_DECIMAL_PLACES;
  return Math.round((topP + Number.EPSILON) * scale) / scale;
}
