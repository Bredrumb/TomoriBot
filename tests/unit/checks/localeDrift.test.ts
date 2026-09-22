import { describe, expect, it } from "bun:test";
import {
  type DriftGitSource,
  analyzeLocaleDrift,
  blobKey,
  collectLocaleKeyLocations,
  createChronology,
  extractLocaleValues,
  findDriftedKeys,
  mapLinesToBaselines,
  normalizeLocaleValue,
} from "../../../scripts/devtools/localeDrift";

/**
 * Fixture history for the drift scan.
 *
 * The scan's correctness lives in the comparison between the current English and the English a
 * translation was written against, so these tests drive it through the injectable source rather
 * than a real checkout. A fixture states the history exactly, which a real repository cannot.
 */
interface FixtureOptions {
  /** Current file contents, as the committed tree would hold them. */
  head: Record<string, string>;
  /** Per-file line provenance: one revision id per line, in file order. */
  lines: Record<string, Record<number, string>>;
  /** Commit time in epoch seconds per revision id. Defaults to the id's position in `order`. */
  committedAt?: Record<string, number>;
  /** Revision ids oldest first, used to assign default commit times. */
  order?: string[];
  /** Content of older revisions, keyed by revision id. */
  revisions?: Record<string, Record<string, string>>;
  shallow?: boolean;
}

const ENGLISH_PATH = "src/locales/en-US/general.ts";
const JAPANESE_PATH = "src/locales/ja/general.ts";

function createFixtureSource(options: FixtureOptions): DriftGitSource {
  const revisions = options.revisions ?? {};
  const order = options.order ?? [...new Set(Object.values(options.lines).flatMap((file) => Object.values(file)))];

  const timeOf = (revision: string): number => {
    const explicit = options.committedAt?.[revision];
    if (explicit !== undefined) return explicit;
    const index = order.indexOf(revision);
    return index === -1 ? 0 : 1_700_000_000 + index * 86_400;
  };

  const fileAt = (revision: string, path: string): string | undefined => {
    if (revision === "HEAD") return options.head[path];
    return revisions[revision]?.[path];
  };

  return {
    listLocaleFiles: (locale) => Object.keys(options.head).filter((path) => path.startsWith(`src/locales/${locale}/`)),
    listTranslationLocales: () => ["ja"],
    blameFile: (path) => {
      const file = options.lines[path] ?? {};
      const lines = fileAt("HEAD", path)?.split("\n").length ?? 0;
      const provenance = [];
      for (let line = 1; line <= lines; line++) {
        const revision = file[line];
        if (revision) provenance.push({ line, revision, committedAt: timeOf(revision) });
      }
      return provenance;
    },
    readBlobs: (pairs) => {
      const blobs = new Map<string, string>();
      for (const { revision, path } of pairs) {
        const content = fileAt(revision, path);
        if (content !== undefined) blobs.set(blobKey(revision, path), content);
      }
      return blobs;
    },
    isShallow: () => options.shallow ?? false,
  };
}

function localeFile(entries: Array<[string, string]>): string {
  const body = entries.map(([key, value]) => `    ${key}: ${value},`).join("\n");
  return `export default {\n  general: {\n${body}\n  },\n};\n`;
}

/** Attributes every line of a file to one revision. */
function uniformLines(content: string, revision: string): Record<number, string> {
  const lines: Record<number, string> = {};
  for (let line = 1; line <= content.split("\n").length; line++) lines[line] = revision;
  return lines;
}

function scan(options: FixtureOptions): ReturnType<typeof analyzeLocaleDrift> {
  const source = createFixtureSource(options);
  return analyzeLocaleDrift({ locale: "ja", source, englishFiles: source.listLocaleFiles("en-US") });
}

describe("locale drift: key extraction", () => {
  it("records nested leaf keys with the inclusive range their value spans", () => {
    const source = localeFile([
      ["first_key", '"one"'],
      ["second_key", '"two"'],
    ]);

    const locations = collectLocaleKeyLocations(source);
    expect(locations.map((entry) => entry.key)).toEqual(["general.first_key", "general.second_key"]);
    expect(locations[0]).toMatchObject({ startLine: 3, endLine: 3 });
    expect(locations[1]).toMatchObject({ startLine: 4, endLine: 4 });
  });

  it("spans a multi-line value rather than recording only its first line", () => {
    const source = "export default {\n  general: {\n    wrapped: `one\n      two\n      three`,\n  },\n};\n";

    const [location] = collectLocaleKeyLocations(source);
    expect(location?.key).toBe("general.wrapped");
    expect(location?.startLine).toBe(3);
    expect(location?.endLine).toBe(5);
  });

  it("treats arrays as leaves so locale-specific lists are not flattened into index keys", () => {
    const source = 'export default {\n  general: {\n    words: ["a", "b"],\n  },\n};\n';

    expect(collectLocaleKeyLocations(source).map((entry) => entry.key)).toEqual(["general.words"]);
  });

  it("reads the value of a quoted string and a template literal identically", () => {
    const quoted = extractLocaleValues(localeFile([["key", '"Same text"']]));
    const template = extractLocaleValues(localeFile([["key", "`Same text`"]]));

    expect(quoted.get("general.key")).toBe("Same text");
    expect(template.get("general.key")).toBe("Same text");
  });

  it("returns no keys for a file without a default export object", () => {
    expect(collectLocaleKeyLocations("export const other = 1;\n")).toEqual([]);
    expect(extractLocaleValues("export default 42;\n").size).toBe(0);
  });
});

describe("locale drift: runtime-equivalent normalization", () => {
  it("dedents a wrapped value the way the localizer does, so a reflow is not a change", () => {
    // The first line sets the indent the runtime strips. Both of these collapse to
    // "\nOne sentence\ncontinued", so wrapping the value differently is not a content change.
    const wrapped = extractLocaleValues(localeFile([["key", "`\n      One sentence\n      continued`"]]));
    const differentlyIndented = extractLocaleValues(
      localeFile([["key", "`\n          One sentence\n          continued`"]]),
    );
    const singleLine = extractLocaleValues(localeFile([["key", '"One sentence continued"']]));

    expect(wrapped.get("general.key")).toBe("\nOne sentence\ncontinued");
    expect(wrapped.get("general.key")).toBe(differentlyIndented.get("general.key"));
    // A line break the runtime keeps is still a difference, so this cannot be a blanket collapse.
    expect(wrapped.get("general.key")).not.toBe(singleLine.get("general.key"));
  });

  it("keeps layout that the runtime preserves, so a meaningful newline change is a change", () => {
    // Markdown hard breaks, fenced blocks, and panel markers all survive the runtime dedent. A
    // collapse-everything comparison would call each of these pairs equal and hide the edit.
    expect(normalizeLocaleValue("Line one\nLine two")).not.toBe(normalizeLocaleValue("Line one Line two"));
    expect(normalizeLocaleValue("```\n/help\n```")).not.toBe(normalizeLocaleValue("``` /help ```"));
    expect(normalizeLocaleValue("-# first\n-# second")).not.toBe(normalizeLocaleValue("-# first -# second"));
  });

  it("leaves a single-line value untouched", () => {
    expect(normalizeLocaleValue("plain value")).toBe("plain value");
  });
});

describe("locale drift: line provenance", () => {
  const locations = [
    { key: "general.first", startLine: 1, endLine: 1 },
    { key: "general.second", startLine: 2, endLine: 2 },
  ];

  it("takes the newest revision across a key's range, ordered by commit time", () => {
    const chronology = createChronology(
      new Map([
        ["old", 1_700_000_000],
        ["new", 1_700_086_400],
      ]),
    );
    const provenance = [
      { line: 1, revision: "old", committedAt: 1_700_000_000 },
      { line: 2, revision: "new", committedAt: 1_700_086_400 },
    ];

    const baselines = mapLinesToBaselines(locations, provenance, chronology);
    expect(baselines.get("general.first")).toBe("old");
    expect(baselines.get("general.second")).toBe("new");
  });

  it("blames every line of a multi-line value, not only the line it opens on", () => {
    // The opening line is old, the closing line is newer. Blaming only the opening line would
    // attribute the whole value to the older commit and miss the edit that produced the value.
    const chronology = createChronology(
      new Map([
        ["aaa", 1_700_000_000],
        ["bbb", 1_700_086_400],
      ]),
    );
    const provenance = [
      { line: 1, revision: "aaa", committedAt: 1_700_000_000 },
      { line: 2, revision: "bbb", committedAt: 1_700_086_400 },
      { line: 3, revision: "bbb", committedAt: 1_700_086_400 },
    ];

    const baselines = mapLinesToBaselines(
      [{ key: "general.wrapped", startLine: 1, endLine: 3 }],
      provenance,
      chronology,
    );
    expect(baselines.get("general.wrapped")).toBe("bbb");
  });

  it("orders revisions by commit time rather than by id", () => {
    // Lexically "zzz" sorts after "aaa", but it was committed first. Comparing ids would pick it as
    // the newer baseline and compare against English from a month earlier.
    const chronology = createChronology(
      new Map([
        ["zzz", 1_700_000_000],
        ["aaa", 1_700_086_400],
      ]),
    );

    expect(chronology.isNewer("aaa", "zzz")).toBe(true);
    expect(chronology.isNewer("zzz", "aaa")).toBe(false);
    expect(chronology.date("aaa")).toBe(new Date(1_700_086_400 * 1000).toISOString().slice(0, 10));
  });

  it("returns an unknown date for a revision with no recorded time", () => {
    expect(createChronology(new Map()).date("missing")).toBe("unknown");
  });

  it("skips keys whose lines carry no provenance", () => {
    expect(mapLinesToBaselines(locations, [], createChronology(new Map())).size).toBe(0);
  });
});

describe("locale drift: comparison", () => {
  const chronology = createChronology(new Map([["aaa", 1_700_000_000]]));

  it("reports a key whose English moved after the translation", () => {
    const entries = findDriftedKeys({
      locale: "ja",
      localeValues: new Map([["general.key", "古い"]]),
      baselineByKey: new Map([["general.key", "aaa"]]),
      english: { current: () => "New English", atBaseline: () => "Old English" },
      chronology,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.enAtBaseline).toBe("Old English");
    expect(entries[0]?.en).toBe("New English");
    expect(entries[0]?.target).toBe("古い");
  });

  it("ignores a key whose English is unchanged since the translation", () => {
    const entries = findDriftedKeys({
      locale: "ja",
      localeValues: new Map([["general.key", "古い"]]),
      baselineByKey: new Map([["general.key", "aaa"]]),
      english: { current: () => "Old English", atBaseline: () => "Old English" },
      chronology,
    });

    expect(entries).toEqual([]);
  });

  it("ignores a key with no baseline provenance", () => {
    const entries = findDriftedKeys({
      locale: "ja",
      localeValues: new Map([["general.key", "古い"]]),
      baselineByKey: new Map(),
      english: { current: () => "New English", atBaseline: () => "Old English" },
      chronology,
    });

    expect(entries).toEqual([]);
  });

  it("ignores a key absent from the locale because parity owns missing keys", () => {
    const entries = findDriftedKeys({
      locale: "ja",
      localeValues: new Map(),
      baselineByKey: new Map([["general.key", "aaa"]]),
      english: { current: () => "New English", atBaseline: () => "Old English" },
      chronology,
    });

    expect(entries).toEqual([]);
  });

  it("ignores a key the baseline revision did not define", () => {
    const entries = findDriftedKeys({
      locale: "ja",
      localeValues: new Map([["general.key", "古い"]]),
      baselineByKey: new Map([["general.key", "aaa"]]),
      english: { current: () => "New English", atBaseline: () => undefined },
      chronology,
    });

    expect(entries).toEqual([]);
  });
});

describe("locale drift: end-to-end scan", () => {
  it("reports a key whose English changed after the translation landed", () => {
    const english = localeFile([["moved", "`New English`"]]);
    const japanese = localeFile([["moved", "`日本語`"]]);

    const report = scan({
      head: { [ENGLISH_PATH]: english, [JAPANESE_PATH]: japanese },
      lines: { [JAPANESE_PATH]: uniformLines(japanese, "aaa") },
      revisions: { aaa: { [ENGLISH_PATH]: localeFile([["moved", "`Old English`"]]) } },
      order: ["aaa"],
    });

    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]?.key).toBe("general.moved");
    expect(report.entries[0]?.enAtBaseline).toBe("Old English");
    expect(report.files[0]?.file).toBe("general.ts");
    expect(report.files[0]?.count).toBe(1);
  });

  it("does not report a key whose English is unchanged", () => {
    const english = localeFile([["stable", "`Unchanged`"]]);
    const japanese = localeFile([["stable", "`変わらない`"]]);

    const report = scan({
      head: { [ENGLISH_PATH]: english, [JAPANESE_PATH]: japanese },
      lines: { [JAPANESE_PATH]: uniformLines(japanese, "aaa") },
      revisions: { aaa: { [ENGLISH_PATH]: english } },
      order: ["aaa"],
    });

    expect(report.entries).toEqual([]);
    expect(report.files).toEqual([]);
  });

  it("does not report a key the translator retranslated in the language's newest commit", () => {
    const english = localeFile([["patched", "`Rewritten English`"]]);
    const japanese = localeFile([["patched", "`書き直した日本語`"]]);

    const report = scan({
      head: { [ENGLISH_PATH]: english, [JAPANESE_PATH]: japanese },
      lines: { [JAPANESE_PATH]: uniformLines(japanese, "bbb") },
      revisions: {
        aaa: { [ENGLISH_PATH]: localeFile([["patched", "`Original English`"]]) },
        bbb: { [ENGLISH_PATH]: english },
      },
      order: ["aaa", "bbb"],
    });

    expect(report.entries).toEqual([]);
  });

  it("ignores a formatting-only English change", () => {
    const english = localeFile([["reflowed", '"One sentence"']]);
    const japanese = localeFile([["reflowed", "`一つの文`"]]);

    const report = scan({
      head: { [ENGLISH_PATH]: english, [JAPANESE_PATH]: japanese },
      lines: { [JAPANESE_PATH]: uniformLines(japanese, "aaa") },
      revisions: {
        aaa: { [ENGLISH_PATH]: localeFile([["reflowed", "`One sentence`"]]) },
      },
      order: ["aaa"],
    });

    expect(report.entries).toEqual([]);
  });

  it("reports a change that only moves a runtime-preserved line break", () => {
    const english = localeFile([["layout", '"First line\\nSecond line"']]);
    const japanese = localeFile([["layout", "`一行目\n二行目`"]]);

    const report = scan({
      head: { [ENGLISH_PATH]: english, [JAPANESE_PATH]: japanese },
      lines: { [JAPANESE_PATH]: uniformLines(japanese, "aaa") },
      revisions: {
        aaa: { [ENGLISH_PATH]: localeFile([["layout", '"First line Second line"']]) },
      },
      order: ["aaa"],
    });

    expect(report.entries.map((entry) => entry.key)).toEqual(["general.layout"]);
  });

  it("separates keys with different baselines inside one file", () => {
    const english = localeFile([
      ["untouched", "`English moved`"],
      ["retranslated", "`English moved too`"],
    ]);
    const japanese = localeFile([
      ["untouched", "`未更新`"],
      ["retranslated", "`更新済み`"],
    ]);
    // Line 4 belongs to the newer commit, which is what a partial retranslation looks like.
    const lines = { ...uniformLines(japanese, "aaa"), 4: "bbb" };

    const report = scan({
      head: { [ENGLISH_PATH]: english, [JAPANESE_PATH]: japanese },
      lines: { [JAPANESE_PATH]: lines },
      revisions: {
        aaa: {
          [ENGLISH_PATH]: localeFile([
            ["untouched", "`English one`"],
            ["retranslated", "`English two`"],
          ]),
        },
        bbb: { [ENGLISH_PATH]: english },
      },
      order: ["aaa", "bbb"],
    });

    expect(report.entries.map((entry) => entry.key)).toEqual(["general.untouched"]);
  });

  it("reports a file's baseline span rather than one representative revision", () => {
    // Two findings in one file, from baselines a commit apart, which is the case a single
    // representative revision would misstate.
    const english = localeFile([
      ["early", "`English moved`"],
      ["late", "`English moved later`"],
    ]);
    const japanese = localeFile([
      ["early", "`早い`"],
      ["late", "`遅い`"],
    ]);
    const lines = { ...uniformLines(japanese, "aaa"), 4: "bbb" };

    const report = scan({
      head: { [ENGLISH_PATH]: english, [JAPANESE_PATH]: japanese },
      lines: { [JAPANESE_PATH]: lines },
      revisions: {
        aaa: {
          [ENGLISH_PATH]: localeFile([
            ["early", "`Old one`"],
            ["late", "`Old two`"],
          ]),
        },
        bbb: {
          [ENGLISH_PATH]: localeFile([
            ["early", "`Old one`"],
            ["late", "`Other two`"],
          ]),
        },
      },
      order: ["aaa", "bbb"],
    });

    expect(report.entries.map((entry) => entry.key)).toEqual(["general.early", "general.late"]);
    expect(report.files).toHaveLength(1);
    expect(report.files[0]?.count).toBe(2);
    expect(report.files[0]?.oldestBaselineRevision).toBe("aaa");
    expect(report.files[0]?.newestBaselineRevision).toBe("bbb");
  });

  it("skips a locale file that has no English counterpart", () => {
    const english = localeFile([["only", "`English`"]]);
    const orphan = localeFile([["only", "`孤立`"]]);

    const report = scan({
      head: { [ENGLISH_PATH]: english, "src/locales/ja/orphan.ts": orphan },
      lines: { "src/locales/ja/orphan.ts": uniformLines(orphan, "aaa") },
      revisions: { aaa: { [ENGLISH_PATH]: english } },
      order: ["aaa"],
    });

    expect(report.entries).toEqual([]);
    expect(report.files).toEqual([]);
  });

  it("reports nothing when a locale file has no blame history at all", () => {
    const english = localeFile([["moved", "`New English`"]]);

    const report = scan({
      head: { [ENGLISH_PATH]: english, [JAPANESE_PATH]: localeFile([["moved", "`日本語`"]]) },
      lines: {},
      revisions: { aaa: { [ENGLISH_PATH]: localeFile([["moved", "`Old English`"]]) } },
      order: ["aaa"],
    });

    // No baseline means nothing to compare against. Treating it as "every key is new" is the
    // avalanche this guard exists to prevent.
    expect(report.entries).toEqual([]);
  });

  it("reports the shallow state the CLI turns into its exit code", () => {
    const source = createFixtureSource({ head: {}, lines: {}, shallow: true });

    expect(source.isShallow()).toBe(true);
  });
});
