import { afterEach, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
import { processEmbedsFromMessage } from "@/utils/chat/contextEmbeds";
import { minimalNoticeRefRepository } from "@/utils/db/repositories/MinimalNoticeRefRepository";
import { buildGeneratedImageComponentsV2Payload } from "@/utils/discord/generatedImageMessage";
import { buildGeneratedVideoComponentsV2Payload } from "@/utils/discord/generatedVideoMessage";
import { resolveMinimalNoticeBodies } from "@/utils/discord/minimalNoticeBodies";
import { hasLocaleKey, initializeLocalizer } from "@/utils/text/localizer";
import { expectForEveryLocale, localizedCopy } from "../../helpers/localeCases";

beforeAll(initializeLocalizer);
afterEach(() => mock.restore());

describe("generated media source captions", () => {
  test("keeps detailed captions localized and readable in later model and completion history", () => {
    expectForEveryLocale((locale) => {
      const source = { provider: "openrouter", model: "fixture/model" };
      const payloads = [
        buildGeneratedImageComponentsV2Payload("image.png", 1000, locale, ["Mirri", "Juno"], true, false, source),
        buildGeneratedVideoComponentsV2Payload("video.mp4", 1000, locale, false, source),
      ];
      for (const payload of payloads) {
        const components = payload.components.map((component) => ({ toJSON: () => component }));
        const result = processEmbedsFromMessage({
          embeds: [],
          components,
          content: "",
          imageAttachments: [],
          isTomoriAuthoredMessage: true,
          selfDebugEnabled: false,
          tomoriNickname: "Mirri",
        });
        const sourceLocale = hasLocaleKey(locale, "tools.media.generation_source_line") ? locale : "en-US";
        const sourceLine = localizedCopy(sourceLocale, "tools.media.generation_source_line", {
          provider: "OpenRouter",
          model: "`fixture/model`",
        });
        expect(result.content).toContain(sourceLine);
        expect(result.completionContent).toContain(sourceLine);
        expect(result.processedSystemEmbed).toBe(false);
        const restored = processEmbedsFromMessage({
          embeds: [],
          components,
          minimalNoticeBody: localizedCopy("en-US", "tools.media.generation_source_line", {
            provider: "OpenRouter",
            model: "`fixture/model`",
          }),
          content: "",
          imageAttachments: [],
          isTomoriAuthoredMessage: true,
          selfDebugEnabled: false,
          tomoriNickname: "Mirri",
        });
        expect(restored.content.match(/fixture\/model/g)).toHaveLength(1);
        expect(restored.completionContent.match(/fixture\/model/g)).toHaveLength(1);
        expect(restored.content).toBe(result.content);
        expect(restored.completionContent).toBe(result.completionContent);
        const footerLines = [
          localizedCopy(locale, "tools.image.generated_after_seconds_line", { seconds: "1.0" }),
          localizedCopy(locale, "commands.generate.image.prompt_attached_footer"),
          localizedCopy(locale, "tools.image.referenced_identities_line", { names: "Mirri, Juno" }),
        ];
        if (payload === payloads[0]) {
          for (const line of footerLines) {
            expect(restored.content).toContain(line);
            expect(restored.completionContent).toContain(line);
          }
        } else {
          const timingLine = localizedCopy(locale, "tools.video.generated_after_seconds_line", { seconds: "1.0" });
          expect(restored.content).toContain(timingLine);
          expect(restored.completionContent).toContain(timingLine);
        }
      }
    });
  });

  test("does not duplicate localized source content on detailed attachment-only fallback", () => {
    expectForEveryLocale((locale) => {
      const sourceLine = localizedCopy(locale, "tools.media.generation_source_line", {
        provider: "OpenRouter",
        model: "`fixture/model`",
      });
      const result = processEmbedsFromMessage({
        embeds: [],
        components: [],
        minimalNoticeBody: localizedCopy("en-US", "tools.media.generation_source_line", {
          provider: "OpenRouter",
          model: "`fixture/model`",
        }),
        content: sourceLine,
        completionContent: sourceLine,
        imageAttachments: [],
        isTomoriAuthoredMessage: true,
        selfDebugEnabled: false,
        tomoriNickname: "Mirri",
      });
      expect(result.content).toBe(sourceLine);
      expect(result.completionContent).toBe(sourceLine);
      expect(result.processedSystemEmbed).toBe(false);
    });
  });

  test("restores hidden source details for minimal media and attachment-only delivery", async () => {
    const source = { provider: "openrouter", model: "fixture/model" };
    const sourceLine = localizedCopy("en-US", "tools.media.generation_source_line", {
      provider: "OpenRouter",
      model: "`fixture/model`",
    });
    const payloads = [
      buildGeneratedImageComponentsV2Payload("image.png", 1000, "en-US"),
      buildGeneratedVideoComponentsV2Payload("video.mp4", 1000, "en-US"),
      { components: [] },
    ];
    spyOn(minimalNoticeRefRepository, "resolveByMessageIds").mockResolvedValue(
      new Map([
        [
          "generated",
          {
            message_disc_id: "generated",
            ref_kind: "generation",
            ref_id: null,
            generation_source: source,
            memory_content: null,
            memory_tags: null,
            reminder_purpose: null,
          },
        ],
      ]),
    );
    for (const payload of payloads) {
      expect(JSON.stringify(payload)).not.toContain(source.model);
      const bodies = await resolveMinimalNoticeBodies([
        { id: "generated", components: payload.components, attachments: { size: 1 } },
      ]);
      const result = processEmbedsFromMessage({
        embeds: [],
        components: payload.components,
        minimalNoticeBody: bodies.get("generated"),
        content: "",
        imageAttachments: [],
        isTomoriAuthoredMessage: true,
        selfDebugEnabled: false,
        tomoriNickname: "Mirri",
      });
      expect(result.content).toContain(sourceLine);
      expect(result.completionContent).toContain(sourceLine);
      expect(result.processedSystemEmbed).toBe(false);
    }
  });

  test("does not admit unrelated notice footers or another author's media footer", () => {
    const payload = buildGeneratedImageComponentsV2Payload("image.png", 1000, "en-US", [], false, false, {
      provider: "openrouter",
      model: "fixture/model",
    });
    for (const [components, isTomoriAuthoredMessage] of [
      [payload.components, false],
      [payload.components.slice(1), true],
    ] as const) {
      const result = processEmbedsFromMessage({
        embeds: [],
        components,
        content: "",
        imageAttachments: [],
        isTomoriAuthoredMessage,
        selfDebugEnabled: true,
        tomoriNickname: "Mirri",
      });
      expect(result.content).toBe("");
      expect(result.completionContent).toBe("");
    }
  });
});
