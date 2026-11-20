import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { describe, expect, it } from "bun:test";
import type { TomoriState } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import { resolveIdentityTarget, resolveUserTarget } from "@/utils/discord/targetResolver";
import {
  buildPreparedParticipantContext,
  createParticipantContextFixture,
  PARTICIPANT_FIXTURE_IDS,
} from "./fixtures/participantContextFixture";

function participantText(item: Awaited<ReturnType<typeof buildPreparedParticipantContext>>): string {
  const textPart = item.parts.find((part) => part.type === "text");
  return textPart?.type === "text" ? textPart.text : "";
}

describe("participant adversarial review regressions", () => {
  it("renders the active persona exactly once when its trigger and responder evidence are present", async () => {
    const fixture = createParticipantContextFixture();
    try {
      const firstMessage = fixture.history[0];
      if (!firstMessage) throw new Error("Participant fixture history is missing");
      fixture.history[0] = { ...firstMessage, content: "Tomori, please ask about maps." };

      const text = participantText(
        await buildPreparedParticipantContext(fixture, {
          responderPersonaIds: new Set([PARTICIPANT_FIXTURE_IDS.activePersona]),
        }),
      );

      expect(text.match(/^Tomori(?: \(This is you!\))?$/gmu)).toHaveLength(1);
      expect(text).toContain("Tomori (This is you!)");
    } finally {
      fixture.restoreRepositories();
    }
  });

  it("does not render a reference-only persona with no public profile fields", async () => {
    const fixture = createParticipantContextFixture();
    try {
      const emptyPersona = {
        ...fixture.personas[1],
        persona_id: 9,
        persona_lineage_id: 90,
        persona_nickname: "Empty Persona",
        trigger_words: ["empty-persona"],
        persona_attributes: [],
        physical_appearance_tags: [],
      } as TomoriState;
      fixture.personas.push(emptyPersona);
      const firstMessage = fixture.history[0];
      if (!firstMessage) throw new Error("Participant fixture history is missing");
      fixture.history[0] = { ...firstMessage, content: "Please ask empty-persona about maps." };

      const text = participantText(await buildPreparedParticipantContext(fixture));

      expect(text).not.toMatch(/^Empty Persona$/gmu);
    } finally {
      fixture.restoreRepositories();
    }
  });

  it("keeps a reference-only public persona as a status-bearing tool target", async () => {
    const fixture = createParticipantContextFixture();
    try {
      const referencedPersona = {
        ...fixture.personas[1],
        persona_id: 9,
        persona_lineage_id: 90,
        persona_nickname: "Kiyo",
        trigger_words: ["kiyo"],
        persona_attributes: [{ attribute_text: "Kiyo runs the archive.", is_public: true }],
        physical_appearance_tags: ["red hair"],
      } as TomoriState;
      fixture.personas.push(referencedPersona);
      const referencedPersonaId = referencedPersona.persona_id;
      if (referencedPersonaId === undefined) throw new Error("Fixture persona is missing its persona_id");

      let renderedItems: StructuredContextItem[] = [];
      const item = await buildPreparedParticipantContext(fixture, {
        onItems: (items) => {
          renderedItems = items;
        },
        responderPersonaIds: new Set([referencedPersonaId]),
      });
      const text = participantText(item);
      const target = item.conversationUsers?.find((candidate) => candidate.targetId === "persona:9");

      expect(text).toContain(`${referencedPersona.persona_nickname}\n`);
      const statusItem = renderedItems.find(
        (candidate) => candidate.metadataTag === ContextItemTag.KNOWLEDGE_USER_STATUS,
      );
      if (!statusItem) throw new Error("Referenced persona fixture lost its presence item");
      expect(
        participantText(statusItem)
          .split("\n")
          .some((line) => line.startsWith(`${referencedPersona.persona_nickname}: `)),
      ).toBe(true);
      expect(target).toMatchObject({
        targetId: "persona:9",
        displayLabel: "Kiyo",
        aliases: ["Kiyo"],
        mentionable: false,
      });
      const context = { contextItems: [item] } as unknown as ToolContext;
      await expect(resolveIdentityTarget("Kiyo", context, fixture.personas)).resolves.toMatchObject({
        status: "resolved",
        targetType: "persona",
        persona: { persona_id: referencedPersonaId },
      });
      await expect(resolveUserTarget("Kiyo", context)).resolves.toMatchObject({ status: "not_found" });
    } finally {
      fixture.restoreRepositories();
    }
  });

  it("uses Matrix display names as collision-only aliases for Discord mention handles", async () => {
    const fixture = createParticipantContextFixture();
    try {
      fixture.matrixUsers.set(PARTICIPANT_FIXTURE_IDS.matrix, "Alice Saved");

      const text = participantText(await buildPreparedParticipantContext(fixture));

      expect(text).not.toContain("Alice Saved (Mention: @{Alice Saved}");
      expect(text).toContain("Alice Saved (Mention: @{Alice Guild}");
    } finally {
      fixture.restoreRepositories();
    }
  });

  it("keeps historical persona aliases out of human collisions and labels appearance with the decorated name", async () => {
    const fixture = createParticipantContextFixture();
    try {
      const historicalKey = `persona:${PARTICIPANT_FIXTURE_IDS.historicalPersona}`;
      fixture.syntheticUsers.set(historicalKey, { displayName: "Alice Saved (sprite)", type: "persona" });
      const historicalPersona = fixture.personas.find(
        (persona) => persona.persona_id === PARTICIPANT_FIXTURE_IDS.historicalPersona,
      );
      if (!historicalPersona) throw new Error("Historical persona fixture is missing");
      historicalPersona.trigger_words = ["Alice Saved"];

      const text = participantText(await buildPreparedParticipantContext(fixture));

      expect(text).toContain("Alice Saved (Mention: @{Alice Guild}");
      expect(text).toContain("- Alice Saved (sprite)'s Physical Appearance: silver hair, violet eyes");
      expect(text).not.toContain("- Ren's Physical Appearance: silver hair, violet eyes");
    } finally {
      fixture.restoreRepositories();
    }
  });
});
