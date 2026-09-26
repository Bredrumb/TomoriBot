import { writeFile } from "node:fs/promises";
import ts from "typescript";
import { imageSections, llmSections, videoSections } from "@/db/seed/catalog/models";
import {
  MODEL_DRIFT_TODO,
  REQUIRED_ALTERNATION_PROVIDERS,
  REQUIRED_PREFIX_PROVIDERS,
} from "@/db/seed/catalog/modelSeed";
import type { ImageInput, LlmInput, VideoInput } from "@/db/seed/catalog/types";

export type ModelTable = "llmSections" | "imageSections" | "videoSections";
export interface SourceModel {
  id: string;
  family?: string;
  tool_call?: boolean;
  reasoning?: boolean;
  structured_output?: boolean;
  release_date?: string;
  modalities?: { input?: string[]; output?: string[] };
  cost?: { input?: number; output?: number };
}
type SourceCatalog = Record<string, { models: Record<string, SourceModel> }>;
export interface Candidate {
  provider: string;
  table: ModelTable;
  model: SourceModel;
  codename: string;
}
export interface SeenEntry {
  provider: string;
  table: ModelTable;
  codename: string;
  releaseDate: string | null;
  offeredAt: string;
}
interface Policy {
  source: string;
  tier: "generation" | "family";
  minGeneration?: number;
  floatingAliases?: boolean;
}

const SOURCE_URL = "https://models.dev/api.json";
const CATALOG_URL = new URL("../../src/db/seed/catalog/models.ts", import.meta.url);
const SEEN_URL = new URL("../data/modelDriftSeen.json", import.meta.url);
const REJECT_NON_CHAT =
  /-(tts|live(?!\w)|live-translate|image|computer-use|robotics|omni)(-|$)|^deep-research|^lyria|^gemma/;
const REJECT_MEDIA = /(^|\/)(deep-research|openrouter\/auto)/;
const FLOATING_ALIAS = /(^~|-latest$)/;
const POLICIES: Record<string, Policy> = {
  google: { source: "google", tier: "generation", minGeneration: 3 },
  vertex: { source: "google-vertex", tier: "generation", minGeneration: 3 },
  zai: { source: "zai", tier: "generation", minGeneration: 4.6 },
  zaicoding: { source: "zai", tier: "generation", minGeneration: 4.6 },
  anthropic: { source: "anthropic", tier: "generation", minGeneration: 4.5 },
  deepseek: { source: "deepseek", tier: "generation", minGeneration: 0 },
  openrouter: { source: "openrouter", tier: "family", floatingAliases: true },
  nvidia: { source: "nvidia", tier: "family" },
};

export function seenKey(entry: Pick<SeenEntry, "provider" | "table" | "codename">): string {
  return `${entry.provider}\u0000${entry.table}\u0000${entry.codename}`;
}

function catalogRows(table: ModelTable): Array<LlmInput | ImageInput | VideoInput> {
  switch (table) {
    case "llmSections":
      return llmSections.flatMap((section) => section.rows);
    case "imageSections":
      return imageSections.flatMap((section) => section.rows);
    case "videoSections":
      return videoSections.flatMap((section) => section.rows);
  }
}

function generationOf(id: string): number {
  const stripped = id
    .replace(/^~/, "")
    .replace(/.*\//, "")
    .replace(/^(gemini|glm)-/, "")
    .replace(/^claude-[a-z]+-/, "")
    .replace(/-/, ".");
  return Number.parseFloat(stripped);
}

function bareAliasOf(id: string): string {
  return id.replace(/-\d{8}$/, "");
}

function carriedHas(carried: Set<string>, provider: string, id: string): boolean {
  return carried.has(id) || carried.has(`${provider}/${id}`) || carried.has(id.split("/").pop() ?? id);
}

function outputIs(model: SourceModel, kind: "text" | "image" | "video"): boolean {
  const output = model.modalities?.output;
  return kind === "text" ? output?.length === 1 && output[0] === "text" : output?.includes(kind) === true;
}

function familyCandidates(models: SourceModel[], provider: string, carried: Set<string>): SourceModel[] {
  const newest = new Map<string, string>();
  for (const codename of carried) {
    const model = models.find((row) => row.id === codename || row.id.endsWith(`/${codename}`));
    if (!model?.family || !model.release_date) continue;
    const prior = newest.get(model.family);
    if (!prior || prior < model.release_date) newest.set(model.family, model.release_date);
  }
  return models.filter((model) => {
    if (!outputIs(model, "text") || carriedHas(carried, provider, model.id)) return false;
    const sibling =
      !!model.family &&
      !!model.release_date &&
      !!newest.get(model.family) &&
      model.release_date > (newest.get(model.family) ?? "");
    const alias = POLICIES[provider].floatingAliases && FLOATING_ALIAS.test(model.id);
    return sibling || alias;
  });
}

function generationCandidates(models: SourceModel[], provider: string, carried: Set<string>): SourceModel[] {
  const passing = models.filter((model) => {
    if (!outputIs(model, "text") || carriedHas(carried, provider, model.id)) return false;
    if ((provider === "google" || provider === "vertex") && REJECT_NON_CHAT.test(model.id)) return false;
    if (provider === "vertex" && /[/@]/.test(model.id)) return false;
    return generationOf(model.id) >= (POLICIES[provider].minGeneration ?? 0);
  });
  const bare = new Set(passing.filter((model) => !/-\d{8}$/.test(model.id)).map((model) => model.id));
  return passing.filter((model) => !/-\d{8}$/.test(model.id) || !bare.has(bareAliasOf(model.id)));
}

function mediaCandidates(models: SourceModel[], provider: string, table: ModelTable): SourceModel[] {
  const kind = table === "imageSections" ? "image" : "video";
  if (kind === "video" && provider !== "google" && provider !== "openrouter") return [];
  if (kind === "image" && provider !== "google" && provider !== "openrouter") return [];
  const carried = new Set(
    catalogRows(table)
      .filter((row) => row.provider === provider)
      .map((row) => row.codename),
  );
  return models.filter(
    (model) =>
      outputIs(model, kind) &&
      !REJECT_MEDIA.test(model.id) &&
      !carriedHas(carried, provider, model.id) &&
      (provider !== "google" || (kind === "image" ? model.id.includes("-image") : model.id.startsWith("veo-"))),
  );
}

function isSourceCatalog(value: unknown): value is SourceCatalog {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return [...new Set(Object.values(POLICIES).map((policy) => policy.source))].every((key) => {
    const entry = source[key];
    if (!entry || typeof entry !== "object" || !("models" in entry)) return false;
    const models = (entry as { models: unknown }).models;
    return (
      !!models &&
      typeof models === "object" &&
      Object.values(models).every((model) => {
        if (!model || typeof model !== "object") return false;
        const row = model as Record<string, unknown>;
        const modalities = row.modalities as Record<string, unknown> | undefined;
        const cost = row.cost as Record<string, unknown> | undefined;
        const strings = (items: unknown): boolean =>
          items === undefined || (Array.isArray(items) && items.every((item) => typeof item === "string"));
        const price = (amount: unknown): boolean =>
          amount === undefined || (typeof amount === "number" && Number.isFinite(amount) && amount >= 0);
        return (
          typeof row.id === "string" &&
          row.id.length > 0 &&
          (row.family === undefined || typeof row.family === "string") &&
          (row.release_date === undefined || typeof row.release_date === "string") &&
          (row.tool_call === undefined || typeof row.tool_call === "boolean") &&
          (row.reasoning === undefined || typeof row.reasoning === "boolean") &&
          (row.structured_output === undefined || typeof row.structured_output === "boolean") &&
          (modalities === undefined ||
            (typeof modalities === "object" &&
              modalities !== null &&
              strings(modalities.input) &&
              strings(modalities.output))) &&
          (cost === undefined || (typeof cost === "object" && cost !== null && price(cost.input) && price(cost.output)))
        );
      })
    );
  });
}

function isSeenEntries(value: unknown): value is SeenEntry[] {
  return (
    Array.isArray(value) &&
    (value as unknown[]).every((item) => {
      if (item === null || typeof item !== "object") return false;
      const entry = item as Record<string, unknown>;
      return (
        typeof entry.provider === "string" &&
        ["llmSections", "imageSections", "videoSections"].includes(entry.table as string) &&
        typeof entry.codename === "string" &&
        (entry.releaseDate === null || typeof entry.releaseDate === "string") &&
        typeof entry.offeredAt === "string"
      );
    })
  );
}

export function findCandidates(
  source: SourceCatalog,
  seen: SeenEntry[],
): { candidates: Candidate[]; free: Candidate[] } {
  const seenKeys = new Set(seen.map(seenKey));
  const candidates: Candidate[] = [];
  const free: Candidate[] = [];
  for (const [provider, policy] of Object.entries(POLICIES)) {
    const models = Object.values(source[policy.source].models);
    const carried = new Set(
      catalogRows("llmSections")
        .filter((row) => row.provider === provider)
        .map((row) => row.codename),
    );
    const text =
      policy.tier === "generation"
        ? generationCandidates(models, provider, carried)
        : familyCandidates(models, provider, carried);
    for (const [table, drafts] of [
      ["llmSections", text],
      ["imageSections", mediaCandidates(models, provider, "imageSections")],
      ["videoSections", mediaCandidates(models, provider, "videoSections")],
    ] as const) {
      for (const model of drafts) {
        const codename = provider === "zai" ? `zai/${model.id}` : model.id;
        const candidate = { provider, table, model, codename };
        if (seenKeys.has(seenKey(candidate))) continue;
        if (model.id.endsWith(":free")) free.push(candidate);
        else candidates.push(candidate);
      }
    }
  }
  return { candidates, free };
}

function renderRow(candidate: Candidate): string {
  const { provider, table, model, codename } = candidate;
  const row: Record<string, unknown> = { provider, codename };
  if (table === "llmSections") {
    const input = model.modalities?.input ?? [];
    if (model.tool_call) row.hasTools = true;
    if (input.includes("image")) row.seesImages = true;
    if (input.includes("video")) row.seesVideos = true;
    if (provider === "google" || provider === "vertex") row.seesYoutube = true;
    if (model.reasoning) row.isReasoning = true;
    if (model.structured_output) row.supportsStructoutput = true;
    if (REQUIRED_ALTERNATION_PROVIDERS.has(provider)) row.strictRoleAlternation = true;
    if (REQUIRED_PREFIX_PROVIDERS.has(provider)) row.supportsPrefixCompletion = true;
    if (provider !== "openrouter" || !FLOATING_ALIAS.test(model.id)) {
      if (typeof model.cost?.input === "number") row.inputPricePerMillion = model.cost.input;
      if (typeof model.cost?.output === "number") row.outputPricePerMillion = model.cost.output;
    }
  }
  row.desc = MODEL_DRIFT_TODO;
  return `      {\n${Object.entries(row)
    .map(([key, value]) => `        ${key}: ${JSON.stringify(value)},`)
    .join("\n")}\n      }`;
}

function sectionFor(table: ModelTable, provider: string): string {
  if (table === "llmSections") {
    return (
      {
        google: "Google Models",
        vertex: "Vertex AI Models",
        zai: "Z.ai General API Models",
        zaicoding: "Z.ai (Coding) Models",
        anthropic: "Anthropic Models",
        deepseek: "DeepSeek Models",
        openrouter: "OpenRouter Models",
        nvidia: "NVIDIA NIM Models",
      }[provider] ?? ""
    );
  }
  if (table === "imageSections") {
    return provider === "google" ? "Google Gemini Image Generation Models" : "OpenRouter Image Generation Models";
  }
  return provider === "google" ? "Google Veo Video Generation Models" : "OpenRouter Video Generation Models";
}

export function insertRows(source: string, candidates: Candidate[]): string {
  const file = ts.createSourceFile("models.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const insertions: Array<{ at: number; rows: string[] }> = [];
  for (const candidate of candidates) {
    const anchor = sectionFor(candidate.table, candidate.provider);
    let position: number | undefined;
    function visit(node: ts.Node): void {
      if (ts.isObjectLiteralExpression(node)) {
        const comment = node.properties.find(
          (property) => ts.isPropertyAssignment(property) && property.name.getText(file) === "comment",
        );
        const rows = node.properties.find(
          (property) => ts.isPropertyAssignment(property) && property.name.getText(file) === "rows",
        );
        if (
          comment &&
          ts.isPropertyAssignment(comment) &&
          ts.isStringLiteral(comment.initializer) &&
          comment.initializer.text.startsWith(anchor) &&
          rows &&
          ts.isPropertyAssignment(rows) &&
          ts.isArrayLiteralExpression(rows.initializer)
        )
          position = rows.initializer.getEnd() - 1;
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    if (position === undefined) throw new Error(`Missing catalog section ${candidate.table}/${candidate.provider}`);
    const group = insertions.find((entry) => entry.at === position);
    if (group) group.rows.push(renderRow(candidate));
    else insertions.push({ at: position, rows: [renderRow(candidate)] });
  }
  let output = source;
  for (const insertion of insertions.sort((a, b) => b.at - a.at)) {
    const before = output.slice(0, insertion.at).trimEnd();
    const after = output.slice(insertion.at);
    output = `${before}\n${insertion.rows.map((row) => `${row},`).join("\n")}\n    ${after}`;
  }
  return output;
}

function sourceAdvisories(source: SourceCatalog): { absent: string[]; unsupportedMedia: string[] } {
  const absent: string[] = [];
  for (const table of ["llmSections", "imageSections", "videoSections"] as const) {
    for (const row of catalogRows(table)) {
      if (row.isDeprecated) continue;
      const sourceKey = row.provider === "vertexexpress" ? "google-vertex" : POLICIES[row.provider]?.source;
      if (!sourceKey) continue;
      const ids = source[sourceKey].models;
      const bare = row.provider === "zai" ? row.codename.replace(/^zai\//, "") : row.codename;
      if (!ids[bare] && !Object.values(ids).some((model) => model.id === bare)) {
        absent.push(`${row.provider}/${table}/${row.codename}`);
      }
    }
  }
  const unsupportedMedia: string[] = [];
  for (const [provider, sourceKey] of [
    ["nvidia", "nvidia"],
    ["vertex", "google-vertex"],
  ] as const) {
    for (const model of Object.values(source[sourceKey].models)) {
      if (!outputIs(model, "image") && !outputIs(model, "video")) continue;
      const table = outputIs(model, "video") ? "videoSections" : "imageSections";
      const carried = catalogRows(table).some((row) => row.provider === provider && row.codename === model.id);
      if (!carried) unsupportedMedia.push(`${provider}/${table}/${model.id}`);
    }
  }
  return { absent, unsupportedMedia };
}

function report(candidates: Candidate[], free: Candidate[], advisories: ReturnType<typeof sourceAdvisories>): string {
  const lines = [
    "Catalog rows drafted from models.dev. Verify provider availability, endpoint support, capabilities, and official prices before merging.",
    "Verify drafted fallback prices for fixed OpenRouter models. Floating aliases have no static price.",
    "",
    `Replace every ${MODEL_DRIFT_TODO} English description. Translations are optional and fall back to English. Remove unwanted rows, but keep their seen entries to decline them.`,
    "",
    `Drafted rows: ${candidates.length}. Free variants for review: ${free.length}.`,
    "",
    "## Free variants",
    "",
    ...free.map((item) => `- ${item.provider}/${item.table}/${item.codename}`),
    "",
    "## Source absence",
    "",
    "A model missing from models.dev is not evidence of retirement:",
    "",
    ...advisories.absent.map((item) => `- ${item}`),
    "",
    "## Media requiring implementation review",
    "",
    ...advisories.unsupportedMedia.map((item) => `- ${item}`),
  ];
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fixtureIndex = args.indexOf("--fixture");
  const reportIndex = args.indexOf("--report");
  const write = args.includes("--write");
  const baseline = args.includes("--baseline");
  if (fixtureIndex !== -1 && !args[fixtureIndex + 1]) throw new Error("--fixture needs a path");
  if (reportIndex !== -1 && !args[reportIndex + 1]) throw new Error("--report needs a path");
  const raw =
    fixtureIndex !== -1
      ? await Bun.file(args[fixtureIndex + 1]).json()
      : await fetch(SOURCE_URL).then((response) => {
          if (!response.ok) throw new Error(`models.dev returned ${response.status}`);
          return response.json();
        });
  if (!isSourceCatalog(raw)) throw new Error("models.dev catalog is missing a required provider or model id");
  const seenRaw: unknown = await Bun.file(SEEN_URL).json();
  if (!isSeenEntries(seenRaw)) throw new Error("Invalid model drift seen file");
  const seen = seenRaw;
  const { candidates, free } = findCandidates(raw, seen);
  for (const candidate of candidates) console.log(`${candidate.provider}\t${candidate.table}\t${candidate.codename}`);
  console.log(`Drafts: ${candidates.length}; free variants: ${free.length}`);
  if (reportIndex !== -1) await writeFile(args[reportIndex + 1], report(candidates, free, sourceAdvisories(raw)));
  if (!write && !baseline) return;
  const offeredAt = new Date().toISOString().slice(0, 10);
  const additions = [...candidates, ...free].map((candidate) => ({
    provider: candidate.provider,
    table: candidate.table,
    codename: candidate.codename,
    releaseDate: candidate.model.release_date ?? null,
    offeredAt,
  }));
  if (additions.length === 0) return;
  const catalog = baseline ? null : await Bun.file(CATALOG_URL).text();
  const updatedCatalog = catalog === null ? null : insertRows(catalog, candidates);
  await writeFile(SEEN_URL, `${JSON.stringify([...seen, ...additions], null, 2)}\n`);
  if (baseline) return;
  if (updatedCatalog !== null) await writeFile(CATALOG_URL, updatedCatalog);
}

if (import.meta.main) await main();
