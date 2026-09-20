import { LOCALE_ALIASES } from "@/constants/locales";

/**
 * Locale configuration for the docs site and for every docs destination the bot builds.
 *
 * This module is the single source of truth shared by three consumers, so it must stay
 * dependency-free: the bot runtime, `apps/docs/astro.config.mts`, and the Cloudflare Pages
 * Functions middleware that imported it into a worker bundle during deploy verification. An
 * import of any Node built-in or `@/` module other than the Discord locale registry would
 * break at least one of them.
 *
 * Publishing rule: a locale appears in `DOCS_LOCALES` with `docsTree: true` only after its
 * translated page tree exists under `docs/<id>/`. Discord clients can report a locale the site
 * has no content for, and a published locale root is a real route with a sidebar, a sitemap
 * entry, and an hreflang alternate. `tests/unit/docs/docsLocaleConfig.test.ts` fails when this
 * table and the `docs/` directory disagree.
 */
/** Notice copy a translated or generated page renders above its content. */
export interface DocsLocaleNotices {
  /** Page is still an unreviewed generated draft. */
  draftsTitle: string;
  draftsBody: string;
  /** Page is a generated translation of a human-written source page. */
  translatedTitle: string;
  /** Visible text of the link to the default-locale page, which the locale owns. */
  englishLinkText: string;
  /**
   * `{english}` is replaced with a link to the default-locale page. The surrounding sentence stays
   * in the template because a language may need different wording or a different link position.
   */
  translatedBody: string;
}

export interface DocsLocaleDefinition {
  /** Path segment and Starlight locale key, which are the same value by design. */
  id: string;
  /** Discord locale key that selects this tree, which differs from `id` for `en-US`. */
  botLocaleCode: string;
  /** Value Starlight uses for `hreflang` and for sidebar `translations` keys. */
  lang: string;
  /** Endonym shown in language pickers and used as the switcher label. */
  label: string;
  /** True only once the translated page tree exists under `docs/<id>/`. */
  docsTree: boolean;
  /** Snippet budget for auto-derived meta descriptions, in characters. */
  descriptionMaxLength: number;
}

/**
 * Per-locale prose the docs renderer shows for unreviewed pages. The default-locale copy is also
 * the notice shown on any page whose locale has no entry of its own, which keeps a newly
 * published locale readable while its notices are still being authored.
 */
const LOCALE_NOTICES: Record<string, DocsLocaleNotices> = {
  en: {
    draftsTitle: "Disclaimer",
    draftsBody:
      "This specific page uses temporary drafts written and maintained by Generative AI. While verified to be accurate, please cross-verify with source code.",
    translatedTitle: "About This Translation",
    englishLinkText: "English",
    translatedBody:
      "This page is a Generative AI translation of the {english} page. Check the English page if anything is unclear.",
  },
  ja: {
    draftsTitle: "免責事項",
    draftsBody:
      "このページは生成AIによって作成された下書きです。内容は確認済みですが、正確な情報はソースコードもあわせてご確認ください。",
    translatedTitle: "翻訳について",
    englishLinkText: "英語版",
    translatedBody: "このページは{english}を生成AIが翻訳したものです。不明な点がある場合は英語版をご確認ください。",
  },
  "pt-BR": {
    draftsTitle: "Aviso",
    draftsBody:
      "Esta página usa rascunhos temporários escritos e mantidos por IA generativa. Confira o código-fonte caso precise confirmar algum detalhe.",
    translatedTitle: "Sobre esta tradução",
    englishLinkText: "inglês",
    translatedBody:
      "Esta página é uma tradução por IA generativa da página em {english}. Consulte a página em inglês se algo não estiver claro.",
  },
  "es-419": {
    draftsTitle: "Aviso",
    draftsBody:
      "Esta página usa borradores temporales escritos y mantenidos por IA generativa. Consulta el código fuente si necesitas confirmar algún detalle.",
    translatedTitle: "Sobre esta traducción",
    englishLinkText: "inglés",
    translatedBody:
      "Esta página es una traducción por IA generativa de la página en {english}. Consulta la página en inglés si algo no queda claro.",
  },
  "zh-TW": {
    draftsTitle: "免責聲明",
    draftsBody: "這一頁目前使用生成式 AI 撰寫與維護的臨時草稿。內容雖已確認正確，仍請對照原始碼再次查核。",
    translatedTitle: "關於這份翻譯",
    englishLinkText: "英文版",
    translatedBody:
      "這一頁是 {english}的生成式 AI 翻譯。翻譯僅為方便閱讀，內容以英文版為準，若有不清楚的地方請查看英文頁面。",
  },
  vi: {
    draftsTitle: "Miễn trừ trách nhiệm",
    draftsBody:
      "Trang này sử dụng bản nháp tạm thời do AI tạo sinh viết và duy trì. Dù đã được xác minh tính chính xác, bạn vui lòng đối chiếu lại với mã nguồn.",
    translatedTitle: "Về bản dịch này",
    englishLinkText: "tiếng Anh",
    translatedBody:
      "Trang này là bản dịch bằng AI tạo sinh từ trang {english}. Hãy kiểm tra trang tiếng Anh nếu có điều gì chưa rõ.",
  },
  "zh-CN": {
    draftsTitle: "免责声明",
    draftsBody: "这一页目前使用生成式 AI 撰写与维护的临时草稿。内容虽已确认正确，仍请对照源代码再次查核。",
    translatedTitle: "关于这份翻译",
    englishLinkText: "英文版",
    translatedBody:
      "这一页是 {english}的生成式 AI 翻译。翻译仅为方便阅读，内容以英文版为准，若有不清楚的地方请查看英文页面。",
  },
};

function defineDocsLocale(definition: DocsLocaleDefinition): DocsLocaleDefinition & { notices: DocsLocaleNotices } {
  return { ...definition, notices: LOCALE_NOTICES[definition.id] ?? LOCALE_NOTICES.en };
}

/**
 * Every locale the project knows about, in the one display order each picker uses.
 *
 * The order is the product decision, not an alphabetization: English first, then the locales
 * grouped the way a reader scanning the switcher expects to find them. `LOCALE_DISPLAY_ORDER`
 * below re-exports it as Discord codes, so the docs language switcher, the repository README
 * row, and the bot's own `/personal language` picker all reorder together from this one edit.
 *
 * `docsTree: false` keeps a locale out of the published route set, out of the Accept-Language
 * match, and out of bot URLs, so a planned locale is safe to list here before its content exists.
 * Flipping the flag is what publishes the locale, and the flip must land in the same change as
 * the page tree plus the entries listed in docs/en/contributing/adding-locale/.
 */
export const DOCS_LOCALES = [
  defineDocsLocale({
    id: "en",
    // English is the default locale, so it is also the fallback every other locale resolves to.
    botLocaleCode: "en-US",
    lang: "en",
    label: "English",
    docsTree: true,
    // Google truncates Latin-script snippets near 160 characters but full-width scripts near 80.
    descriptionMaxLength: 160,
  }),
  defineDocsLocale({
    id: "ja",
    botLocaleCode: "ja",
    lang: "ja",
    label: "日本語",
    docsTree: true,
    descriptionMaxLength: 80,
  }),
  defineDocsLocale({
    id: "zh-TW",
    botLocaleCode: "zh-TW",
    lang: "zh-TW",
    label: "繁體中文",
    docsTree: true,
    descriptionMaxLength: 80,
  }),
  defineDocsLocale({
    id: "zh-CN",
    botLocaleCode: "zh-CN",
    lang: "zh-CN",
    label: "简体中文",
    docsTree: true,
    descriptionMaxLength: 80,
  }),
  defineDocsLocale({
    id: "es-419",
    botLocaleCode: "es-419",
    lang: "es-419",
    label: "Español (LATAM)",
    docsTree: true,
    descriptionMaxLength: 160,
  }),
  defineDocsLocale({
    id: "pt-BR",
    botLocaleCode: "pt-BR",
    lang: "pt-BR",
    label: "Português (Brasil)",
    docsTree: true,
    descriptionMaxLength: 160,
  }),
  defineDocsLocale({
    id: "vi",
    botLocaleCode: "vi",
    lang: "vi",
    label: "Tiếng Việt",
    docsTree: true,
    descriptionMaxLength: 160,
  }),
  defineDocsLocale({
    id: "fr",
    botLocaleCode: "fr",
    lang: "fr",
    label: "Français",
    docsTree: false,
    descriptionMaxLength: 160,
  }),
  defineDocsLocale({
    id: "ru",
    botLocaleCode: "ru",
    lang: "ru",
    label: "Русский",
    docsTree: false,
    descriptionMaxLength: 160,
  }),
  defineDocsLocale({
    id: "ko",
    botLocaleCode: "ko",
    lang: "ko",
    label: "한국어",
    docsTree: false,
    descriptionMaxLength: 80,
  }),
] as const;

/**
 * Display order for every language picker, keyed by Discord locale code.
 *
 * Exported as codes rather than docs ids because the bot's picker, its locale registry, and the
 * Discord localization maps all speak Discord codes, and `en` is the only id that differs.
 */
export const LOCALE_DISPLAY_ORDER: readonly string[] = DOCS_LOCALES.map((locale) => locale.botLocaleCode);

export type DocsLocaleId = (typeof DOCS_LOCALES)[number]["id"];

export type DocsLocaleConfig = (typeof DOCS_LOCALES)[number];

const DEFAULT_DOCS_LOCALE: DocsLocaleId = "en";

/** Locales whose page tree exists, so they are real routes rather than redirect-only entries. */
export const PUBLISHED_DOCS_LOCALES: readonly DocsLocaleId[] = DOCS_LOCALES.filter((locale) => locale.docsTree).map(
  (locale) => locale.id,
);

const DOCS_LOCALE_IDS: readonly DocsLocaleId[] = DOCS_LOCALES.map((locale) => locale.id);

/**
 * Discord keys that reuse another locale's docs tree, inverted from the bot's alias registry so a
 * single alias decision covers runtime strings and docs destinations. Spanish is authored once in
 * neutral Latin American register, and an `es-ES` client must land on the same pages.
 *
 * Keys are lowercased because every lookup normalizes the caller's tag first: an `Accept-Language`
 * range arrives lowercased, and object property access would otherwise miss `es-ES` entirely.
 */
export const DOCS_LOCALE_ALIASES: Readonly<Record<string, DocsLocaleId>> = Object.fromEntries(
  Object.entries(LOCALE_ALIASES)
    .filter(([alias, source]) => alias !== source && DOCS_LOCALE_IDS.includes(source))
    .map(([alias, source]) => [alias.toLowerCase(), source]),
);

/** Case-insensitive alias lookup, which is the only form any caller here can use. */
function aliasTargetOf(tag: string): DocsLocaleId | undefined {
  const normalized = tag.toLowerCase();
  const alias = DOCS_LOCALE_ALIASES[normalized] ?? DOCS_LOCALE_ALIASES[normalized.split("-")[0]];
  return alias ? publishedLocaleOf(alias) : undefined;
}

const docsLocaleById = new Map<string, DocsLocaleConfig>(DOCS_LOCALES.map((locale) => [locale.id, locale]));

export function getDocsLocaleConfig(id: string): DocsLocaleConfig | undefined {
  return docsLocaleById.get(id);
}

/** Locale used for a page whose own locale has no docs tree. */
export const DEFAULT_DOCS_LOCALE_ID: DocsLocaleId = DEFAULT_DOCS_LOCALE;

function publishedLocaleOf(id: string): DocsLocaleId | undefined {
  // Compared case-insensitively because an `Accept-Language` range arrives lowercased while the
  // table keeps each locale's canonical casing (`pt-BR`, `zh-TW`).
  const normalized = id.toLowerCase();
  return PUBLISHED_DOCS_LOCALES.find((published) => published.toLowerCase() === normalized);
}

/**
 * Resolves any locale identifier to a published docs locale.
 *
 * Order mirrors the bot's string resolution so a user never sees one language in the docs URL and
 * another in the interface copy around it: exact match, registered alias, unambiguous base
 * language, then the default locale. Ambiguity resolves to the default rather than picking a
 * variant, because `zh` has no defensible choice between `zh-TW` and `zh-CN`.
 */
export function resolveDocsLocale(locale: string): DocsLocaleId {
  const exact = publishedLocaleOf(locale);
  if (exact) return exact;

  // An alias is only usable once its source tree is published: pointing an `es-ES` reader at
  // `/es-419/` before that tree exists would send them to a route the site does not serve.
  const aliasTarget = aliasTargetOf(locale);
  if (aliasTarget) return aliasTarget;

  const [base] = locale.toLowerCase().split("-");
  const baseMatches = PUBLISHED_DOCS_LOCALES.filter((id) => id.split("-")[0].toLowerCase() === base);
  return baseMatches.length === 1 ? baseMatches[0] : DEFAULT_DOCS_LOCALE_ID;
}

/** `/en`-style path segment for a locale, already resolved to a published docs tree. */
function resolveDocsLocalePath(locale: string): string {
  return `/${resolveDocsLocale(locale)}`;
}

export interface DocsRouteMap {
  readonly [route: string]: string;
}

/**
 * Every docs destination the bot links to, as locale-less routes.
 *
 * Routes stay unprefixed here so `buildDocsUrl` is the only place that decides a locale prefix,
 * and `tests/unit/docs/docsRouteRegistry.test.ts` checks the whole table against the docs tree.
 */
export const DOCS_ROUTES = {
  QUICKSTART: "/introduction/quickstart/",
  FEATURES: "/features/",
  COMMAND_REFERENCE: "/features/command-reference/",
  CHATTING_TRIGGERS: "/features/chatting-personality/chatting-and-triggers/",
  ROLEPLAY_CHANNELS: "/features/chatting-personality/chatting-and-triggers/#roleplay-channels",
  MULTIPLE_PERSONAS: "/features/chatting-personality/multiple-personas/",
  BEHAVIOR_TWEAKING: "/features/chatting-personality/behavior-tweaking/",
  MEMORY: "/features/knowledge/memory/",
  SHORT_TERM_MEMORY: "/features/knowledge/memory/#short-term-memory-stm",
  MEMORY_TAGGING: "/features/knowledge/memory/#keyword-tags",
  DATA_HANDLING: "/features/knowledge/data-handling/",
  PERSONALIZATION: "/features/knowledge/personalization/",
  PERSONAL_SPOTLIGHT: "/features/knowledge/personalization/#personal-spotlight",
  PERSONAL_PROVIDERS: "/features/knowledge/personalization/#your-own-providers",
  TOOLS_EXTENSIONS: "/features/capabilities/tools-and-extensions/",
  MCP: "/features/capabilities/tools-and-extensions/#mcp-servers",
  DELIBERATE_TOOL_MODE: "/features/capabilities/tools-and-extensions/#deliberate-tool-mode",
  SCHEDULED_TASKS: "/features/capabilities/scheduled-tasks/",
  MEDIA_GENERATION: "/features/capabilities/media-generation/",
  TTS: "/features/capabilities/media-generation/tts-and-stt/#text-to-speech",
  STT: "/features/capabilities/media-generation/tts-and-stt/#speech-to-text",
  PROVIDERS_MODELS: "/features/setup-administration/providers-and-models/",
  API_KEYS: "/features/setup-administration/providers-and-models/#api-keys",
  CUSTOM_ENDPOINTS: "/features/setup-administration/providers-and-models/#custom-endpoints",
  SERVER_MODERATION: "/features/setup-administration/server-moderation/",
  QUOTAS: "/features/setup-administration/server-moderation/#cost-control-quotas",
  USER_BYOK: "/features/setup-administration/server-moderation/#user-byok-bring-your-own-key",
  AGE_RESTRICTED_COMMANDS: "/features/setup-administration/age-restricted-commands/",
  MATRIX_BRIDGE: "/features/integrations/matrix-bridge/",
  SILLYTAVERN_PROMPT_PRESETS: "/features/integrations/sillytavern-support/#prompt-presets",
  SELF_HOSTING: "/self-hosting/",
  SELF_HOSTING_SETUP_WIZARD: "/self-hosting/setup-wizard/",
  LOCAL_ENDPOINTS: "/self-hosting/local-endpoints/",
  COMFYUI_SETUP: "/self-hosting/local-endpoints/setup-comfyui/",
  LOCAL_MCP_SETUP: "/self-hosting/local-endpoints/setup-local-mcp/",
  LOCAL_TTS_SETUP: "/self-hosting/local-endpoints/text-to-speech/",
  LOCAL_STT_SETUP: "/self-hosting/local-endpoints/speech-to-text/",
  MAINTENANCE: "/self-hosting/maintenance/",
  SAFE_MIGRATION: "/self-hosting/safe-migration/",
  LOCAL_MONITORING: "/self-hosting/local-monitoring/",
  THREAT_MODELS: "/wiki/threat-models/",
} as const satisfies DocsRouteMap;

export type DocsRoute = (typeof DOCS_ROUTES)[keyof typeof DOCS_ROUTES];

/** Routes that are published only for some audiences, so callers can label an internal link. */
export const LEGAL_DOC_ROUTES = {
  "privacy-policy": "/legal/privacy-policy/",
  "terms-of-service": "/legal/terms-of-service/",
} as const satisfies DocsRouteMap;

export const DOCS_BASE_URL = "https://docs.tomoribot.app";

const PAGE_EXTENSION_PATTERN = /\.mdx?$/i;

/**
 * Normalizes a doc source path, relative to a locale root, into the entry id both locales share.
 *
 * `README.md`, `README.mdx`, `index.md`, and `index.mdx` all mean the directory root, and `.md` and
 * `.mdx` are interchangeable for the same page. Comparing normalized ids is what lets a counterpart
 * lookup treat `ja/x/index.md` as the translation of `en/x/README.mdx`, which a raw path comparison
 * would misread as a missing translation.
 */
export function normalizePageId(relativePath: string): string {
  return relativePath
    .replaceAll("\\", "/")
    .replace(/^\.?\//, "")
    .replace(/README\.mdx?$/i, "index")
    .replace(PAGE_EXTENSION_PATTERN, "");
}

/** URL path segment for a normalized page id, with the directory-root marker removed. */
export function pageIdToRoute(pageId: string): string {
  return pageId.replace(/(^|\/)index$/, "").replace(/\/+$/, "");
}

/**
 * Prefixes an authored locale onto a locale-less docs route.
 *
 * A locale with no docs tree falls back to the default locale, which keeps every bot link on a
 * route that exists instead of one that depends on a redirect. `path` may carry a fragment, and it
 * may be an absolute URL, which is returned untouched so a caller can pass a pre-built destination.
 */
export function buildLocalizedDocsPath(locale: string, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${resolveDocsLocalePath(locale)}${suffix}`;
}

/**
 * The default-locale page for a locale-less docs entry id, which the translation notice links to.
 *
 * The url is built here rather than with `buildLocalizedDocsPath` because the route for an entry id
 * ends in `/index`, which the docs route table writes as a directory root with a trailing slash.
 */
export function buildDefaultLocaleDocsPageUrl(baseId: string): string {
  const slug = baseId.replace(/(^|\/)index$/, "").replace(/\/+$/, "");
  return `${DOCS_BASE_URL}/${DEFAULT_DOCS_LOCALE_ID}/${slug ? `${slug}/` : ""}`;
}

/**
 * Picks the docs locale a browser's `Accept-Language` header asks for.
 *
 * Quality values are honored and `q=0` rejects a language outright, because the previous
 * `startsWith("ja")` test treated `ja;q=0, en` as a Japanese request. Ranges match a published
 * locale by exact code, alias, or base language; the first acceptable match wins, and anything
 * unmatched falls back to the default locale.
 */
export function matchAcceptLanguage(header: string | null | undefined): DocsLocaleId {
  const candidates = (header ?? "")
    .split(",")
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().split(";");
      const quality = parameters
        .map((parameter) => parameter.trim().match(/^q=([\d.]+)$/)?.[1])
        .find((value) => value !== undefined);
      return { tag: tag.trim().toLowerCase(), index, quality: quality ? Number(quality) : 1 };
    })
    .filter((candidate) => candidate.tag.length > 0 && !Number.isNaN(candidate.quality))
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const candidate of candidates) {
    if (candidate.quality <= 0) continue;

    // A wildcard states no preference beyond "something I can read", so the default locale answers it.
    if (candidate.tag === "*") return DEFAULT_DOCS_LOCALE_ID;

    const exact = publishedLocaleOf(candidate.tag);
    if (exact) return exact;

    // A range such as `pt` or `pt-PT` carries no locale of its own here, so it resolves through the
    // same alias-then-base-language order as an explicit bot locale rather than silently missing.
    const aliasTarget = aliasTargetOf(candidate.tag);
    if (aliasTarget) return aliasTarget;

    const base = candidate.tag.split("-")[0];
    const baseMatches = PUBLISHED_DOCS_LOCALES.filter((id) => id.split("-")[0].toLowerCase() === base);
    if (baseMatches.length === 1) return baseMatches[0];
  }

  return DEFAULT_DOCS_LOCALE_ID;
}
