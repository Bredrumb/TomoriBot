import { beforeAll, describe, expect, it } from "bun:test";
import type { Client, Embed } from "discord.js";
import { fitNovelAIPrompt } from "@/providers/novelai/promptFitting";
import { getNovelAIProfile } from "@/providers/novelai/modelProfiles";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { processEmbedsFromMessage } from "@/utils/chat/contextEmbeds";
import { buildConditioningInteractionEmbed } from "@/utils/conditioning/conditioningEmbed";
import { buildConditioningInteractionEvent } from "@/utils/conditioning/conditioningInteractionContext";
import { appendDialogueHistoryContext, DOCUMENT_HINT_TEMPLATE } from "@/utils/text/context/dialogueHistory";
import type { SimplifiedMessageForContext } from "@/utils/text/context/types";
import { initializeLocalizer } from "@/utils/text/localizer";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { createPersona } from "../../helpers/fixtures";
import { collectCaseFailures, localizedCopy, RUNTIME_LOCALES } from "../../helpers/localeCases";

beforeAll(initializeLocalizer);

async function history(messages: SimplifiedMessageForContext[]): Promise<StructuredContextItem[]> {
  const persona = createPersona({ persona_nickname: "Juno" });
  const contextItems: StructuredContextItem[] = [];
  await appendDialogueHistoryContext({
    contextItems,
    client: {} as Client,
    guildId: "fixture-guild",
    simplifiedMessageHistory: messages,
    botName: persona.persona_nickname,
    tomoriConfig: persona.config,
    tomoriState: persona,
    documentHintTemplate: DOCUMENT_HINT_TEMPLATE,
    includeTimestamps: false,
    isUserImpersonation: false,
    triggererFormattedName: "Bau",
    messageIdMap: new MessageIdMap(),
    uncensorInputOptions: { unicodeSpacesEnabled: false, sanitizeEnabled: false },
    convertMentions: async (text) => text,
  });
  return contextItems;
}

describe("NovelAI conversation annotations", () => {
  it("keeps raw reply text and literal system-looking quotations while excluding owned annotations", async () => {
    const original = "[System: a quotation]\ncutie";
    const annotated = `[System: generated reply metadata ref_1 ref_2]\n${original}`;
    const items = await history([
      {
        id: "reply",
        authorId: "fixture-bau",
        authorName: "Bau",
        authorType: "user",
        content: annotated,
        completionContent: original,
        imageAttachments: [],
        videoAttachments: [],
      },
      {
        id: "administrative-notice",
        authorId: "system-embed",
        authorName: "System",
        authorType: "user",
        content: "[System: administrative-payload]",
        completionContent: "",
        completionSpeaker: false,
        imageAttachments: [],
        videoAttachments: [],
      },
    ]);
    expect(items.some((item) => item.parts.some((part) => part.type === "text" && part.text.includes("ref_1")))).toBe(
      true,
    );
    for (const model of ["glm-4-6", "xialong-v1", "kayra-v1", "llama-3-erato-v1"]) {
      const prepared = fitNovelAIPrompt({
        contextItems: items,
        tomoriState: createPersona({ persona_nickname: "Juno" }),
        profile: getNovelAIProfile(model),
        window: 4096,
      });
      expect(prepared.prompt).not.toMatch(/ref_[12]/u);
      expect(prepared.prompt).toContain("[System: a quotation]");
      expect(prepared.prompt).toContain("Cutie.");
      expect(prepared.prompt).not.toContain("administrative-payload");
      expect(prepared.report.excluded.some((id) => id.includes("administrative-notice"))).toBe(true);
    }
    expect(items.find((item) => item.metadataTag === ContextItemTag.DIALOGUE_HISTORY)?.completionText).toContain(
      original,
    );
  });

  it("preserves localized gesture descriptions as actions and omits administrative notices", async () => {
    const cases = collectCaseFailures();
    for (const locale of RUNTIME_LOCALES) {
      for (const [type, actionKey] of [
        ["reward", "hug"],
        ["punish", "bonk"],
      ] as const) {
        const embed = buildConditioningInteractionEmbed({
          locale,
          type,
          actionKey,
          actorLabel: "Bau",
          targetName: "Juno",
          reasonText: "being kind",
          footerKey: null,
        }).toJSON() as Embed;
        const result = processEmbedsFromMessage({
          embeds: [embed],
          content: "",
          imageAttachments: [],
          isTomoriAuthoredMessage: true,
          selfDebugEnabled: false,
          tomoriNickname: "Juno",
        });
        const items = await history([
          {
            id: "gesture",
            authorId: "system-embed",
            authorName: "System",
            authorType: "user",
            content: result.content,
            completionContent: result.completionContent,
            completionSpeaker: false,
            imageAttachments: [],
            videoAttachments: [],
          },
        ]);
        cases.check(`${locale}:${actionKey}`, () => {
          expect(result.content).toStartWith("[System:");
          expect(result.completionContent).toStartWith("_");
          expect(result.completionContent).toContain("Bau");
          expect(result.completionContent).toContain("Juno");
          for (const model of ["glm-4-6", "xialong-v1", "kayra-v1", "llama-3-erato-v1"]) {
            const prepared = fitNovelAIPrompt({
              contextItems: items,
              tomoriState: createPersona({ persona_nickname: "Juno" }),
              profile: getNovelAIProfile(model),
              window: 4096,
            });
            expect(prepared.prompt).not.toContain("System:");
            expect(prepared.prompt).toContain("Bau");
          }
        });
      }
      cases.check(`${locale}:admin`, () => {
        const result = processEmbedsFromMessage({
          embeds: [
            {
              title: localizedCopy(locale, "genai.self_teach.server_memory_learned_title", {
                persona_nickname: "Juno",
              }),
              description: "administrative-payload",
            } as Embed,
          ],
          content: "",
          imageAttachments: [],
          isTomoriAuthoredMessage: true,
          selfDebugEnabled: false,
          tomoriNickname: "Juno",
        });
        expect(result.processedSystemEmbed).toBe(true);
        expect(result.completionContent).toBe("");
      });
    }
    cases.expectNoFailures();
  });

  it("keeps typed gesture fallback events without tool instructions for every profile", () => {
    const event = buildConditioningInteractionEvent({
      actorName: "Bau",
      targetName: "Juno",
      action: "hug",
      reason: "being kind",
      messageId: "gesture",
    });
    for (const model of ["glm-4-6", "xialong-v1", "kayra-v1", "llama-3-erato-v1"]) {
      const prepared = fitNovelAIPrompt({
        contextItems: [event],
        tomoriState: createPersona({ persona_nickname: "Juno" }),
        profile: getNovelAIProfile(model),
        window: 4096,
      });
      expect(prepared.prompt).toMatch(/\*Bau[^*]*Juno[^*]*\*/u);
      expect(prepared.prompt).not.toMatch(/System:|interact_with_target/u);
    }
  });
});
