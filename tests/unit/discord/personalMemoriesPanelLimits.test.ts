import { beforeAll, describe, expect, it } from "bun:test";
import { ComponentType, type StringSelectMenuComponentData } from "discord.js";
import type { PersonalMemoryRow } from "@/types/db/schema";
import { PrivacyLevel } from "@/types/db/schema";
import type { PanelReadStatus, PanelReceipt } from "@/types/discord/panel";
import type { PersonalMemoriesCategory } from "@/utils/discord/personalMemoriesPanelCatalog";
import {
  buildPersonalMemoriesPanelPayload,
  MAX_PERSONAL_MEMORY_PAGE_SIZE,
} from "@/utils/discord/ui/personalMemoriesPanel";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona } from "../../helpers/fixtures";
import { RUNTIME_LOCALES } from "../../helpers/localeCases";
import { expectSafePanelPayload } from "../../helpers/panelLimits";

beforeAll(async () => initializeLocalizer());

const REALISTIC_RECEIPT: PanelReceipt = {
  tone: "success",
  heading: "Personal Memory Action Completed Successfully",
  detail:
    "Personal memory operation completed. Your memory record #54321 has been updated and indexed with tags: preferences, tone, boundaries.",
  metadata: "trace: pmem-op-123456 | actor: 123456789012345678 | elapsed: 32ms",
};

function makePersonalMemory(id: number, overrides: Partial<PersonalMemoryRow> = {}): PersonalMemoryRow {
  return {
    personal_memory_id: id,
    user_id: "user-1",
    persona_lineage_id: 100,
    content: `Personal memory sample content #${id} with realistic user context and phrasing.`,
    tags: ["preference", "interaction-style"],
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as PersonalMemoryRow;
}

describe("PersonalMemoriesPanel Limits & Boundary Sweeps", () => {
  it("conforms to Discord Components V2 protocol limits across the full state axis sweep", () => {
    const memorySizes = [
      0,
      1,
      MAX_PERSONAL_MEMORY_PAGE_SIZE - 1,
      MAX_PERSONAL_MEMORY_PAGE_SIZE,
      MAX_PERSONAL_MEMORY_PAGE_SIZE + 1,
      MAX_PERSONAL_MEMORY_PAGE_SIZE * 3,
    ];
    const personaSizes = [0, 1, 24, 25, 26, 75];
    const stmCounts = [0, 1, 10, 50];
    const categories: PersonalMemoriesCategory[] = ["global", "persona"];
    const readStatuses: PanelReadStatus[] = ["fresh", "stale", "unavailable"];
    const receipts: (PanelReceipt | undefined)[] = [undefined, REALISTIC_RECEIPT];
    const privacyLevels = [PrivacyLevel.MINIMAL, PrivacyLevel.FULL];

    for (const locale of RUNTIME_LOCALES) {
      for (const receipt of receipts) {
        for (const readStatus of readStatuses) {
          for (const category of categories) {
            for (const privacyLevel of privacyLevels) {
              // Sweep memory collection sizes
              for (const size of memorySizes) {
                const memories = Array.from({ length: size }, (_, i) =>
                  makePersonalMemory(i + 1, { persona_lineage_id: category === "global" ? 0 : 100 }),
                );
                const personas = [createPersona({ persona_nickname: "Main Persona" })];

                expectSafePanelPayload(
                  buildPersonalMemoriesPanelPayload({
                    locale,
                    category,
                    selectedLineageId: category === "global" ? 0 : 100,
                    personas,
                    memories,
                    stmCount: 3,
                    privacyLevel,
                    readStatus,
                    page: { kind: "main" },
                    receipt,
                  }),
                  `personal memories main/${locale}/${category}/${readStatus}/size-${size}`,
                );

                const firstMemory = memories[0];
                if (firstMemory?.personal_memory_id !== undefined) {
                  expectSafePanelPayload(
                    buildPersonalMemoriesPanelPayload({
                      locale,
                      category,
                      selectedLineageId: category === "global" ? 0 : 100,
                      personas,
                      memories,
                      stmCount: 3,
                      privacyLevel,
                      readStatus,
                      page: { kind: "remove", memoryId: firstMemory.personal_memory_id },
                      receipt,
                    }),
                    `personal memories remove/${locale}/${category}/${readStatus}/size-${size}`,
                  );
                }
              }

              // Sweep persona collection sizes (when category === "persona")
              if (category === "persona") {
                for (const pSize of personaSizes) {
                  const personas = Array.from({ length: pSize }, (_, i) =>
                    createPersona({
                      persona_id: i + 1,
                      persona_lineage_id: 100 + i,
                      persona_nickname: `Persona ${i + 1}`,
                    }),
                  );
                  expectSafePanelPayload(
                    buildPersonalMemoriesPanelPayload({
                      locale,
                      category: "persona",
                      selectedLineageId: personas[0]?.persona_lineage_id ?? 100,
                      personas,
                      memories: [
                        makePersonalMemory(1, {
                          persona_lineage_id: personas[0]?.persona_lineage_id ?? 100,
                        }),
                      ],
                      stmCount: 2,
                      privacyLevel,
                      readStatus,
                      page: { kind: "main" },
                      receipt,
                    }),
                    `personal memories persona size/${locale}/${readStatus}/pSize-${pSize}`,
                  );
                }
              }

              // Sweep stmCount values
              for (const stmCount of stmCounts) {
                expectSafePanelPayload(
                  buildPersonalMemoriesPanelPayload({
                    locale,
                    category,
                    selectedLineageId: category === "global" ? 0 : 100,
                    personas: [createPersona({ persona_nickname: "Main Persona" })],
                    memories: [makePersonalMemory(1)],
                    stmCount,
                    privacyLevel,
                    readStatus,
                    page: { kind: "main" },
                    receipt,
                  }),
                  `personal memories stmCount/${locale}/${category}/${readStatus}/count-${stmCount}`,
                );
              }
            }
          }
        }
      }
    }
  });

  it("covers every record in the union of paginated pages without dropping overflow", () => {
    // Test collection with MAX_PERSONAL_MEMORY_PAGE_SIZE + 1 items
    const totalMemories = MAX_PERSONAL_MEMORY_PAGE_SIZE + 1;
    const memories = Array.from({ length: totalMemories }, (_, i) =>
      makePersonalMemory(i + 1, { persona_lineage_id: 0 }),
    );

    function extractMemoryIds(payload: ReturnType<typeof buildPersonalMemoriesPanelPayload>): number[] {
      const ids: number[] = [];
      for (const topComp of payload.components) {
        if ("components" in topComp && Array.isArray(topComp.components)) {
          for (const inner of topComp.components) {
            if ("components" in inner && Array.isArray(inner.components)) {
              for (const elem of inner.components) {
                if (elem.type === ComponentType.StringSelect) {
                  const select = elem as StringSelectMenuComponentData;
                  if (select.customId?.includes(":select:")) {
                    for (const opt of select.options) {
                      if (!opt.value.startsWith("action:")) {
                        ids.push(Number(opt.value));
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      return ids;
    }

    const rangePayload = (rangeIndex: number) =>
      buildPersonalMemoriesPanelPayload({
        locale: "en-US",
        category: "global",
        selectedLineageId: 0,
        personas: [],
        memories,
        stmCount: 0,
        privacyLevel: PrivacyLevel.MINIMAL,
        readStatus: "fresh",
        page: { kind: "main", rangeIndex },
      });

    const idsPage0 = extractMemoryIds(rangePayload(0));
    const idsPage1 = extractMemoryIds(rangePayload(1));

    expect(idsPage0.length).toBe(MAX_PERSONAL_MEMORY_PAGE_SIZE);
    expect(idsPage1.length).toBe(1);

    const unionIds = [...idsPage0, ...idsPage1];
    expect(unionIds.length).toBe(totalMemories);

    const expectedIds = Array.from({ length: totalMemories }, (_, i) => i + 1);
    expect(unionIds.sort((a, b) => a - b)).toEqual(expectedIds);
  });

  it("handles oversized content, backtick runs, and astral emoji across pages", () => {
    const personas = [createPersona({ persona_nickname: "Main Persona" })];
    const limits = getMemoryLimits();

    const globalPayload = (content: string, privacyLevel: PrivacyLevel) =>
      buildPersonalMemoriesPanelPayload({
        locale: "en-US",
        category: "global",
        selectedLineageId: 0,
        personas: [],
        memories: [makePersonalMemory(1, { persona_lineage_id: 0, content })],
        stmCount: 0,
        privacyLevel,
        readStatus: "fresh",
        page: { kind: "main" },
      });

    const lengthsToTest = [limits.maxMemoryLength, 4000, 20000, 100000];
    for (const len of lengthsToTest) {
      const content = "P".repeat(len);

      expectSafePanelPayload(globalPayload(content, PrivacyLevel.FULL), `personal global main (len ${len})`);

      expectSafePanelPayload(
        buildPersonalMemoriesPanelPayload({
          locale: "en-US",
          category: "persona",
          selectedLineageId: 100,
          personas,
          memories: [makePersonalMemory(1, { persona_lineage_id: 100, content })],
          stmCount: 0,
          privacyLevel: PrivacyLevel.FULL,
          readStatus: "fresh",
          page: { kind: "main" },
        }),
        `personal persona main (len ${len})`,
      );

      expectSafePanelPayload(
        buildPersonalMemoriesPanelPayload({
          locale: "en-US",
          category: "persona",
          selectedLineageId: 100,
          personas,
          memories: [makePersonalMemory(1, { persona_lineage_id: 100, content })],
          stmCount: 0,
          privacyLevel: PrivacyLevel.MINIMAL,
          readStatus: "fresh",
          page: { kind: "remove", memoryId: 1 },
        }),
        `personal remove (len ${len})`,
      );
    }

    for (const runLen of [3, 4, 5, 6, 8]) {
      const content = `Prefix \`${"`".repeat(runLen - 1)} middle \`${"`".repeat(runLen - 1)} suffix`;

      expectSafePanelPayload(globalPayload(content, PrivacyLevel.MINIMAL), `personal global backtick run ${runLen}`);
    }

    for (const len of [4000, 20000, 100000]) {
      // 🌟 is \uD83C\uDF1F (2 UTF-16 units, 1 codepoint)
      const content = "🌟".repeat(len);

      expectSafePanelPayload(globalPayload(content, PrivacyLevel.MINIMAL), `personal global astral emoji (len ${len})`);
    }
  });
});
