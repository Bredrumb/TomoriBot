import { describe, expect, it } from "bun:test";
import { buildProtocolLookup } from "@/utils/discord/embedProtocol";
import { validateProtocolMarkers } from "../../../scripts/checks/checkLocaleMarkers";

describe("protocol marker and title validation", () => {
  it("passes validation on current repository authored locales", async () => {
    const summary = await validateProtocolMarkers();
    expect(summary.issues).toEqual([]);
    expect(summary.totalProtocolKeys).toBeGreaterThanOrEqual(40);
  });

  it("detects title collisions between two distinct protocol keys", () => {
    const entries = [
      { key: "commands.refresh.title", kind: "reset" as const },
      { key: "commands.compact.summary_title_refreshed", kind: "compact_refresh" as const },
    ];

    expect(() => buildProtocolLookup(entries, ["en-US"], () => "Identical Title")).toThrow("Protocol title collision");
  });

  it("detects template placeholder mismatches in translations", () => {
    const entries = [
      {
        key: "genai.self_teach.server_memory_learned_title",
        kind: "memory_learning" as const,
        match: "template" as const,
      },
    ];

    // Different placeholder name
    expect(() =>
      buildProtocolLookup(entries, ["en-US", "ja"], (loc) =>
        loc === "en-US" ? "Memory learned for {persona}" : "記憶: {wrong_name}",
      ),
    ).toThrow("Protocol template placeholders differ");

    // Missing placeholder in translation
    expect(() =>
      buildProtocolLookup(entries, ["en-US", "ja"], (loc) =>
        loc === "en-US" ? "Memory learned for {persona}" : "記憶保存",
      ),
    ).toThrow("Protocol template placeholders differ");
  });

  it("rejects title templates with no literal anchor text", () => {
    const entries = [
      {
        key: "reminders.reminder_set_title",
        kind: "reminder_set" as const,
        match: "template" as const,
      },
    ];

    // Bare placeholder with no anchor text
    expect(() => buildProtocolLookup(entries, ["en-US"], () => "{reminder}")).toThrow(
      "Protocol title template has no literal anchor",
    );

    // Valid with literal text
    expect(() => buildProtocolLookup(entries, ["en-US"], () => "Reminder: {reminder}")).not.toThrow();
  });
});
