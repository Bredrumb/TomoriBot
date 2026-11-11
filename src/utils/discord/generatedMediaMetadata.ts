import { escapeMarkdown } from "discord.js";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { localizer } from "@/utils/text/localizer";
import type { GeneratedMediaSource } from "@/types/provider/generationModels";
export type { GeneratedMediaSource } from "@/types/provider/generationModels";

export function buildGeneratedMediaSourceLine(locale: string, source: GeneratedMediaSource): string {
  return localizer(locale, "tools.media.generation_source_line", {
    provider: escapeMarkdown(getProviderDisplayName(source.provider, locale)),
    model: `\`${escapeMarkdown(source.model)}\``,
  });
}
