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
  /** `{english}` is replaced with the link to the default-locale page. */
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
    translatedBody:
      "This page is a Generative AI translation of the {english} page. Check the English page if anything is unclear.",
  },
  ja: {
    draftsTitle: "免責事項",
    draftsBody:
      "このページは生成AIによって作成された下書きです。内容は確認済みですが、正確な情報はソースコードもあわせてご確認ください。",
    translatedTitle: "翻訳について",
    translatedBody: "このページは{english}を生成AIが翻訳したものです。不明な点がある場合は英語版をご確認ください。",
  },
};

function defineDocsLocale(definition: DocsLocaleDefinition): DocsLocaleDefinition & { notices: DocsLocaleNotices } {
  return { ...definition, notices: LOCALE_NOTICES[definition.id] ?? LOCALE_NOTICES.en };
}

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
  // Planned target locales. `docsTree: false` keeps the locale out of the published route set, out
  // of the Accept-Language match, and out of bot URLs, so adding the row here is safe before its
  // content exists. Flipping the flag is what publishes the locale, and the flip must land in the
  // same change as the page tree plus the entries listed in docs/en/contributing/adding-locale.md.
  defineDocsLocale({
    id: "pt-BR",
    botLocaleCode: "pt-BR",
    lang: "pt-BR",
    label: "Português (Brasil)",
    docsTree: false,
    descriptionMaxLength: 160,
  }),
  defineDocsLocale({
    id: "es-419",
    botLocaleCode: "es-419",
    lang: "es-419",
    label: "Español (Latinoamérica)",
    docsTree: false,
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
    id: "zh-TW",
    botLocaleCode: "zh-TW",
    lang: "zh-TW",
    label: "繁體中文",
    docsTree: false,
    descriptionMaxLength: 80,
  }),
  defineDocsLocale({
    id: "zh-CN",
    botLocaleCode: "zh-CN",
    lang: "zh-CN",
    label: "简体中文",
    docsTree: false,
    descriptionMaxLength: 80,
  }),
  defineDocsLocale({
    id: "vi",
    botLocaleCode: "vi",
    lang: "vi",
    label: "Tiếng Việt",
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
 */
export const DOCS_LOCALE_ALIASES: Readonly<Record<string, DocsLocaleId>> = Object.fromEntries(
  Object.entries(LOCALE_ALIASES)
    .filter(([alias, source]) => alias !== source && DOCS_LOCALE_IDS.includes(source))
    .map(([alias, source]) => [alias, source]),
);

const docsLocaleById = new Map<string, DocsLocaleConfig>(DOCS_LOCALES.map((locale) => [locale.id, locale]));

export function getDocsLocaleConfig(id: string): DocsLocaleConfig | undefined {
  return docsLocaleById.get(id);
}

/** Locale used for a page whose own locale has no docs tree. */
export const DEFAULT_DOCS_LOCALE_ID: DocsLocaleId = DEFAULT_DOCS_LOCALE;

function publishedLocaleOf(id: string): DocsLocaleId | undefined {
  return PUBLISHED_DOCS_LOCALES.find((published) => published === id);
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

  const [base] = locale.split("-");
  // An alias is only usable once its source tree is published: pointing an `es-ES` reader at
  // `/es-419/` before that tree exists would send them to a route the site does not serve.
  const alias = DOCS_LOCALE_ALIASES[locale] ?? DOCS_LOCALE_ALIASES[base];
  const aliasTarget = alias ? publishedLocaleOf(alias) : undefined;
  if (aliasTarget) return aliasTarget;

  const baseExact = publishedLocaleOf(base);
  if (baseExact) return baseExact;

  const baseMatches = PUBLISHED_DOCS_LOCALES.filter((id) => id.split("-")[0] === base);
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
    const alias = DOCS_LOCALE_ALIASES[candidate.tag] ?? DOCS_LOCALE_ALIASES[candidate.tag.split("-")[0]];
    const aliasTarget = alias ? publishedLocaleOf(alias) : undefined;
    if (aliasTarget) return aliasTarget;

    const base = candidate.tag.split("-")[0];
    const baseExact = publishedLocaleOf(base);
    if (baseExact) return baseExact;

    const baseMatches = PUBLISHED_DOCS_LOCALES.filter((id) => id.split("-")[0] === base);
    if (baseMatches.length === 1) return baseMatches[0];
  }

  return DEFAULT_DOCS_LOCALE_ID;
}
