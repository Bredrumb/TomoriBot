import { describe, expect, it } from "bun:test";
import { Collection, type Message } from "discord.js";
import {
  annotateRecentMessageMetadataInContext,
  buildReactionContextAnnotation,
  fetchReactionUserSummaries,
} from "@/utils/chat/contextAnnotations";
import { ContextItemTag } from "@/types/misc/context";
import type { SimplifiedMessageForContext } from "@/utils/text/contextBuilder";
import { MessageIdMap } from "@/utils/text/messageIdMap";

/**
 * Reactor lookups are sequential Discord REST calls, so ordinary turns must render counts from the
 * gateway payload alone and defer names to a `reveal_message_metadata` restart.
 */

type ReactorFixture = { id: string; globalName: string | null; username: string };

function reactedMessage(
  id: string,
  reactions: Array<{ emoji: string; reactors: ReactorFixture[] }>,
  fetchCalls: string[],
): Message {
  const cache = new Collection(
    reactions.map(({ emoji, reactors }) => [
      emoji,
      {
        count: reactors.length,
        emoji: { id: null, name: emoji },
        users: {
          fetch: async () => {
            fetchCalls.push(`${id}:${emoji}`);
            return new Collection(reactors.map((user) => [user.id, user]));
          },
        },
      },
    ]),
  );
  return { id, reactions: { cache } } as unknown as Message;
}

const mirri: ReactorFixture = { id: "user-mirri", globalName: "Mirri", username: "mirri" };
const juno: ReactorFixture = { id: "user-juno", globalName: null, username: "juno" };

describe("reaction context", () => {
  it("renders counts without fetching reactors", () => {
    const fetchCalls: string[] = [];
    const message = reactedMessage("m1", [{ emoji: "👍", reactors: [mirri, juno] }], fetchCalls);

    expect(buildReactionContextAnnotation(message)).toContain("👍 x2");
    expect(fetchCalls).toHaveLength(0);
  });

  it("names reactors on the revealed metadata line, fetching the newest message first", async () => {
    const fetchCalls: string[] = [];
    const older = reactedMessage("m1", [{ emoji: "👍", reactors: [mirri] }], fetchCalls);
    const newer = reactedMessage("m2", [{ emoji: "😂", reactors: [juno] }], fetchCalls);

    const summaries = await fetchReactionUserSummaries([older, newer], {});
    expect(fetchCalls).toEqual(["m2:😂", "m1:👍"]);

    const simplifiedMessages = [
      { id: "m1", createdAt: 1_700_000_000_000 },
      { id: "m2", createdAt: 1_700_000_060_000 },
    ] as SimplifiedMessageForContext[];
    const contextSegments = simplifiedMessages.map((message) => ({
      role: "user" as const,
      metadataTag: ContextItemTag.DIALOGUE_HISTORY,
      messageId: message.id,
      parts: [{ type: "text" as const, text: "hello" }],
    }));
    annotateRecentMessageMetadataInContext({
      simplifiedMessages,
      contextSegments,
      messageIdMap: new MessageIdMap(),
      reactionUsersByMessageId: summaries,
    });

    const [olderText, newerText] = contextSegments.map((item) => item.parts[0]?.text ?? "");
    expect(olderText).toContain("Mirri");
    expect(newerText).toContain("juno");
    expect(newerText).not.toContain("Mirri");
  });
});
