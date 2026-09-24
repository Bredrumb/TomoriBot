import { describe, expect, test } from "bun:test";
import { personaNamingConfigSchema } from "@/types/personaNaming";
import { formatUserName, resolveEffectiveUserNaming } from "@/utils/text/userNaming";

describe("formatUserName", () => {
  test.each([
    ["Mirri", "Master", "", "Master Mirri"],
    ["mirri", "@", "", "@mirri"],
    ["Mirri", "", "-san", "Mirri-san"],
    ["Mirri", "", "Jr.", "Mirri Jr."],
    ["スズメ", "マスター", "さん", "マスタースズメさん"],
    ["참새", "마스터", "님", "마스터참새님"],
  ])("formats %s with prefix %s and suffix %s", (nickname, prefix, suffix, expected) => {
    expect(formatUserName(nickname, prefix, suffix)).toBe(expected);
  });

  test.each([
    ["Misu", "Ms.", "", "Ms. Misu"],
    ["Mirri", "Dr.", "", "Dr. Mirri"],
    ["Mirri", "Yo!", "", "Yo! Mirri"],
    ["美鈴", "Ms.", "", "Ms. 美鈴"],
    ["Mirri", "O'", "", "O'Mirri"],
    ["Mirri", "super-", "", "Super-Mirri"],
    ["スズメ", "マスター", "", "マスタースズメ"],
  ])("spaces a prefix that closes on terminal punctuation but joins one that binds rightward (%s, %s)", (nickname, prefix, suffix, expected) => {
    expect(formatUserName(nickname, prefix, suffix)).toBe(expected);
  });

  test.each([
    ["Misuzu", "dad", "", "Dad Misuzu"],
    ["misuzu", "", "", "Misuzu"],
    ["Mirri", "xXxSlayerxXx", "", "xXxSlayerxXx Mirri"],
    ["Mirri", "eSports", "", "eSports Mirri"],
  ])("capitalizes an all-lowercase leading token but leaves stylized casing alone (%s, %s)", (nickname, prefix, suffix, expected) => {
    expect(formatUserName(nickname, prefix, suffix)).toBe(expected);
  });
});

describe("resolveEffectiveUserNaming", () => {
  test("resolves nickname and affixes independently through persona, global, and neutral fallbacks", () => {
    const resolved = resolveEffectiveUserNaming({
      global: {
        userNickname: "Mirri",
        prefixOverride: null,
        suffixOverride: "-san",
        addressingStyle: "masculine",
      },
      liveDisplayName: "Live Mirri",
      persona: {
        prefixes: { masculine: "Master", neutral: "Mx." },
        suffixes: { neutral: "friend" },
        addressTerms: { masculine: "bro", neutral: "fam" },
      },
    });

    expect(resolved).toEqual({
      nickname: "Mirri",
      prefix: "Master",
      suffix: "-san",
      formattedName: "Master Mirri-san",
      addressTerm: "bro",
    });
  });

  test("explicit-none affixes suppress global and persona values", () => {
    const resolved = resolveEffectiveUserNaming({
      global: {
        userNickname: "Mirri",
        prefixOverride: "Captain",
        suffixOverride: "Jr.",
        addressingStyle: "feminine",
      },
      liveDisplayName: "Live Mirri",
      persona: {
        prefixes: { feminine: "Mistress", neutral: "Mx." },
        suffixes: { feminine: "ma'am", neutral: "friend" },
        addressTerms: { neutral: "fam" },
      },
      preference: {
        nickname_override: null,
        prefix_override: "",
        suffix_override: "",
      },
    });

    expect(resolved.formattedName).toBe("Mirri");
    expect(resolved.addressTerm).toBe("fam");
  });

  test("missing gendered values fall back only to neutral", () => {
    const resolved = resolveEffectiveUserNaming({
      global: {
        userNickname: null,
        prefixOverride: null,
        suffixOverride: null,
        addressingStyle: "masculine",
      },
      liveDisplayName: "Mirri",
      persona: {
        prefixes: { feminine: "Mistress" },
        suffixes: { feminine: "Lady", neutral: "friend" },
        addressTerms: { feminine: "sis", neutral: "fam" },
      },
    });

    expect(resolved.prefix).toBe("");
    expect(resolved.suffix).toBe("friend");
    expect(resolved.addressTerm).toBe("fam");
    expect(resolved.formattedName).toBe("Mirri friend");
  });

  test("persona nickname overrides global and live names", () => {
    const resolved = resolveEffectiveUserNaming({
      global: {
        userNickname: "Global Mirri",
        prefixOverride: null,
        suffixOverride: null,
        addressingStyle: null,
      },
      liveDisplayName: "Live Mirri",
      preference: {
        nickname_override: "Persona Mirri",
        prefix_override: null,
        suffix_override: null,
      },
    });

    expect(resolved.nickname).toBe("Persona Mirri");
  });
});

describe("personaNamingConfigSchema", () => {
  test("requires a neutral address term for gendered terms", () => {
    expect(
      personaNamingConfigSchema.safeParse({
        prefixes: {},
        suffixes: {},
        addressTerms: { masculine: "bro" },
      }).success,
    ).toBe(false);
  });

  test("allows empty address terms and gendered affixes without neutral values", () => {
    expect(
      personaNamingConfigSchema.safeParse({
        prefixes: { masculine: "Master" },
        suffixes: { feminine: "Lady" },
        addressTerms: {},
      }).success,
    ).toBe(true);
  });
});
