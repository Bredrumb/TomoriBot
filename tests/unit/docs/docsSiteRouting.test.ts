import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildHreflangAlternates,
  deriveDescription,
  entryFileCandidates,
  entryRoute,
  findEntryFile,
  localeFromEntryId,
  localesWithEntry,
  resolveTranslationNoticeMode,
  sourceIsHumanWritten,
  stripLocaleFromEntryId,
  withoutHreflangAlternates,
} from "../../../apps/docs/src/docsRouting";

const SITE = "https://docs.example.test";

/**
 * A three-locale fixture whose middle locale is deliberately incomplete, which is the shape that
 * makes a fallback route and a real translation differ.
 */
const FIXTURE_FILES: Record<string, string> = {
  "en/features/README.md": '---\ntitle: "Features"\n---\n\nFeature index.\n',
  "en/features/pair.md": '---\ntitle: "Paired Page"\n---\n\nEnglish pair.\n',
  "en/features/only-english.md": '---\ntitle: "English Only"\n---\n\nOnly English.\n',
  "en/features/human.md": '---\ntitle: "Human Page"\naiGenerated: false\n---\n\nWritten by a person.\n',
  "en/features/generated.md": '---\ntitle: "Generated Page"\n---\n\nGenerated draft.\n',
  "ja/features/README.md": '---\ntitle: "機能"\n---\n\n機能一覧。\n',
  "ja/features/pair.md": '---\ntitle: "対訳ページ"\n---\n\n日本語の対訳。\n',
  "ja/features/human.md": '---\ntitle: "人力ページ"\n---\n\n人が書いたページの翻訳。\n',
};

let docsRoot: string;

describe("docs site routing", () => {
  beforeAll(async () => {
    const workspace = await mkdtemp(join(tmpdir(), "tomori-docs-routing-"));
    for (const [relativePath, content] of Object.entries(FIXTURE_FILES)) {
      const absolutePath = join(workspace, relativePath);
      await mkdir(join(absolutePath, ".."), { recursive: true });
      await writeFile(absolutePath, content);
    }
    docsRoot = workspace;
  });

  afterAll(async () => {
    await rm(docsRoot, { recursive: true, force: true });
  });

  it("reads the locale from an entry id and leaves an unprefixed id alone", () => {
    expect(localeFromEntryId("ja/features/README")).toBe("ja");
    expect(localeFromEntryId("features/README")).toBeUndefined();
    expect(stripLocaleFromEntryId("ja/features/pair")).toBe("features/pair");
    expect(stripLocaleFromEntryId("features/pair")).toBe("features/pair");
  });

  it("enumerates the source filenames for a page and for a directory index", () => {
    expect(entryFileCandidates("features/pair")).toEqual(["features/pair.md", "features/pair.mdx"]);
    expect(entryFileCandidates("features/index")).toEqual([
      "features/README.md",
      "features/README.mdx",
      "features/index.md",
      "features/index.mdx",
    ]);
    expect(entryFileCandidates("index")).toContain("README.mdx");
  });

  it("finds a file for a page and a directory index without doubling the id", () => {
    expect(findEntryFile(docsRoot, "ja", "features/pair")).toBe(join(docsRoot, "ja", "features", "pair.md"));
    expect(findEntryFile(docsRoot, "ja", "features/index")).toBe(join(docsRoot, "ja", "features", "README.md"));
  });

  it("reports the locales that really have a page", () => {
    expect(localesWithEntry(docsRoot, "features/pair")).toEqual(["en", "ja"]);
    expect(localesWithEntry(docsRoot, "features/only-english")).toEqual(["en"]);
  });

  it("builds directory-style routes, including the locale root", () => {
    expect(entryRoute("ja", "features/pair")).toBe("/ja/features/pair/");
    expect(entryRoute("en", "features/index")).toBe("/en/features/");
    expect(entryRoute("en", "index")).toBe("/en/");
  });

  describe("hreflang alternates", () => {
    it("emits one alternate per locale that has the page, plus x-default", () => {
      const alternates = buildHreflangAlternates(docsRoot, "features/pair", {
        isFallback: false,
        site: SITE,
      });

      expect(alternates).toEqual([
        { tag: "link", attrs: { rel: "alternate", hreflang: "en", href: `${SITE}/en/features/pair/` } },
        { tag: "link", attrs: { rel: "alternate", hreflang: "ja", href: `${SITE}/ja/features/pair/` } },
        {
          tag: "link",
          attrs: { rel: "alternate", hreflang: "x-default", href: `${SITE}/en/features/pair/` },
        },
      ]);
    });

    it("emits nothing for a locale-fallback route", () => {
      expect(buildHreflangAlternates(docsRoot, "features/only-english", { isFallback: true, site: SITE })).toEqual([]);
    });

    it("emits nothing when only one locale has the page", () => {
      expect(buildHreflangAlternates(docsRoot, "features/only-english", { isFallback: false, site: SITE })).toEqual([]);
    });

    it("strips every alternate Starlight emitted, including x-default", () => {
      const head = [
        { tag: "link", attrs: { rel: "canonical", href: `${SITE}/ja/features/pair/` } },
        { tag: "link", attrs: { rel: "alternate", hreflang: "en", href: `${SITE}/en/features/pair/` } },
        { tag: "link", attrs: { rel: "alternate", hreflang: "x-default", href: `${SITE}/en/` } },
        { tag: "meta", attrs: { name: "description", content: "kept" } },
      ];

      expect(withoutHreflangAlternates(head)).toEqual([
        { tag: "link", attrs: { rel: "canonical", href: `${SITE}/ja/features/pair/` } },
        { tag: "meta", attrs: { name: "description", content: "kept" } },
      ]);
    });
  });

  describe("translation notice mode", () => {
    it("shows nothing on a human-reviewed page", () => {
      expect(
        resolveTranslationNoticeMode({
          docsRoot,
          entryId: "ja/features/pair",
          locale: "ja",
          aiGenerated: false,
        }),
      ).toBe("none");
    });

    it("shows the translated notice when the source page is human-written", () => {
      expect(
        resolveTranslationNoticeMode({
          docsRoot,
          entryId: "ja/features/human",
          locale: "ja",
          aiGenerated: true,
        }),
      ).toBe("translated");
    });

    it("shows the drafts notice when the source page is itself a generated draft", () => {
      expect(
        resolveTranslationNoticeMode({
          docsRoot,
          entryId: "ja/features/generated",
          locale: "ja",
          aiGenerated: true,
        }),
      ).toBe("drafts");
    });

    it("shows the locale's own drafts notice on a fallback route", () => {
      // A fallback route carries the default locale's entry, so the mode is decided by the route
      // locale the reader is on, not by the entry's id prefix.
      expect(
        resolveTranslationNoticeMode({
          docsRoot,
          entryId: "en/features/only-english",
          locale: "ja",
          aiGenerated: true,
        }),
      ).toBe("drafts");
    });

    it("detects the human-authored flag only when it is exactly false", () => {
      expect(sourceIsHumanWritten("---\naiGenerated: false\n---\n")).toBe(true);
      expect(sourceIsHumanWritten("---\naiGenerated: true\n---\n")).toBe(false);
      expect(sourceIsHumanWritten("no frontmatter")).toBe(false);
    });
  });

  describe("meta description derivation", () => {
    it("returns the first prose paragraph with inline markup removed", () => {
      const body =
        'import { Card } from "@astrojs/starlight/components";\n\n# Heading\n\nUse the [setup guide](/self-hosting/) for `docker`.';
      expect(deriveDescription(body, 160)).toBe("Use the setup guide for docker.");
    });

    it("honors the locale's character budget", () => {
      const body = "one two three four five six";
      expect(deriveDescription(body, 11)).toBe("one two…");
      expect(deriveDescription(body, 100)).toBe(body);
    });
  });
});
