import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { z } from "astro/zod";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Point to the src/content/docs junction rather than ../../docs so Starlight's autogenerate prefix strip matches.
const docsDir = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "./content/docs"));

export const collections = {
  docs: defineCollection({
    loader: glob({
      // Exclude root docs/README.md because generateId turns it into the empty slug, colliding with redirects["/"].
      pattern: ["**/*.{md,mdx}", "!README.md"],
      base: docsDir,
      generateId: ({ entry }) =>
        entry
          .replace(/\\/g, "/")
          .replace(/README\.mdx?$/i, "index.md")
          .replace(/\.mdx?$/, ""),
    }),
    schema: docsSchema({
      extend: z.object({
        aiGenerated: z.boolean().default(false),
      }),
    }),
  }),
};
