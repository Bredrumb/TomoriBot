import { describe, expect, it } from "bun:test";
import { llmSections } from "@/db/seed/catalog/models";

describe("Google-family model catalog defaults", () => {
  it.each(["google", "vertex"])("uses Gemini 3.5 Flash-Lite as the %s default", (provider) => {
    const rows = llmSections.flatMap((section) => section.rows).filter((row) => row.provider === provider);
    const defaults = rows.filter((row) => row.isDefault);
    const formerDefault = rows.find((row) => row.codename === "gemini-2.5-flash");

    expect(defaults.map((row) => row.codename)).toEqual(["gemini-3.5-flash-lite"]);
    expect(formerDefault?.isDeprecated).toBe(true);
  });
});
