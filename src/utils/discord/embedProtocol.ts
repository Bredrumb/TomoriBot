import type { Embed, EmbedBuilder } from "discord.js";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";
import { getLocaleSubKeys, getSupportedLocales, hasLocaleKey, localizer } from "@/utils/text/localizer";

export type TargetEmbedType =
  | "memory_learning"
  | "reset"
  | "reminder_set"
  | "system_injection"
  | "scene_directive"
  | "compact_summary"
  | "compact_refresh"
  | "reward"
  | "punish"
  | "user_info_update"
  | "user_moderation";

export type ProtocolKind = TargetEmbedType | "diagnostic" | "reply_context";
type ProtocolEntry = { key: string; kind: ProtocolKind; match?: "template" | "prefix" };

/** These rendered strings are persisted in Discord and must remain recognizable after a locale ships. */
export const PROTOCOL_KEYS: ProtocolEntry[] = [
  ...[
    "server_memory_learned_title",
    "server_memory_updated_title",
    "server_memory_deleted_title",
    "personal_memory_learned_title",
    "personal_memory_updated_title",
    "personal_memory_deleted_title",
  ].map((name) => ({ key: `genai.self_teach.${name}`, kind: "memory_learning" as const, match: "template" as const })),
  { key: "tools.user_info_update.success_title", kind: "user_info_update", match: "template" },
  ...["block_mute_title", "block_block_title", "unmute_success_title", "unblock_success_title"].map((name) => ({
    key: `tools.user_block.${name}`,
    kind: "user_moderation" as const,
    match: "template" as const,
  })),
  { key: "commands.refresh.title", kind: "reset" },
  { key: "commands.impersonate.system_title", kind: "system_injection" },
  { key: "commands.generate.scene.success_title", kind: "scene_directive" },
  ...["summary_title", "roleplay_scene_title", "manual_entry_title"].map((name) => ({
    key: `commands.compact.${name}`,
    kind: "compact_summary" as const,
  })),
  ...["summary_title_refreshed", "roleplay_scene_title_refreshed", "manual_entry_title_refreshed"].map((name) => ({
    key: `commands.compact.${name}`,
    kind: "compact_refresh" as const,
  })),
  { key: "commands.compact.roleplay_character_title_prefix", kind: "compact_summary", match: "prefix" },
  ...["reminder_set_title", "recurring_task_set_title", "task_set_title"].map((name) => ({
    key: `reminders.${name}`,
    kind: "reminder_set" as const,
    match: "template" as const,
  })),
  ...[
    "fallback_used_title",
    "error_stream_timeout_title",
    "empty_response_title",
    "max_iterations_title",
    "no_response_title",
  ].map((name) => ({ key: `genai.${name}`, kind: "diagnostic" as const })),
  // Delivery-failure notices are diagnostic, not reminder_set: reminder_set would inject them into
  // every model turn, while diagnostic surfaces them only when self-debug is enabled.
  ...["reminder_triggered_title", "task_triggered_title"].map((name) => ({
    key: `reminders.${name}`,
    kind: "diagnostic" as const,
  })),
  ...["reply_context_description", "reply_context_author", "reply_context_footer"].map((name) => ({
    key: `genai.message_interaction.${name}`,
    kind: "reply_context" as const,
    match: "template" as const,
  })),
];

const EMBED_PROTOCOL_TOKEN = "[tomori:v1:";
const TOKEN_PATTERN = /\[tomori:v1:([a-z_]+)\]/;
const targetKinds = new Set<ProtocolKind>([
  "memory_learning",
  "reset",
  "reminder_set",
  "system_injection",
  "scene_directive",
  "compact_summary",
  "compact_refresh",
  "reward",
  "punish",
  "user_info_update",
  "user_moderation",
]);
const knownKinds = new Set<ProtocolKind>([...targetKinds, "diagnostic", "reply_context"]);

type Match = { key: string; kind: ProtocolKind; value: string; pattern?: RegExp; prefix?: boolean };
let exactTitles = new Map<string, Match>();
let templates: Match[] = [];
let prefixes: Match[] = [];

function placeholderSignature(value: string): string {
  return [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((match) => match[1])
    .sort()
    .join(",");
}

export function buildProtocolLookup(
  entries: readonly ProtocolEntry[],
  locales: readonly string[],
  read: (locale: string, key: string) => string | undefined,
): {
  exact: Map<string, Match>;
  templates: Match[];
  prefixes: Match[];
} {
  const exact = new Map<string, Match>();
  const seenValues = new Map<string, string>();
  const templateSignatures = new Map<string, string>();
  const dynamic: Match[] = [];
  const prefixMatches: Match[] = [];
  for (const locale of locales) {
    for (const entry of entries) {
      const value = read(locale, entry.key);
      if (value === undefined) continue;
      const previousKey = seenValues.get(value);
      if (previousKey && previousKey !== entry.key) {
        throw new Error(`Protocol title collision: ${previousKey} and ${entry.key} render as ${JSON.stringify(value)}`);
      }
      seenValues.set(value, entry.key);
      if (entry.match === "template") {
        const signature = placeholderSignature(value);
        const expected = templateSignatures.get(entry.key);
        if (!signature || (expected !== undefined && signature !== expected)) {
          throw new Error(`Protocol template placeholders differ for ${entry.key} in ${locale}`);
        }
        if (entry.kind !== "reply_context" && !value.replace(/\{[a-zA-Z0-9_]+\}/g, "").trim()) {
          throw new Error(`Protocol title template has no literal anchor: ${entry.key} in ${locale}`);
        }
        templateSignatures.set(entry.key, signature);
      }
      const match: Match = { ...entry, value };
      if (entry.match === "prefix") {
        if (value) prefixMatches.push({ ...match, prefix: true });
      } else if (entry.match === "template") {
        match.pattern = new RegExp(`^${escapeRegExp(value).replace(/\\\{[^}]+\\\}/g, ".+?")}$`);
        dynamic.push(match);
      } else {
        exact.set(value, match);
      }
    }
  }
  return { exact, templates: dynamic, prefixes: prefixMatches };
}

export function initializeEmbedProtocol(): void {
  for (const locale of getSupportedLocales()) {
    for (const namespace of ["commands.reward", "commands.punish"] as const) {
      for (const name of getLocaleSubKeys(locale, namespace)) {
        const key = `${namespace}.${name}.embed_title`;
        if (hasLocaleKey(locale, key) && !PROTOCOL_KEYS.some((entry) => entry.key === key)) {
          PROTOCOL_KEYS.push({ key, kind: namespace === "commands.reward" ? "reward" : "punish" });
        }
      }
    }
  }
  const lookup = buildProtocolLookup(PROTOCOL_KEYS, getSupportedLocales(), (locale, key) =>
    hasLocaleKey(locale, key) ? localizer(locale, key) : undefined,
  );
  exactTitles = lookup.exact;
  templates = lookup.templates;
  prefixes = lookup.prefixes;
}

export function classifyProtocolTitle(title: string | null | undefined): ProtocolKind | null {
  if (!title) return null;
  const exact = exactTitles.get(title);
  if (exact) return exact.kind;
  // Reply-context patterns match embed fields, never titles. The English URL field is a bare
  // placeholder, so including it here would accept every non-empty Japanese notice title.
  const template = templates.find((entry) => entry.kind !== "reply_context" && entry.pattern?.test(title));
  if (template) return template.kind;
  return prefixes.find((entry) => title.startsWith(entry.value))?.kind ?? null;
}

export function classifyProtocolEmbed(embed: Pick<Embed, "title" | "footer">): ProtocolKind | null {
  const marker = embed.footer?.text?.match(TOKEN_PATTERN)?.[1] as ProtocolKind | undefined;
  if (marker && knownKinds.has(marker)) return marker;
  return classifyProtocolTitle(embed.title);
}

export function isTargetProtocolKind(kind: ProtocolKind | null): kind is TargetEmbedType {
  return kind !== null && targetKinds.has(kind);
}

export function stampProtocolEmbed(embed: EmbedBuilder, kind: ProtocolKind, footerText?: string): EmbedBuilder {
  const token = `${EMBED_PROTOCOL_TOKEN}${kind}]`;
  const existingText = footerText ?? embed.data.footer?.text;
  const iconURL = embed.data.footer?.icon_url;
  return embed.setFooter({
    text: existingText ? `${existingText} · ${token}` : token,
    ...(iconURL ? { iconURL } : {}),
  });
}

export function getProtocolKindForKey(key: string): ProtocolKind | null {
  const entry = PROTOCOL_KEYS.find((item) => item.key === key);
  return entry?.kind ?? null;
}

export function matchesProtocolTemplateKey(key: string, text: string): boolean {
  if (templates.some((entry) => entry.key === key && entry.pattern?.test(text))) return true;
  for (const entry of exactTitles.values()) {
    if (entry.key === key && entry.value === text) return true;
  }
  return false;
}
