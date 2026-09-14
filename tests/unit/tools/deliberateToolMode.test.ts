import { beforeAll, describe, expect, it } from "bun:test";
import { getLocaleStringList, getSupportedLocales, initializeLocalizer } from "@/utils/text/localizer";
import {
  DELIBERATE_TOOL_PACK_KEYS,
  EXPLICIT_MEMORY_PACK_KEY,
  findIntentPackViolations,
  getIntentPackEntryProblem,
} from "@/utils/text/localeIntentPacks";
import {
  applyDeliberateToolAllowlist,
  getDeliberateToolAllowedNames,
  matchesLocaleDeliberateToolPack,
} from "@/utils/tools/deliberateToolMode";

const ALL_PACK_KEYS = [...Object.values(DELIBERATE_TOOL_PACK_KEYS), EXPLICIT_MEMORY_PACK_KEY];

describe("deliberate tool mode", () => {
  it("allows the unified web_search tool for web-search intent", () => {
    const allowedNames = getDeliberateToolAllowedNames("can you search the web for current TypeScript news?");

    expect(allowedNames).toContain("web_search");
  });

  it("keeps web_search visible after applying the deliberate allowlist", () => {
    const result = applyDeliberateToolAllowlist({
      providerLabel: "test",
      builtInTools: [{ name: "web_search" }, { name: "create_task" }],
      mcpFunctionNames: [],
      allowedToolNames: getDeliberateToolAllowedNames("look up today's AI news"),
    });

    expect(result.builtInTools.map((tool) => tool.name)).toEqual(["web_search"]);
  });

  it("allows update_task for reminder edit/delete intent", () => {
    expect(getDeliberateToolAllowedNames("cancel reminder ID:42")).toContain("update_task");
    expect(getDeliberateToolAllowedNames("reschedule that task for tomorrow")).toContain("update_task");
  });

  it("exposes create_task and update_task for reminder custom triggers", () => {
    const allowedNames = getDeliberateToolAllowedNames("scheduler please", { reminder: ["scheduler"] });

    expect(allowedNames).toContain("create_task");
    expect(allowedNames).toContain("update_task");
  });

  it("allows user blocking tools for block and unblock intent", () => {
    expect(getDeliberateToolAllowedNames("mute Alice for one hour")).toContain("block_user");
    expect(getDeliberateToolAllowedNames("remove the user block for Alice")).toContain("unblock_user");
  });

  it("exposes block_user and unblock_user for user-blocking custom triggers", () => {
    const allowedNames = getDeliberateToolAllowedNames("moderation please", {
      "user-blocking": ["moderation"],
    });

    expect(allowedNames).toContain("block_user");
    expect(allowedNames).toContain("unblock_user");
  });

  it("allows structured user info updates for naming, identity, and timezone requests", () => {
    for (const prompt of [
      "call me Sparrow",
      "change my pronouns to they/them",
      "set my UTC offset to 8",
      "clear my honorific",
    ]) {
      expect(getDeliberateToolAllowedNames(prompt)).toContain("update_user_info");
    }
  });

  it("exposes user info updates for its custom trigger target", () => {
    expect(getDeliberateToolAllowedNames("profile settings", { "user-info": ["profile settings"] })).toContain(
      "update_user_info",
    );
  });

  it("supports wildcard custom triggers without breaking regex triggers", () => {
    expect(getDeliberateToolAllowedNames("", { image: ["^"] })).toContain("generate_image");
    expect(
      getDeliberateToolAllowedNames("please sketch this", { image: [{ type: "regex", value: "\\bsketch\\b" }] }),
    ).toContain("generate_image");
    expect(getDeliberateToolAllowedNames("hello", { image: [{ type: "literal", value: "pic" }] })).not.toContain(
      "generate_image",
    );
  });

  it("exposes capability review and docs access for self-diagnostic questions", () => {
    const prompts = [
      "What model are you currently using?",
      "Is web search enabled for you?",
      "Why can't you generate images?",
      "Why do you forget conversations?",
      "How does TomoriBot memory work?",
    ];

    for (const prompt of prompts) {
      const allowedNames = getDeliberateToolAllowedNames(prompt);
      expect(allowedNames).toContain("review_capabilities");
      expect(allowedNames).toContain("fetch_url");
      expect(allowedNames).not.toContain("web_search");
    }
  });

  it("matches Japanese and Korean custom literals inside longer words", () => {
    expect(getDeliberateToolAllowedNames("リマインドしてね", { reminder: ["リマインド"] })).toContain("create_task");
    expect(getDeliberateToolAllowedNames("알림을 설정해 줘", { reminder: ["알림"] })).toContain("create_task");
  });

  it("treats a trailing * as a word-start stem and keeps whole-word matching otherwise", () => {
    expect(getDeliberateToolAllowedNames("me lembre amanhã", { reminder: ["lembr*"] })).toContain("create_task");
    expect(getDeliberateToolAllowedNames("vou relembrar", { reminder: ["lembr*"] })).not.toContain("create_task");
    expect(getDeliberateToolAllowedNames("nice pictures", { image: ["pic"] })).not.toContain("generate_image");
  });
});

describe("locale intent packs", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("exposes tools from an authored locale's pack regardless of the user's language", () => {
    expect(getDeliberateToolAllowedNames("明日の朝にリマインドして")).toContain("create_task");
    expect(getDeliberateToolAllowedNames("この画像を分析して")).toContain("analyze_image");
    expect(getDeliberateToolAllowedNames("hello there")).not.toContain("create_task");
    expect(matchesLocaleDeliberateToolPack("voice", "音声で知らせて")).toBe(true);
  });

  it("defines every pack as a string list in every authored locale", () => {
    for (const locale of getSupportedLocales()) {
      for (const key of ALL_PACK_KEYS) {
        expect(getLocaleStringList(locale, key)).toBeDefined();
      }
    }
  });

  it("ships no entry that the pack validator rejects", () => {
    expect(findIntentPackViolations(ALL_PACK_KEYS)).toEqual([]);
  });

  it("rejects regex syntax, wildcards, and single-character unspaced entries", () => {
    expect(getIntentPackEntryProblem("^")).toBe("regex_syntax");
    expect(getIntentPackEntryProblem("a*b")).toBe("regex_syntax");
    expect(getIntentPackEntryProblem("remind (me)")).toBe("regex_syntax");
    expect(getIntentPackEntryProblem("画")).toBe("too_short");
    expect(getIntentPackEntryProblem("알")).toBe("too_short");
    expect(getIntentPackEntryProblem("  ")).toBe("empty");
    expect(getIntentPackEntryProblem("lembr*")).toBeNull();
    expect(getIntentPackEntryProblem("画像")).toBeNull();
    expect(getIntentPackEntryProblem("don't forget")).toBeNull();
  });
});
