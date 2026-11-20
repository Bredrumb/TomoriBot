// Map legacy llms FK rows to deepseek-flash because DeepSeek rejects or retired those codenames.
const DEEPSEEK_API_MODEL_ALIASES: Readonly<Record<string, string>> = {
  "deepseek-chat": "deepseek-flash",
  "deepseek-reasoner": "deepseek-flash",
  "deepseek-v4-flash": "deepseek-flash",
  "deepseek-v4-flash-vision": "deepseek-flash",
  "deepseek-v4-flash-vision-exp": "deepseek-flash",
};

export function toDeepseekApiModelName(model: string): string {
  const trimmed = model.trim();
  return DEEPSEEK_API_MODEL_ALIASES[trimmed] ?? trimmed;
}
