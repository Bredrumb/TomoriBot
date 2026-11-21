import { beforeAll, describe, expect, it } from "bun:test";
import { EmbedBuilder, type Message } from "discord.js";
import { truncateHistoryAtRefreshMarker } from "@/utils/discord/refreshMarkerHistory";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";

beforeAll(async () => {
  await initializeLocalizer();
});

/** Only `id` and `embeds` are read, so these are not real discord.js messages. */
function makeMessage(id: string, embeds: EmbedBuilder[] = []): Message {
  return { id, embeds: embeds.map((embed) => embed.toJSON()) } as unknown as Message;
}

function makeRefreshMarker(): EmbedBuilder {
  return new EmbedBuilder().setTitle(localizer("en-US", "commands.refresh.title"));
}

describe("refresh-marker history truncation", () => {
  it("drops the marker and everything older, returning chronological order", () => {
    const history = [
      makeMessage("newest"),
      makeMessage("newer"),
      makeMessage("marker", [makeRefreshMarker()]),
      makeMessage("older"),
      makeMessage("oldest"),
    ];

    expect(truncateHistoryAtRefreshMarker(history, "label").map((message) => message.id)).toEqual(["newer", "newest"]);
  });

  it("keeps the whole page when it carries no marker", () => {
    const history = [makeMessage("newest"), makeMessage("older")];

    expect(truncateHistoryAtRefreshMarker(history, "label").map((message) => message.id)).toEqual(["older", "newest"]);
  });

  it("stops at the first marker, so an older marker cannot cut a second time", () => {
    const history = [makeMessage("newest"), makeMessage("marker_a", [makeRefreshMarker()]), makeMessage("old")];

    expect(truncateHistoryAtRefreshMarker(history, "label").map((message) => message.id)).toEqual(["newest"]);
  });

  it("ignores a message whose embeds are not a marker", () => {
    const unrelated = new EmbedBuilder().setTitle("Unrelated notice");
    const history = [makeMessage("newest", [unrelated]), makeMessage("older")];

    expect(truncateHistoryAtRefreshMarker(history, "label")).toHaveLength(2);
  });

  it("returns an empty page unchanged", () => {
    expect(truncateHistoryAtRefreshMarker([], "label")).toEqual([]);
  });
});
