import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLlmsTxt from "starlight-llms-txt";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
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
  const jaLabel = getJaGroupLabel(dirPath, directory);

  return {
    label: getGroupLabel(readmeData, directory),
    collapsed: true,
    items: buildDirectoryItems(dirPath, directory).map((node) => node.item),
    ...(jaLabel ? { translations: { ja: jaLabel } } : {}),
  };
}

// Japanese sidebar labels: when a translated counterpart exists under docs/ja/,
// attach its title as a `translations.ja` entry so Starlight shows Japanese
// labels while browsing /ja/ pages. Pages without a translation keep the
// English label (and Starlight's locale fallback serves the English content).
function readJaCounterpartData(filePath) {
  const jaPath = join(docsTarget, "ja", relative(docsTarget, filePath));
  return existsSync(jaPath) ? readFrontmatter(jaPath) : undefined;
}

// Fallback Japanese labels for sidebar groups whose content is untranslated
// (no docs/ja/ README to pull a label from). Keeps the /ja/ sidebar uniformly
// Japanese at the top level even while those sections serve English fallback
// pages.
const jaGroupLabelFallbacks = {
  architecture: "アーキテクチャ",
  contributing: "コントリビュート",
};

function getJaGroupLabel(dirPath, dirName) {
  const jaReadmePath = getReadmePath(join(docsTarget, "ja", relative(docsTarget, dirPath)));
  if (!jaReadmePath) return dirName ? jaGroupLabelFallbacks[dirName.toLowerCase()] : undefined;
  const jaData = readFrontmatter(jaReadmePath);
  return jaData.sidebar?.groupLabel ?? jaData.groupLabel ?? jaData.title;
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

  const jaLabel = getJaGroupLabel(dirPath);

  return {
    item: {
      label: getGroupLabel(readmeData, dirName),
      collapsed: true,
      items: children.map((child) => child.item),
      ...(jaLabel ? { translations: { ja: jaLabel } } : {}),
    },
    order: readmeData.sidebar?.order ?? childOrder,
    sortKey: slugPrefix,
    hidden: false,
  };
}

function buildPageNode(filePath, slug) {
  const data = readFrontmatter(filePath);
  const jaData = readJaCounterpartData(filePath);
  const jaLabel = jaData?.sidebar?.label ?? jaData?.title;

  return {
    item: {
      label: data.sidebar?.label ?? data.title ?? prettySegmentLabel(basename(slug)),
      link: `/${slug}/`,
      ...(jaLabel ? { translations: { ja: jaLabel } } : {}),
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
  // Redirects for the /features/ restructure: the flat pages were bucketed into
  // task-based sub-category folders, changing their slugs. Keep the old URLs
  // (shared links, search-engine index) working by forwarding to the new paths.
  // Astro emits a static meta-refresh page for each key at build time.
  redirects: {
    "/features/chatting-and-triggers": "/features/chatting-personality/chatting-and-triggers/",
    "/features/multiple-personas": "/features/chatting-personality/multiple-personas/",
    "/features/behavior-tweaking": "/features/chatting-personality/behavior-tweaking/",
    "/features/memory": "/features/knowledge/memory/",
    "/features/personalization": "/features/knowledge/personalization/",
    "/features/data-handling": "/features/knowledge/data-handling/",
    "/features/tools-and-extensions": "/features/capabilities/tools-and-extensions/",
    "/features/scheduled-tasks": "/features/capabilities/scheduled-tasks/",
    "/features/media-generation": "/features/capabilities/media-generation/",
    "/features/media-generation/image-generation": "/features/capabilities/media-generation/image-generation/",
    "/features/media-generation/video-generation": "/features/capabilities/media-generation/video-generation/",
    "/features/media-generation/tts-and-stt": "/features/capabilities/media-generation/tts-and-stt/",
    "/features/providers-and-models": "/features/setup-administration/providers-and-models/",
    "/features/server-moderation": "/features/setup-administration/server-moderation/",
    "/features/age-restricted-commands": "/features/setup-administration/age-restricted-commands/",
    "/features/stats-and-insights": "/features/setup-administration/stats-and-insights/",
    "/features/matrix-bridge": "/features/integrations/matrix-bridge/",
    "/features/sillytavern-support": "/features/integrations/sillytavern-support/",
  },
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
      // i18n: `root` keeps every existing English URL unchanged (no /en/ prefix,
      // no index reset for search engines). Japanese pages live under docs/ja/
      // mirroring the English tree; untranslated pages fall back to English
      // content served at the /ja/ URL with a translation notice.
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        ja: { label: "日本語", lang: "ja" },
      },
      // Fallback meta description for pages without one (see routeMiddleware
      // below, which auto-derives per-page descriptions from page content).
      description:
        "Documentation for TomoriBot, a self-hostable AI Discord bot with persistent memory, multiple personas, media generation, and multi-provider LLM support.",
      plugins: [
        starlightLlmsTxt({
          exclude: ["wiki", "wiki/**"],
          customSets: [
            {
              label: "User and self-hosting documentation",
              description: "public user, feature, persona, and self-hosting docs for TomoriBot",
              paths: ["introduction/**", "features/**", "self-hosting/**", "meet-tomori/**"],
            },
            {
              label: "Contributor and architecture documentation",
              description: "developer implementation guides and code-level architecture references for TomoriBot",
              paths: ["contributing/**", "architecture/**"],
            },
          ],
        }),
      ],
      // SEO head tags: auto-derives per-page meta descriptions from each
      // page's first paragraph and noindexes internal wiki/ pages.
      routeMiddleware: "./src/routeData.ts",
      // Served from apps/docs/public/favicon.ico at the site root as /favicon.ico.
      favicon: "/favicon.ico",
      head: [
        {
          // 1200×630 social banner (Open Graph standard size). Served from
          // apps/docs/public/img/social-banner.png.
          tag: "meta",
          attrs: { property: "og:image", content: "https://docs.tomoribot.app/img/social-banner.png" },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:width", content: "1200" },
        },
        {
          tag: "meta",
          attrs: { property: "og:image:height", content: "630" },
        },
        {
          tag: "meta",
          attrs: {
            property: "og:image:alt",
            content: "TomoriBot | Open-Source AI Agent & Roleplay Bot for Discord",
          },
        },
        {
          // Large-image card: the og:image is a proper 1200×630 banner now,
          // so the stretched-square concern no longer applies.
          tag: "meta",
          attrs: { name: "twitter:card", content: "summary_large_image" },
        },
        {
          tag: "link",
          attrs: { rel: "icon", type: "image/x-icon", href: "/favicon.ico", sizes: "any" },
        },
        {
          // Browsers that support SVG favicons (Chrome, Firefox) prefer this over the
          // PNG/ICO fallbacks below, so it must come first in document order.
          tag: "link",
          attrs: { rel: "icon", type: "image/svg+xml", href: "/tomoricon.svg" },
        },
        {
          tag: "link",
          attrs: { rel: "icon", type: "image/png", href: "/tomoricon.png" },
        },
        {
          // iOS ignores SVG apple-touch-icons, so this must stay a raster PNG.
          tag: "link",
          attrs: { rel: "apple-touch-icon", href: "/tomoricon.png" },
        },
      ],
      customCss: ["/src/styles/custom.css"],
      // SiteTitle override renders /tomoricon.svg directly as a plain <img> in the nav header.
      // The standard `logo` config can't reference public/ files because it generates a Vite
      // import that expects an Astro image object { src, width, height }, not a URL string.
      components: {
        SiteTitle: "./src/components/SiteTitle.astro",
        // Prepends the "AI-generated" disclaimer note to every page.
        // Opt out per-page with `aiGenerated: false` in frontmatter.
        MarkdownContent: "./src/components/MarkdownContent.astro",
        // Resolves prev/next pager labels to each target page's real title, so
        // generic "Overview" sidebar labels don't leak into footer navigation.
        Pagination: "./src/components/Pagination.astro",
        // Appends a Ko-fi support link beside the GitHub icon in the header,
        // since Ko-fi isn't part of Starlight's built-in social icon set.
        SocialIcons: "./src/components/SocialIcons.astro",
      },
      // Starlight v0.33.0+ expects an array of link items instead of a keyed object.
      // Discord uses a built-in Starlight icon; Ko-fi is appended separately in the
      // SocialIcons override since it isn't part of Starlight's fixed icon set.
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/Bredrumb/TomoriBot" },
        { icon: "discord", label: "Discord", href: "https://discord.gg/bjCfHm9QsB" },
      ],
      sidebar,
    }),
  ],
});
