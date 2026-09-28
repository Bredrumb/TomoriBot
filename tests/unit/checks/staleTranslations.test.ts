import { describe, expect, it } from "bun:test";
import {
  EXPECTED_SCRIPT,
  filterUnfollowedReport,
  findStaleTranslations,
  isIntentionallySharedTranslation,
  looksLikeEnglish,
  unfollowedEntries,
} from "../../../scripts/devtools/findStaleTranslations";
import type { StalenessReport } from "../../../scripts/checks/checkLocaleStaleness";

describe("staleTranslations expected script detection", () => {
  it("maps all 32 Discord locales to their expected script family", () => {
    expect(EXPECTED_SCRIPT["en-US"]).toBe("latin");
    expect(EXPECTED_SCRIPT["pt-BR"]).toBe("latin");
    expect(EXPECTED_SCRIPT["es-419"]).toBe("latin");
    expect(EXPECTED_SCRIPT.fr).toBe("latin");
    expect(EXPECTED_SCRIPT.vi).toBe("latin");
    expect(EXPECTED_SCRIPT.ru).toBe("cyrillic");
    expect(EXPECTED_SCRIPT.bg).toBe("cyrillic");
    expect(EXPECTED_SCRIPT.uk).toBe("cyrillic");
    expect(EXPECTED_SCRIPT.ja).toBe("cjk");
    expect(EXPECTED_SCRIPT["zh-CN"]).toBe("cjk");
    expect(EXPECTED_SCRIPT["zh-TW"]).toBe("cjk");
    expect(EXPECTED_SCRIPT.ko).toBe("hangul");
    expect(EXPECTED_SCRIPT.el).toBe("greek");
    expect(EXPECTED_SCRIPT.hi).toBe("devanagari");
    expect(EXPECTED_SCRIPT.th).toBe("thai");
  });

  it("never flags Latin-script translations as likely_english", () => {
    // Portuguese
    expect(looksLikeEnglish("Configurações do servidor", "latin")).toBe(false);
    expect(looksLikeEnglish("Gerenciar permissões e canais", "latin")).toBe(false);

    // Spanish
    expect(looksLikeEnglish("Configuración del servidor", "latin")).toBe(false);

    // French
    expect(looksLikeEnglish("Paramètres du serveur", "latin")).toBe(false);
  });

  it("never flags Vietnamese as likely_english", () => {
    expect(EXPECTED_SCRIPT.vi).toBe("latin");
    expect(looksLikeEnglish("Cài đặt máy chủ", "latin")).toBe(false);
    expect(looksLikeEnglish("Quản lý quyền và kênh", "latin")).toBe(false);
  });

  it("flags untranslated English strings in Cyrillic locales and accepts Cyrillic", () => {
    expect(EXPECTED_SCRIPT.ru).toBe("cyrillic");

    // English string in Russian locale -> stale
    expect(looksLikeEnglish("Server configuration and settings", "cyrillic")).toBe(true);

    // Russian string -> not stale
    expect(looksLikeEnglish("Настройки сервера", "cyrillic")).toBe(false);

    // Mixed with numbers/emoji -> not stale if Cyrillic is present
    expect(looksLikeEnglish("Настройки #1 🎉", "cyrillic")).toBe(false);
  });

  it("flags untranslated English strings in CJK locales and accepts CJK", () => {
    expect(EXPECTED_SCRIPT.ja).toBe("cjk");
    expect(EXPECTED_SCRIPT["zh-CN"]).toBe("cjk");

    // English string in CJK locale -> stale
    expect(looksLikeEnglish("Server settings", "cjk")).toBe(true);

    // Japanese (Kanji, Hiragana, Katakana) -> not stale
    expect(looksLikeEnglish("サーバー設定", "cjk")).toBe(false);
    expect(looksLikeEnglish("こんにちは世界", "cjk")).toBe(false);

    // Chinese -> not stale
    expect(looksLikeEnglish("服务器设置", "cjk")).toBe(false);
  });

  it("flags untranslated English strings in Hangul locales and accepts Hangul", () => {
    expect(EXPECTED_SCRIPT.ko).toBe("hangul");

    // English string in Korean locale -> stale
    expect(looksLikeEnglish("Server settings", "hangul")).toBe(true);

    // Korean (Hangul) -> not stale
    expect(looksLikeEnglish("서버 설정", "hangul")).toBe(false);
  });

  it("does not classify non-empty Cyrillic or Hangul strings as intentionally shared (fixes false negative)", () => {
    // A Russian or Korean translation must NOT be treated as intentionally shared
    expect(isIntentionallySharedTranslation("some.key", "Привет мир")).toBe(false);
    expect(isIntentionallySharedTranslation("some.key", "안녕하세요")).toBe(false);
    expect(isIntentionallySharedTranslation("some.key", "Cài đặt")).toBe(false);
    expect(isIntentionallySharedTranslation("some.key", "設定")).toBe(false);
  });

  it("identifies genuinely shared templates with only placeholders, URLs, or symbols", () => {
    expect(isIntentionallySharedTranslation("some.key", "{user_id}")).toBe(true);
    expect(isIntentionallySharedTranslation("some.key", "https://docs.tomoribot.app/en/")).toBe(true);
    expect(isIntentionallySharedTranslation("some.key", "🎉 100%")).toBe(true);
    expect(isIntentionallySharedTranslation("commands.help.api-key.provider_choice_groq", "Groq")).toBe(true);
    expect(isIntentionallySharedTranslation("commands.help.api-key.provider_choice_nvidia", "NVIDIA NIM")).toBe(true);
  });

  it("rejects en-US as target locale and non-existent unauthored locales", async () => {
    expect(findStaleTranslations("en-US")).rejects.toThrow("translation target");
    expect(findStaleTranslations("fr")).rejects.toThrow("does not exist");
  });

  it("exports branch follow-up under the unfollowed reason", () => {
    const report: StalenessReport = {
      requestedBase: "origin/main",
      baseRevision: "base",
      headRevision: "head",
      includesUncommittedEdits: false,
      uncommittedLocalePaths: [],
      translationLocales: ["ja", "zh-CN"],
      added: [
        {
          key: "general.new_key",
          english: "New English",
          review: [],
          missing: [{ locale: "ja", present: false, touched: false }],
        },
      ],
      changed: [
        {
          key: "general.changed_key",
          english: "Current English",
          previousEnglish: "Previous English",
          review: [{ locale: "zh-CN", present: true, value: "现有翻译", touched: false }],
          missing: [],
        },
      ],
      removed: [{ key: "general.removed_key", before: "Removed English" }],
      localeEditCounts: new Map(),
      conflicts: new Set(),
    };

    expect(unfollowedEntries(report)).toEqual([
      {
        key: "general.new_key",
        en: "New English",
        previousEn: undefined,
        target: undefined,
        locale: "ja",
        reason: "unfollowed",
        change: "added",
      },
      {
        key: "general.changed_key",
        en: "Current English",
        previousEn: "Previous English",
        target: "现有翻译",
        locale: "zh-CN",
        reason: "unfollowed",
        change: "changed",
      },
    ]);
    expect(unfollowedEntries(report, "ja")).toHaveLength(1);
    const japaneseReport = filterUnfollowedReport(report, "ja");
    expect(japaneseReport.changed).toEqual([]);
    expect(japaneseReport.added[0]?.missing).toHaveLength(1);
    expect(japaneseReport.removed).toEqual(report.removed);
  });
});
