import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Base points to src/content/docs/ — a junction/symlink created by astro.config.mjs
// at startup that points to the repo-root docs/ directory. Using this local path
// (rather than the external ../../docs URL) keeps filePath values in the form
// "src/content/docs/..." so Starlight's autogenerate prefix-strip works correctly.
const docsDir = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "./content/docs"));

export const collections = {
  docs: defineCollection({
    loader: glob({
      pattern: "**/*.{md,mdx}",
      base: docsDir,
      generateId: ({ entry }) =>
        entry
          .replace(/\\/g, "/") // normalize Windows backslashes → forward slashes
          .replace(/README\.md$/i, "index.md") // README.md → index so it becomes the section root
          .replace(/\.mdx?$/, ""), // strip extension for clean slugs
    }),
    schema: docsSchema(),
  }),
};
