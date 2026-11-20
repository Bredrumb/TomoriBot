import { expect, it } from "bun:test";
import { llmSections } from "@/db/seed/catalog/models";

it("offers the documented Google Pro preview instead of the unavailable unsuffixed ID", () => {
  const rows = llmSections.flatMap((section) => section.rows).filter((row) => row.provider === "google");
  expect(rows.find((row) => row.codename === "gemini-3.1-pro")?.isDeprecated).toBe(true);
  const preview = rows.find((row) => row.codename === "gemini-3.1-pro-preview");
  expect(preview).toBeDefined();
  expect(preview?.isDeprecated ?? false).toBe(false);
  expect(preview?.hasTools).toBe(true);
  expect(preview?.supportsStructoutput).toBe(true);
});
