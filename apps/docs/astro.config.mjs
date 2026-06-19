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
// - Page links use each Markdown file's `title`.
// - Folder groups use `sidebar.groupLabel` from that folder's README when present.
// - Ordering uses `sidebar.order` only where filename order is not enough.
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

const sidebar = [
  buildSidebarSection("architecture"),
  buildSidebarSection("pipelines"),
  buildSidebarSection("subsystems"),
  buildSidebarSection("integrations"),
  buildSidebarSection("guides"),
];

export default defineConfig({
  site: "https://docs.tomoribot.app",
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
      },
      // Starlight v0.33.0+ expects an array of link items instead of a keyed object.
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/Bredrumb/TomoriBot" }],
      sidebar,
    }),
  ],
});
