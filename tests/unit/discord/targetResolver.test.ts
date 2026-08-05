import { describe, expect, it } from "bun:test";
import { resolveUserTarget } from "@/utils/discord/targetResolver";
import { ContextItemTag, type ConversationUserReference, type StructuredContextItem } from "@/types/misc/context";
import type { ToolContext } from "@/types/tool/interfaces";
import { createParticipantAlias } from "@/utils/text/participants/aliases";
import { createDiscordUserKey, serializeParticipantKey } from "@/utils/text/participants/identity";

/**
 * Builds a minimal ToolContext carrying only the conversation-user metadata that
 * `resolveUserTarget`'s first (conversation) stage reads. That stage short-circuits
 * before any guild/client access, so a partial cast is safe for these cases.
 */
function buildContext(conversationUsers: ConversationUserReference[]): ToolContext {
  const contextItem: StructuredContextItem = {
    role: "user",
    parts: [{ type: "text", text: "" }],
    metadataTag: ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION,
    conversationUsers,
  };
  return { contextItems: [contextItem] } as unknown as ToolContext;
}

function buildIndexedContext(conversationUsers: ConversationUserReference[]): ToolContext {
  const targets = conversationUsers.map((reference) => {
    const key = createDiscordUserKey(reference.targetId);
    return {
      key,
      serializedKey: serializeParticipantKey(key),
      displayLabel: reference.displayLabel,
      primaryAlias: reference.displayLabel,
      targetId: reference.targetId,
      mentionable: reference.mentionable,
      inParticipantContext: true,
      aliases: reference.aliases.flatMap((value, index) => {
        const alias = createParticipantAlias({
          owner: key,
          value,
          source: index === 0 ? "saved_nickname" : "guild_nickname",
          purposes: ["tool_target"],
          exposure: "visible",
          priority: index,
        });
        return alias ? [alias] : [];
      }),
    };
  });
  return {
    contextItems: [
      {
        role: "user",
        parts: [{ type: "text", text: "" }],
        metadataTag: ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION,
        conversationUsers: [],
        participantTargetIndex: { targets },
      },
    ],
  } as unknown as ToolContext;
}

describe("resolveUserTarget — conversation stage primary-name precedence", () => {
  // Reproduces the real collision: the asking user is rendered as their DB
  // nickname "Misuzu" but carries server nickname "Bredrumb" as a secondary
  // alias, while a different account's actual name is "Bredrumb".
  const misuzu: ConversationUserReference = {
    targetId: "111",
    displayLabel: "Misuzu",
    aliases: ["Misuzu", "Bredrumb"],
    mentionable: true,
  };
  const bredrumb: ConversationUserReference = {
    targetId: "222",
    displayLabel: "Bredrumb",
    aliases: ["Bredrumb"],
    mentionable: true,
  };

  it("prefers the primary-name match over a colliding secondary alias", async () => {
    const result = await resolveUserTarget("Bredrumb", buildIndexedContext([misuzu, bredrumb]));

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.targetId).toBe("222");
      expect(result.displayLabel).toBe("Bredrumb");
      expect(result.source).toBe("conversation");
    }
  });

  it("still resolves the asking user by their primary (DB) name", async () => {
    const result = await resolveUserTarget("Misuzu", buildContext([misuzu, bredrumb]));

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.targetId).toBe("111");
    }
  });

  it("is case- and whitespace-insensitive for the primary-name tie-break", async () => {
    const result = await resolveUserTarget("  bReDrUmB  ", buildContext([misuzu, bredrumb]));

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.targetId).toBe("222");
    }
  });

  it("stays ambiguous when two users share the same primary display name", async () => {
    const bredrumbTwo: ConversationUserReference = {
      targetId: "333",
      displayLabel: "Bredrumb",
      aliases: ["Bredrumb"],
      mentionable: true,
    };
    const result = await resolveUserTarget("Bredrumb", buildContext([bredrumb, bredrumbTwo]));

    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates.map((candidate) => candidate.targetId).sort()).toEqual(["222", "333"]);
    }
  });

  it("stays ambiguous when the input only matches secondary aliases on multiple users", async () => {
    const ellen: ConversationUserReference = {
      targetId: "444",
      displayLabel: "Ellen",
      aliases: ["Ellen", "Bredrumb"],
      mentionable: true,
    };
    const result = await resolveUserTarget("Bredrumb", buildContext([misuzu, ellen]));

    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates.map((candidate) => candidate.targetId).sort()).toEqual(["111", "444"]);
    }
  });

  it("resolves a unique secondary-alias match (no regression in the common case)", async () => {
    const result = await resolveUserTarget("Bredrumb", buildContext([misuzu]));

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.targetId).toBe("111");
    }
  });
});
