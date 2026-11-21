import { statusNote } from "@/utils/discord/ui/statusTitle";
import { localizer } from "@/utils/text/localizer";
import type { PromptInspection } from "@/utils/text/promptInspection/assemble";
import { measureToolSchemaTokens } from "@/utils/text/promptInspection/contextUsage";

export function buildPromptTrimmingSummary(locale: string, inspection: PromptInspection): string | null {
  const lines: string[] = [];
  const number = new Intl.NumberFormat(locale);
  const novelai = inspection.novelaiRequest?.report;
  if (novelai) {
    const { historyTurns, sampleTurns, memories } = novelai.trimmedCounts;
    if (historyTurns > 0) {
      lines.push(localizer(locale, "commands.context.fit_history_turns", { count: number.format(historyTurns) }));
    }
    if (sampleTurns > 0) {
      lines.push(localizer(locale, "commands.context.fit_sample_turns", { count: number.format(sampleTurns) }));
    }
    if (memories > 0) {
      lines.push(localizer(locale, "commands.context.fit_memories", { count: number.format(memories) }));
    }
    if (novelai.outputCap < novelai.desiredOutputCap) {
      lines.push(
        localizer(locale, "commands.context.fit_reply_cut", {
          requested: number.format(novelai.desiredOutputCap),
          available: number.format(novelai.outputCap),
        }),
      );
    }
    if (lines.length === 0) return null;
    const inputBudget = novelai.window - novelai.desiredOutputCap - novelai.framingReserve - novelai.sentenceReserve;
    lines.unshift(formatInputBudget(locale, number, novelai.inputTokensBefore, novelai.inputTokens, inputBudget));
  } else if (inspection.truncation) {
    const { historyPairsDropped, transcriptTrimmed, inputTokensBefore, inputTokensAfter, inputBudget } =
      inspection.truncation;
    if (historyPairsDropped > 0) {
      lines.push(localizer(locale, "commands.context.truncated_note", { count: number.format(historyPairsDropped) }));
    }
    if (transcriptTrimmed) {
      lines.push(localizer(locale, "commands.context.fit_transcript_trimmed"));
    }
    const excess = inputTokensAfter - Math.max(0, inputBudget);
    if (lines.length > 0 || excess > 0) {
      lines.unshift(formatInputBudget(locale, number, inputTokensBefore, inputTokensAfter, inputBudget));
    }
    const toolSchemaTokens = measureToolSchemaTokens(inspection.toolsData);
    if (toolSchemaTokens > 0 && excess + toolSchemaTokens > 0) {
      lines.push(
        localizer(locale, "commands.context.fit_over_budget_with_tools", {
          tokens: number.format(excess + toolSchemaTokens),
        }),
      );
    } else if (excess > 0) {
      lines.push(localizer(locale, "commands.context.fit_over_budget", { tokens: number.format(excess) }));
    }
  }

  if (lines.length === 0) return null;
  return [statusNote("warning", `**${localizer(locale, "commands.context.fit_title")}**`), ...lines].join("\n");
}

function formatInputBudget(
  locale: string,
  number: Intl.NumberFormat,
  before: number,
  after: number,
  budget: number,
): string {
  const values = {
    before: number.format(before),
    after: number.format(after),
    budget: number.format(Math.max(0, budget)),
  };
  if (budget <= 0) return localizer(locale, "commands.context.fit_input_no_budget", values);
  return localizer(locale, "commands.context.fit_input_budget", {
    ...values,
    share: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(before / budget),
  });
}
