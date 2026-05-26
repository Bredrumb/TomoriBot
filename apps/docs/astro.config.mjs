import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Starlight's autogenerate resolves pages by stripping the hardcoded
// "src/content/docs/" prefix from each entry's filePath (relative to project
// root). When the docs live outside the Astro project (../../docs), filePath
// becomes "../../docs/..." and the prefix strip never matches, leaving every
// sidebar group empty.
//
// Fix: create a junction/symlink at src/content/docs → ../../docs so that
// Astro sees the files as src/content/docs/... (correct prefix). This runs
// once at startup; on Windows it creates a directory junction (no admin
// required); on Linux/macOS it falls back to a regular symlink.
const __dirname = dirname(fileURLToPath(import.meta.url));
const junctionPath = resolve(__dirname, "src/content/docs");
const docsTarget = resolve(__dirname, "../../docs");

if (!existsSync(junctionPath)) {
  mkdirSync(resolve(__dirname, "src/content"), { recursive: true });
  symlinkSync(docsTarget, junctionPath, "junction");
}

export default defineConfig({
  site: "https://docs.tomoribot.app",
  integrations: [
    starlight({
      title: "TomoriBot",
      description: "Developer documentation for TomoriBot",
      social: {
        github: "https://github.com/Bredrumb/TomoriBot",
      },
      sidebar: [
        { label: "Introduction", autogenerate: { directory: "architecture" } },
        { label: "Pipelines", autogenerate: { directory: "pipelines" } },
        { label: "Subsystems", autogenerate: { directory: "subsystems" } },
        { label: "Integrations", autogenerate: { directory: "integrations" } },
        { label: "Guides", autogenerate: { directory: "guides" } },
      ],
    }),
  ],
});
