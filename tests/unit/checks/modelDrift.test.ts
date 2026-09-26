import { describe, expect, it } from "bun:test";
import ts from "typescript";
import { MODEL_DRIFT_TODO, collectModelDriftTodoViolations } from "@/db/seed/catalog/modelSeed";
import { findCandidates, insertRows, seenKey, type SeenEntry } from "../../../scripts/checks/modelDrift";

const fixture = new URL("../../fixtures/modelDrift.json", import.meta.url);
const catalog = new URL("../../../src/db/seed/catalog/models.ts", import.meta.url);

describe("model drift", () => {
  it("declines one provider row without suppressing another", async () => {
    const source = await Bun.file(fixture).json();
    const first = findCandidates(source, []);
    const google = first.candidates.find(
      (item) => item.provider === "google" && item.codename === "gemini-3.1-pro-preview-customtools",
    );
    const vertex = first.candidates.find(
      (item) => item.provider === "vertex" && item.codename === "gemini-3.1-pro-preview-customtools",
    );
    expect(google).toBeDefined();
    expect(vertex).toBeDefined();
    if (!google || !vertex) throw new Error("Fixture candidate missing");
    const seen: SeenEntry = {
      provider: "google",
      table: "llmSections",
      codename: google.codename,
      releaseDate: null,
      offeredAt: "2026-01-01",
    };
    expect(seenKey(seen)).not.toBe(seenKey(vertex));
    const second = findCandidates(source, [seen]).candidates;
    expect(second.some((item) => item.provider === "google" && item.codename === seen.codename)).toBe(false);
    expect(second.some((item) => item.provider === "vertex" && item.codename === seen.codename)).toBe(true);
  });

  it("does not draft media routes that the provider cannot execute", async () => {
    const source = await Bun.file(fixture).json();
    const { candidates } = findCandidates(source, []);
    expect(candidates.some((item) => item.provider === "nvidia" && item.table !== "llmSections")).toBe(false);
    expect(candidates.some((item) => item.provider === "vertex" && item.table !== "llmSections")).toBe(false);
  });

  it("does not reoffer models already in the catalog", async () => {
    const source = await Bun.file(fixture).json();
    expect(source.google.models["gemini-3.1-pro-preview"].modalities.output).toEqual(["text"]);
    expect(source.google.models["gemini-3-pro-image"].modalities.output).toContain("image");
    const { candidates } = findCandidates(source, []);
    expect(candidates.some((item) => item.provider === "google" && item.codename === "gemini-3.1-pro-preview")).toBe(
      false,
    );
    expect(candidates.some((item) => item.provider === "google" && item.codename === "gemini-3-pro-image")).toBe(false);
  });

  it("drafts fixed OpenRouter prices but leaves floating aliases unpriced", async () => {
    const source = await Bun.file(fixture).json();
    const candidates = findCandidates(source, []).candidates;
    const openrouter = candidates.find(
      (item) => item.provider === "openrouter" && item.codename === "~openai/gpt-latest",
    );
    const fixed = candidates.find((item) => item.provider === "openrouter" && item.codename === "z-ai/glm-5.2");
    const zai = candidates.find((item) => item.provider === "zai" && item.codename === "zai/glm-5.2");
    const google = candidates.find(
      (item) => item.provider === "google" && item.codename === "gemini-3.1-pro-preview-customtools",
    );
    if (!openrouter || !fixed || !google || !zai) throw new Error("Fixture candidates missing");
    expect(openrouter.model.cost?.input).toBeDefined();
    const text = await Bun.file(catalog).text();
    const inserted = insertRows(text, [openrouter, fixed, google, zai]);
    const draftedRow = (codename: string): string => {
      const start = inserted.indexOf(`codename: "${codename}"`);
      if (start < 0) throw new Error(`Drafted row missing: ${codename}`);
      return inserted.slice(start, inserted.indexOf(`desc: "${MODEL_DRIFT_TODO}"`, start));
    };
    expect(draftedRow(openrouter.codename)).not.toContain("inputPricePerMillion");
    expect(draftedRow(openrouter.codename)).not.toContain("outputPricePerMillion");
    expect(draftedRow(fixed.codename)).toContain("inputPricePerMillion");
    expect(draftedRow(fixed.codename)).toContain("outputPricePerMillion");
    expect(draftedRow(google.codename)).toContain("inputPricePerMillion");
    expect(draftedRow(google.codename)).toContain("\n        seesImages: true,");
    expect(draftedRow(google.codename)).toContain("\n        seesVideos: true,");
    expect(draftedRow(zai.codename)).toContain("// seesImages: true,");
    expect(draftedRow(zai.codename)).toContain("// isUncensored: true,");
  });

  it("inserts in the selected section without changing adjacent catalog text", async () => {
    const source = await Bun.file(fixture).json();
    const text = await Bun.file(catalog).text();
    const candidate = findCandidates(source, []).candidates.find(
      (item) => item.provider === "google" && item.table === "imageSections",
    );
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error("Fixture candidate missing");
    const inserted = insertRows(text, [candidate]);
    const compiled = ts.transpileModule(inserted, {
      compilerOptions: { target: ts.ScriptTarget.Latest },
      reportDiagnostics: true,
    });
    expect(compiled.diagnostics).toHaveLength(0);
    expect(inserted).toContain(candidate.codename);
    expect(inserted).toContain(MODEL_DRIFT_TODO);
    const draftStart = inserted.indexOf(`codename: "${candidate.codename}"`);
    const draftEnd = inserted.indexOf("},", inserted.indexOf(`desc: "${MODEL_DRIFT_TODO}"`, draftStart));
    expect(inserted.slice(draftStart, draftEnd)).not.toContain("i18n:");
    expect(inserted.slice(0, text.indexOf("export const imageSections"))).toBe(
      text.slice(0, text.indexOf("export const imageSections")),
    );
  });

  it("blocks the generated English placeholder and permits missing translations", () => {
    const row = { provider: "google", codename: "sample", desc: MODEL_DRIFT_TODO };
    expect(collectModelDriftTodoViolations("llms", [row])).toHaveLength(1);
    row.desc = "Reviewed description";
    expect(collectModelDriftTodoViolations("llms", [row])).toEqual([]);
    expect(collectModelDriftTodoViolations("llms", [{ ...row, i18n: { ja: MODEL_DRIFT_TODO } }])).toHaveLength(1);
  });
});
