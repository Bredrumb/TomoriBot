import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
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

// Sidebar source of truth:
// - Top-level groups are discovered from docs/*/README.md.
// - Page links use each Markdown file's `title`.
// - Folder groups use `sidebar.groupLabel` from that folder's README when present.
// - Ordering uses `sidebar.order` only where filename order is not enough.
// - Set `sidebar.hidden: true` on a top-level README to keep that folder out of main nav.
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const maxOrder = Number.MAX_SAFE_INTEGER;

const segmentLabelOverrides = {
  ai: "AI",
  api: "API",
  db: "DB",
  discord: "Discord",
  ltm: "LTM",
  mcp: "MCP",
  novelai: "NovelAI",
  rag: "RAG",
  sillytavern: "SillyTavern",
  stm: "STM",
  stt: "STT",
  tts: "TTS",
};

function buildSidebarSection(directory) {
  const dirPath = resolve(docsTarget, directory);
  const readmePath = getReadmePath(dirPath);
  const readmeData = readmePath ? readFrontmatter(readmePath) : {};

  return {
    label: getGroupLabel(readmeData, directory),
    collapsed: true,
    items: buildDirectoryItems(dirPath, directory).map((node) => node.item),
  };
}

function buildDirectoryItems(dirPath, slugPrefix) {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  const readme = entries.find((entry) => isReadme(entry.name));
  const readmeNode = readme ? buildPageNode(join(dirPath, readme.name), slugPrefix) : undefined;
  const childNodes = entries
    .filter((entry) => !isReadme(entry.name))
    .flatMap((entry) => {
      const entryPath = join(dirPath, entry.name);
      if (entry.isDirectory()) return [buildGroupNode(entryPath, entry.name, joinSlug(slugPrefix, entry.name))];
      if (entry.isFile() && isMarkdownFile(entry.name)) {
        return [buildPageNode(entryPath, joinSlug(slugPrefix, stripMarkdownExtension(entry.name)))];
      }
      return [];
    })
    .filter(Boolean)
    .sort(compareNodes);

  return readmeNode && !readmeNode.hidden ? [readmeNode, ...childNodes] : childNodes;
}

function buildGroupNode(dirPath, dirName, slugPrefix) {
  const readmePath = getReadmePath(dirPath);
  const readmeData = readmePath ? readFrontmatter(readmePath) : {};
  const children = buildDirectoryItems(dirPath, slugPrefix);
  const childOrder = Math.min(...children.map((child) => child.order), maxOrder);

  return {
    item: {
      label: getGroupLabel(readmeData, dirName),
      collapsed: true,
      items: children.map((child) => child.item),
    },
    order: readmeData.sidebar?.order ?? childOrder,
    sortKey: slugPrefix,
    hidden: false,
  };
}

function buildPageNode(filePath, slug) {
  const data = readFrontmatter(filePath);

  return {
    item: {
      label: data.sidebar?.label ?? data.title ?? prettySegmentLabel(basename(slug)),
      link: `/${slug}/`,
    },
    order: data.sidebar?.order ?? maxOrder,
    sortKey: slug,
    hidden: data.sidebar?.hidden === true,
  };
}

function compareNodes(a, b) {
  if (a.order !== b.order) return a.order - b.order;
  return collator.compare(a.sortKey, b.sortKey);
}

function getGroupLabel(data, dirName) {
  return data.sidebar?.groupLabel ?? data.groupLabel ?? data.title ?? prettySegmentLabel(dirName);
}

function getReadmePath(dirPath) {
  for (const fileName of ["README.md", "README.mdx"]) {
    const filePath = join(dirPath, fileName);
    if (existsSync(filePath)) return filePath;
  }
  return undefined;
}

function readFrontmatter(filePath) {
  const content = readFileSync(filePath, "utf8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};

  const data = {};
  let currentKey;

  for (const rawLine of match[1].split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;

    const nested = rawLine.match(/^ {2}([\w-]+):(?:\s*(.*))?$/);
    if (nested && currentKey) {
      data[currentKey] ??= {};
      data[currentKey][nested[1]] = parseFrontmatterValue(nested[2] ?? "");
      continue;
    }

    const topLevel = rawLine.match(/^([\w-]+):(?:\s*(.*))?$/);
    if (!topLevel) continue;

    const [, key, value = ""] = topLevel;
    if (value === "") {
      data[key] = {};
      currentKey = key;
    } else {
      data[key] = parseFrontmatterValue(value);
      currentKey = undefined;
    }
  }

  return data;
}

function parseFrontmatterValue(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function prettySegmentLabel(segment) {
  const cleaned = segment.replace(/^\d+-/, (prefix) => `${Number.parseInt(prefix, 10)}: `);
  return cleaned
    .split("-")
    .map((word) => segmentLabelOverrides[word.toLowerCase()] ?? capitalize(word))
    .join(" ");
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function joinSlug(...parts) {
  return parts.filter(Boolean).join("/");
}

function isReadme(fileName) {
  return /^README\.mdx?$/i.test(fileName);
}

function isMarkdownFile(fileName) {
  return [".md", ".mdx"].includes(extname(fileName).toLowerCase());
}

function stripMarkdownExtension(fileName) {
  return fileName.replace(/\.mdx?$/i, "");
}

function buildTopLevelSidebar() {
  return readdirSync(docsTarget, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dirPath = resolve(docsTarget, entry.name);
      const readmePath = getReadmePath(dirPath);
      if (!readmePath) return [];

      const readmeData = readFrontmatter(readmePath);
      if (readmeData.sidebar?.hidden === true) return [];

      return [
        {
          item: buildSidebarSection(entry.name),
          order: readmeData.sidebar?.order ?? maxOrder,
          sortKey: entry.name,
        },
      ];
    })
    .sort(compareNodes)
    .map((node) => node.item);
}

const sidebar = buildTopLevelSidebar();

export default defineConfig({
  site: "https://docs.tomoribot.app",
  // Docs content lives at repo-root `docs/`, surfaced via a junction at `src/content/docs`
  // (see above). Vite resolves each content file to its real path under `../../docs/...`,
  // which sits outside this app, so a bare `@astrojs/starlight/components` import in an MDX
  // page resolves from repo-root node_modules and fails (Starlight is installed only under
  // `apps/docs/node_modules`). Alias that one package subpath to its concrete location so
  // MDX landing pages can use Starlight's <Card>/<LinkCard>/<LinkButton>. A global
  // `resolve.preserveSymlinks` would fix this too but breaks Bun's `.bun/` symlink store.
  vite: {
    resolve: {
      // Exact-match regex (not a string prefix) so ONLY the bare specifier is rewritten —
      // Starlight resolves its own `@astrojs/starlight/components/Banner.astro` subpaths
      // internally and must not be touched.
      alias: [
        {
          find: /^@astrojs\/starlight\/components$/,
          replacement: resolve(__dirname, "node_modules/@astrojs/starlight/components.ts"),
        },
      ],
    },
  },
  integrations: [
    starlight({
      title: "TomoriBot",
      description: "Developer documentation for TomoriBot",
      // Served from apps/docs/public/favicon.ico at the site root as /favicon.ico.
      favicon: "/favicon.ico",
      head: [
        {
          tag: "meta",
          attrs: { property: "og:image", content: "https://docs.tomoribot.app/tomoricon.png" },
        },
        {
          tag: "link",
          attrs: { rel: "icon", type: "image/png", href: "/tomoricon.png", sizes: "256x256" },
        },
        {
          tag: "link",
          attrs: { rel: "apple-touch-icon", href: "/tomoricon.png" },
        },
      ],
      customCss: ["/src/styles/custom.css"],
      // SiteTitle override renders /favicon.ico directly as a plain <img> in the nav header.
      // The standard `logo` config can't reference public/ files because it generates a Vite
      // import that expects an Astro image object { src, width, height }, not a URL string.
      components: {
        SiteTitle: "./src/components/SiteTitle.astro",
        // Prepends the "AI-generated" disclaimer note to every page.
        // Opt out per-page with `aiGenerated: false` in frontmatter.
        MarkdownContent: "./src/components/MarkdownContent.astro",
      },
      // Starlight v0.33.0+ expects an array of link items instead of a keyed object.
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/Bredrumb/TomoriBot" }],
      sidebar,
    }),
  ],
});
