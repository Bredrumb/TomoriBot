import { describe, expect, test } from "bun:test";
import { Collection, type Message } from "discord.js";
import type { PersonaSpriteRow } from "@/types/db/schema";
import { answersQueuedTriggerMessage, buildQueuedReplyDirective } from "@/utils/chat/contextDirectives";
import { buildPersonaSpritePromptText } from "@/utils/text/context/personaSprites";

function makeQueuedMessage(content: string): Message {
  return {
    id: "1531509478955155539",
    content,
    cleanContent: content,
    attachments: new Collection<string, unknown>(),
    stickers: new Collection<string, unknown>(),
  } as unknown as Message;
}

function makeSprite(spriteName: string): PersonaSpriteRow {
  return {
    sprite_name: spriteName,
    sprite_key: spriteName.toLowerCase(),
    usage_instructions: "Use when flustered.",
    avatar_url: "https://example.invalid/sprite.png",
    is_identity: false,
    persona_id: 1,
  } as unknown as PersonaSpriteRow;
}

describe("buildQueuedReplyDirective", () => {
  test("anchors to the bare persona label when the turn carries no sprite prompt", () => {
    const directive = buildQueuedReplyDirective(makeQueuedMessage("you kinda smell ngl"), "Zallya", "Ellen");

    expect(directive).toContain('Start your next reply with "Ellen:"');
    // Advertising a sprite form on a turn without the sprite prompt would invite
    // invented sprite keys that can never resolve.
    expect(directive).not.toContain("sprite");
  });

  test("offers the sprite opening form when the sprite prompt is present", () => {
    const directive = buildQueuedReplyDirective(
      makeQueuedMessage("you kinda smell ngl"),
      "Zallya",
      "Ellen",
      undefined,
      true,
    );

    expect(directive).toContain('Start your next reply with "Ellen:"');
    expect(directive).toContain('"Ellen ({sprite label}):"');
  });

  test("still names the reply target and quotes the queued message", () => {
    const directive = buildQueuedReplyDirective(
      makeQueuedMessage("i kinda like your smell tho"),
      "Zallya",
      "Ellen",
      undefined,
      true,
    );

    expect(directive).toContain("Create a reply as Ellen to Zallya's message");
    expect(directive).toContain("i kinda like your smell tho");
  });

  // Both builders land in the same system context for one opening line, so diverging grammar causes the model to
  // silently drop sprite tags on queued turns.
  test("sprite label grammar matches the persona-sprite prompt exactly", () => {
    const botName = "Ellen";
    const spritePrompt = buildPersonaSpritePromptText(botName, [makeSprite("shy")]);
    const directive = buildQueuedReplyDirective(makeQueuedMessage("mwah"), "Zallya", botName, undefined, true);

    const sharedLabelGrammar = `${botName} ({sprite label}):`;
    expect(spritePrompt).toContain(sharedLabelGrammar);
    expect(directive).toContain(sharedLabelGrammar);
  });
});

describe("answersQueuedTriggerMessage", () => {
  test("a queued user message is answered", () => {
    expect(answersQueuedTriggerMessage({ isFromQueue: true, textQuotaSource: "user" })).toBe(true);
  });

  test("a queued system trigger does not answer its anchor message", () => {
    expect(answersQueuedTriggerMessage({ isFromQueue: true, textQuotaSource: "system" })).toBe(false);
  });

  test("a queued stop response still answers the stop message", () => {
    expect(answersQueuedTriggerMessage({ isFromQueue: true, isStopResponse: true, textQuotaSource: "system" })).toBe(
      true,
    );
  });

  test("an unqueued turn is never a queued reply", () => {
    expect(answersQueuedTriggerMessage({ isFromQueue: false, textQuotaSource: "user" })).toBe(false);
  });
});
