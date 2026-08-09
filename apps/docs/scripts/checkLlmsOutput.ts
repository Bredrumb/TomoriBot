import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const distRoot = fileURLToPath(new URL("../dist/", import.meta.url));
const forbiddenWikiTitles = [
  "# Azure Production Data Inspection",
  "# Azure Terraform State Recovery",
  "# Refactor Record",
  "# Threat Models",
  "# Wiki",
];

function readRequired(relativePath: string): string {
  const absolutePath = join(distRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing generated documentation file: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

function collectTextFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTextFiles(absolutePath));
    } else if (entry.name.endsWith(".txt")) {
      files.push(absolutePath);
    }
  }
  return files;
}

const entrypoint = readRequired("llms.txt");
const emphasized = readRequired(join("_llms-txt", "tomoribot-introduction-and-features.txt"));
const contributor = readRequired(join("_llms-txt", "contributor-and-architecture-documentation.txt"));

if (!entrypoint.includes("/en/introduction/") || !entrypoint.includes("/en/features/")) {
  throw new Error("llms.txt must emphasize the English introduction and feature indexes");
}
if (!emphasized.includes("# What is TomoriBot?") || !emphasized.includes("# Tools & Extensions")) {
  throw new Error("The emphasized documentation set is empty or missing its expected sections");
}
if (!contributor.includes("# Architecture")) {
  throw new Error("The contributor documentation set is empty or missing architecture content");
}

for (const file of collectTextFiles(distRoot)) {
  const content = readFileSync(file, "utf8");
  const lines = new Set(content.split(/\r?\n/).map((line) => line.trim()));
  const leakedTitle = forbiddenWikiTitles.find((title) => lines.has(title));
  if (leakedTitle) {
    throw new Error(`Internal wiki content leaked into ${file}: ${leakedTitle}`);
  }
}

const wikiHtml = readRequired(join("en", "wiki", "threat-models", "index.html"));
if (!/<meta[^>]+name="robots"[^>]+content="noindex"/i.test(wikiHtml)) {
  throw new Error("English wiki pages must include a noindex robots directive");
}

console.log("Generated LLM documentation indexes are curated and wiki-safe");
