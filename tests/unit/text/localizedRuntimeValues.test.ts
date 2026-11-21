import { beforeAll, describe, expect, it } from "bun:test";
import {
  formatLocaleInteger,
  getAllBaseTriggerWords,
  getBaseTriggerWords,
  getSupportedLocales,
  initializeLocalizer,
} from "@/utils/text/localizer";
import { formatDurationUnits, formatLocalizedDuration, formatTimeRemaining } from "@/utils/text/processors/formatters";
import { formatTimeWithOffset } from "@/utils/text/timezoneHelper";

const TWO_DAYS_21_HOURS_5_MINUTES = ((2 * 24 + 21) * 60 + 5) * 60_000;
const CHRISTMAS_AFTERNOON_UTC = new Date(Date.UTC(2026, 11, 25, 15, 0));

beforeAll(async () => {
  await initializeLocalizer();
});

describe("localized durations", () => {
  it("uses each target locale's own unit words and plural forms", () => {
    const expectedFragments: Record<string, string[]> = {
      "en-US": ["2 days", "21 hours", "5 minutes"],
      ja: ["日", "時間", "分"],
      "pt-BR": ["dias", "horas", "minutos"],
      "es-419": ["días", "horas", "minutos"],
      fr: ["jours", "heures", "minutes"],
      "zh-TW": ["天", "小時", "分鐘"],
      "zh-CN": ["天", "小时", "分钟"],
      vi: ["ngày", "giờ", "phút"],
      ru: ["2 дня", "21 час", "5 минут"],
      ko: ["일", "시간", "분"],
    };
    for (const [locale, fragments] of Object.entries(expectedFragments)) {
      const rendered = formatDurationUnits(TWO_DAYS_21_HOURS_5_MINUTES, locale);
      for (const fragment of fragments) {
        expect(rendered).toContain(fragment);
      }
    }
  });

  it("keeps the model-facing English phrasing unchanged", () => {
    expect(formatTimeRemaining(TWO_DAYS_21_HOURS_5_MINUTES)).toBe("2 days, 21 hours, and 5 minutes");
  });

  it("follows the authored locale and falls back to English with its sentence", () => {
    expect(formatLocalizedDuration(TWO_DAYS_21_HOURS_5_MINUTES, "ja")).toContain("時間");
    expect(formatLocalizedDuration(TWO_DAYS_21_HOURS_5_MINUTES, "de")).toContain("hours");
    expect(formatLocalizedDuration(0, "ja")).toBe("今すぐ");
    expect(formatLocalizedDuration(30_000, "ja")).toBe("1分未満");
  });
});

describe("localized absolute times and counts", () => {
  it("formats dates in the resolved authored locale and keeps English as the default", () => {
    expect(formatTimeWithOffset(CHRISTMAS_AFTERNOON_UTC, 0)).toContain("December");
    expect(formatTimeWithOffset(CHRISTMAS_AFTERNOON_UTC, 9, undefined, "ja")).toContain("2026年12月26日");
    expect(formatTimeWithOffset(CHRISTMAS_AFTERNOON_UTC, 0, undefined, "de")).toContain("December");
  });

  it("groups integers with the resolved authored locale", () => {
    expect(formatLocaleInteger(4120, "ja")).toBe("4,120");
    expect(formatLocaleInteger(4120.4, "en-US")).toBe("4,120");
  });
});

describe("base trigger-word reservation", () => {
  it("reserves the words of every authored locale it is given", () => {
    const reserved = getAllBaseTriggerWords();
    for (const locale of getSupportedLocales()) {
      for (const word of getBaseTriggerWords(locale)) {
        expect(reserved).toContain(word);
      }
    }
    expect(getAllBaseTriggerWords(["ja"])).toContain("トモリ");
    expect(getAllBaseTriggerWords([])).toEqual(getBaseTriggerWords("en-US"));
  });
});
