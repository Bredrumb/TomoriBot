import { beforeAll, describe, expect, it } from "bun:test";
import { EmbedBuilder } from "discord.js";
import {
  buildSummaryControlId,
  parseSummaryControlSegments,
  renderSummaryMessage,
  type SummaryControls,
} from "@/utils/compaction/compact/rendering";
import { parseInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { initializeLocalizer } from "@/utils/text/localizer";
import { collectCaseFailures, RUNTIME_LOCALES } from "../../helpers/localeCases";

beforeAll(async () => initializeLocalizer());

const DEADLINE_SECONDS = 1_800_000_000;
const BEFORE_DEADLINE = DEADLINE_SECONDS * 1000 - 1;
const AFTER_DEADLINE = DEADLINE_SECONDS * 1000;

function controls(locale = "en-US"): SummaryControls {
  return { locale, refresh: true, editDeadline: DEADLINE_SECONDS };
}

function renderedActions(saved: boolean, now: number): string[] {
  const { components } = renderSummaryMessage(new EmbedBuilder().setDescription("Summary"), controls(), saved, now);
  return components.flatMap((row) =>
    row.components.map((button) => {
      const data = button.toJSON();
      const customId = "custom_id" in data ? data.custom_id : "";
      return parseInteractionRoute(customId)?.segments[0] ?? "";
    }),
  );
}

describe("compact summary controls", () => {
  it("offers saving from the start and withdraws only the edit button when the window closes", () => {
    expect(renderedActions(false, BEFORE_DEADLINE)).toEqual(["edit", "save"]);
    expect(renderedActions(false, AFTER_DEADLINE)).toEqual(["save"]);
  });

  it("withdraws every button once saved, which locks editing inside the window", () => {
    expect(renderedActions(true, BEFORE_DEADLINE)).toEqual([]);
  });

  it("round-trips the button state through a custom ID within Discord's limit for every locale", () => {
    const cases = collectCaseFailures();
    for (const locale of RUNTIME_LOCALES) {
      for (const action of ["edit", "save"] as const) {
        const customId = buildSummaryControlId(action, controls(locale));
        const route = parseInteractionRoute(customId);
        cases.check(`${locale} ${action}`, () => {
          expect(customId.length).toBeLessThanOrEqual(100);
          expect(route && parseSummaryControlSegments(route.segments)).toEqual({ action, controls: controls(locale) });
        });
      }
    }
    cases.expectNoFailures();
  });

  it("rejects custom ID segments it did not write", () => {
    expect(parseSummaryControlSegments(["delete", "en-US", "1", "1800000000"])).toBeNull();
    expect(parseSummaryControlSegments(["edit", "xx-YY", "1", "1800000000"])).toBeNull();
    expect(parseSummaryControlSegments(["edit", "en-US", "2", "1800000000"])).toBeNull();
    expect(parseSummaryControlSegments(["edit", "en-US", "1", "soon"])).toBeNull();
  });
});
