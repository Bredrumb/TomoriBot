export class NovelAIPreparationError extends Error {
  constructor(
    readonly code:
      | "tokenizer_setup"
      | "input_complexity"
      | "context_overflow"
      | "subscription_unavailable"
      | "subscription_inactive"
      | "model_tier"
      | "xialong_opus"
      | "continuation_exhausted",
  ) {
    super(`NovelAI preparation failed: ${code}`);
    this.name = "NovelAIPreparationError";
  }
}
