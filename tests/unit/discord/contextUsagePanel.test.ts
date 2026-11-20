import { beforeAll, describe, expect, it } from "bun:test";
import { AttachmentBuilder } from "discord.js";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { buildContextUsagePayload } from "@/utils/discord/ui/contextUsagePanel";
import { truncateDialogueHistory } from "@/utils/text/contextTruncator";
import { hasLocaleKey, initializeLocalizer } from "@/utils/text/localizer";
import type { PromptInspection } from "@/utils/text/promptInspection/assemble";
import { CONTEXT_GRID_COLUMNS, CONTEXT_GRID_ROWS } from "@/utils/text/promptInspection/contextUsage";
import { deliverPromptSnapshot } from "@/utils/text/promptInspection/delivery";
import { charsToTokensJson, getMcpToolSchemaFraction } from "@/utils/text/tokenEstimate";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import {
  collectCaseFailures,
  expectForEveryLocale,
  localizedCopy,
  localizedProse,
  RUNTIME_LOCALES,
} from "../../helpers/localeCases";
import { collectTextDisplays } from "../../helpers/panelLimits";

beforeAll(async () => initializeLocalizer());

describe("buildContextUsagePayload legend", () => {
  it("renders scale line and circle description as separate blockquoted lines when circles are present", () => {
    const cases = collectCaseFailures();
    const persona = createPersona();
    const inspection = {
      selectedPersona: persona,
      answeringState: persona,
      providerName: "google",
      modelName: "gemini-2.5-pro",
      channelId: "123456789012345678",
      channelName: "general",
      presetName: null,
      capturedAt: new Date(0).toISOString(),
      // 1 item of 4 chars (1 token) in a 1,000,000 token window creates a sub-cell segment represented by a circle
      contextItems: [
        {
          role: "system" as const,
          parts: [{ type: "text" as const, text: "test" }],
          metadataTag: ContextItemTag.SYSTEM_HUMANIZER_RULES,
        },
      ],
      toolsData: null,
      mcpToolSchemaFraction: 0,
      budget: { contextLength: 1_000_000, outputReserve: 8192 },
      truncation: null,
    };

    for (const locale of RUNTIME_LOCALES) {
      cases.check(locale, () => {
        const payload = buildContextUsagePayload(locale, inspection, false);
        const textDisplays = collectTextDisplays(payload);
        const circleExpected = `> ${localizedCopy(locale, "commands.context.circle_line")}`;
        const legendText = textDisplays.find((text) => text.includes(circleExpected));
        expect(legendText).toBeDefined();

        if (legendText) {
          const lines = legendText.split("\n");
          for (const line of lines) {
            expect(line.startsWith("> ")).toBe(true);
          }
          expect(lines).toContain(circleExpected);
        }
      });
    }
    cases.expectNoFailures();
  });

  it("omits circle description when every segment fills at least one cell", () => {
    const cases = collectCaseFailures();
    const persona = createPersona();
    const inspection = {
      selectedPersona: persona,
      answeringState: persona,
      providerName: "google",
      modelName: "gemini-2.5-pro",
      channelId: "123456789012345678",
      channelName: "general",
      presetName: null,
      capturedAt: new Date(0).toISOString(),
      contextItems: [
        {
          role: "system" as const,
          parts: [{ type: "text" as const, text: "x".repeat(400) }],
          metadataTag: ContextItemTag.SYSTEM_HUMANIZER_RULES,
        },
      ],
      toolsData: null,
      mcpToolSchemaFraction: 0,
      budget: { contextLength: 1000, outputReserve: 100 },
      truncation: null,
    };

    for (const locale of RUNTIME_LOCALES) {
      cases.check(locale, () => {
        const payload = buildContextUsagePayload(locale, inspection, false);
        const textDisplays = collectTextDisplays(payload);
        const circleText = localizedCopy(locale, "commands.context.circle_line");
        const hasCircleLine = textDisplays.some((text) => text.includes(circleText));
        expect(hasCircleLine).toBe(false);
      });
    }
    cases.expectNoFailures();
  });
});

it("shows definition costs and actual cuts on the panel and keeps cut history out of the snapshot", async () => {
  const persona = createPersona({
    llm: createLlmRow({ llm_provider: "openrouter", llm_codename: "inspection-budget", context_window: 1000 }),
    config: { llm_max_output_tokens: 100 },
  });
  const oldestText = "Old exchange".padEnd(400, "x");
  const latestText = "Latest request".padEnd(2340, "x");
  const item = (metadataTag: ContextItemTag, text: string, role: StructuredContextItem["role"]) => ({
    metadataTag,
    role,
    parts: [{ type: "text" as const, text }],
  });
  const emoji = item(ContextItemTag.KNOWLEDGE_SERVER_EMOJIS, ":smile: (Shows joy)".padEnd(40, "x"), "system");
  const sticker = item(ContextItemTag.KNOWLEDGE_SERVER_STICKERS, '"Wave" (Greeting)'.padEnd(80, "x"), "system");
  const oldHistory = Array.from({ length: 6 }, (_, i) =>
    item(ContextItemTag.DIALOGUE_HISTORY, oldestText, i % 2 ? "model" : "user"),
  );
  const latest = item(ContextItemTag.DIALOGUE_HISTORY, latestText, "user");
  const { report, truncated } = truncateDialogueHistory([emoji, sticker, ...oldHistory, latest], 1000, 100, [], 20);
  const locale = "en-US";
  const inspection: PromptInspection = {
    selectedPersona: persona,
    answeringState: persona,
    providerName: "openrouter",
    modelName: persona.llm.llm_codename,
    channelId: "123456789012345678",
    channelName: "general",
    presetName: null,
    capturedAt: new Date(0).toISOString(),
    contextItems: truncated,
    toolsData: null,
    mcpToolSchemaFraction: 0,
    budget: { contextLength: 1000, outputReserve: 100 },
    truncation: report,
  };
  expectForEveryLocale((runtimeLocale) => {
    const number = new Intl.NumberFormat(runtimeLocale);
    const share = new Intl.NumberFormat(runtimeLocale, { style: "percent" }).format(1.5);
    const text = collectTextDisplays(buildContextUsagePayload(runtimeLocale, inspection, false)).join("\n");
    const copyLocale = (key: string) => (hasLocaleKey(runtimeLocale, key) ? runtimeLocale : locale);
    const copy = (key: string) => localizedCopy(copyLocale(key), key);
    expect(text).toContain(copy("commands.context.fit_title"));
    for (const [key, tokens] of [
      ["commands.context.segment_emoji_definitions", 10],
      ["commands.context.segment_sticker_definitions", 20],
    ] as const) {
      expect(text).toMatch(
        localizedProse(copyLocale("commands.context.legend_detail_line"), "commands.context.legend_detail_line", {
          label: copy(key),
          tokens: number.format(tokens),
        }),
      );
    }
    expect(text).toMatch(
      localizedProse(copyLocale("commands.context.fit_input_budget"), "commands.context.fit_input_budget", {
        before: number.format(1215),
        after: number.format(615),
        budget: number.format(810),
        share,
      }),
    );
    expect(text).toMatch(localizedProse(runtimeLocale, "commands.context.truncated_note", { count: number.format(3) }));
  });
  for (const format of ["text", "json"] as const) {
    await deliverPromptSnapshot({
      inspection,
      format,
      guildId: "123456789012345679",
      locale,
      includeRerunHints: true,
      async editReply(options) {
        const card = collectTextDisplays(options.components).join("\n");
        expect(card).toContain(localizedCopy(locale, "commands.context.fit_title"));
        expect(card).toMatch(localizedProse(locale, "commands.tool.prompt.snapshot.file_scope_note"));
        expect(card).not.toContain(localizedCopy(locale, "commands.tool.prompt.snapshot.file_scope_note"));
        expect(card).toContain(localizedCopy(locale, "commands.context.truncated_note", { count: 3 }));
        expect(card).toMatch(
          localizedProse(locale, "commands.context.fit_input_budget", {
            before: "1,215",
            after: 615,
            budget: 810,
            share: "150%",
          }),
        );
        const attachment = options.files?.[0];
        if (!(attachment instanceof AttachmentBuilder) || !Buffer.isBuffer(attachment.attachment)) {
          throw new Error("Snapshot did not attach a buffer");
        }
        const text = attachment.attachment.toString("utf8");
        expect(text).toContain(latestText);
        expect(text).not.toContain(oldestText);
      },
    });
  }
  const oversized = item(ContextItemTag.SYSTEM_PERSONA_PROMPT, "x".repeat(4800), "system");
  const overflow = truncateDialogueHistory([oversized, latest], 1000, 100, [], 20);
  const overflowSummary = collectTextDisplays(
    buildContextUsagePayload(
      locale,
      {
        ...inspection,
        contextItems: overflow.truncated,
        truncation: overflow.report,
      },
      false,
    ),
  ).join("\n");
  expect(overflowSummary).toMatch(localizedProse(locale, "commands.context.fit_over_budget", { tokens: 975 }));
  expect(overflowSummary).not.toMatch(localizedProse(locale, "commands.context.truncated_note", { count: 0 }));
});

it("warns when tool schemas put a text prompt that fit over the input budget", () => {
  const persona = createPersona({
    llm: createLlmRow({ llm_provider: "custom", llm_codename: "local-chat", has_tools: true }),
    config: { llm_max_output_tokens: 2048, custom_num_ctx: 8192 },
  });
  const budget = { contextLength: 8192, outputReserve: 2048 };
  const { report, truncated } = truncateDialogueHistory(
    [
      {
        role: "user",
        metadataTag: ContextItemTag.DIALOGUE_HISTORY,
        parts: [{ type: "text", text: "text".repeat(4100) }],
      },
    ],
    budget.contextLength,
    budget.outputReserve,
  );
  const toolsData = [
    { type: "function", function: { name: "web_search", description: "Look up public information." } },
    {
      type: "function",
      function: {
        name: "weather",
        description: "Look up a forecast for the selected location. ".repeat(200),
      },
    },
  ];
  const mcpToolSchemaFraction = getMcpToolSchemaFraction(toolsData, ["weather"]);
  const inspection: PromptInspection = {
    selectedPersona: persona,
    answeringState: persona,
    providerName: "custom",
    modelName: persona.llm.llm_codename,
    channelId: "123456789012345678",
    channelName: "general",
    presetName: null,
    capturedAt: new Date(0).toISOString(),
    contextItems: truncated,
    budget,
    truncation: report,
    toolsData,
    mcpToolSchemaFraction,
  };
  const locale = "en-US";
  const withTools = collectTextDisplays(buildContextUsagePayload(locale, inspection, false));
  const withoutTools = collectTextDisplays(
    buildContextUsagePayload(locale, { ...inspection, toolsData: [], mcpToolSchemaFraction: 0 }, false),
  ).join("\n");
  const allToolTokens = charsToTokensJson(JSON.stringify(toolsData).length);
  const mcpTokens = Math.round(allToolTokens * mcpToolSchemaFraction);
  const excess = allToolTokens + report.inputTokensAfter - report.inputBudget;
  expect(excess).toBeGreaterThan(0);
  const warningVars = { tokens: new Intl.NumberFormat(locale).format(excess) };
  const summary = withTools.find((content) => content.includes(localizedCopy(locale, "commands.context.fit_title")));
  expect(summary).toMatch(localizedProse(locale, "commands.context.fit_over_budget_with_tools", warningVars));
  const grid = withTools.find((content) => content.split("\n").length === CONTEXT_GRID_ROWS);
  expect(grid?.split("\n").map((row) => Array.from(row).length)).toEqual(
    Array<number>(CONTEXT_GRID_ROWS).fill(CONTEXT_GRID_COLUMNS),
  );
  for (const [key, tokens] of [
    ["commands.context.segment_builtin_tools", allToolTokens - mcpTokens],
    ["commands.context.segment_mcp_tools", mcpTokens],
  ] as const) {
    const count = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(tokens);
    expect(withTools.join("\n")).toMatch(
      localizedProse(locale, "commands.context.legend_detail_line", {
        label: localizedCopy(locale, key),
        tokens: count,
      }),
    );
  }
  expect(withoutTools).not.toContain(localizedCopy(locale, "commands.context.fit_title"));
  expect(withoutTools).not.toContain(localizedCopy(locale, "commands.context.segment_mcp_tools"));
});
