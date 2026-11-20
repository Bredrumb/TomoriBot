import { beforeEach, describe, expect, it } from "bun:test";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import {
  advanceChannelSpriteGroupParity,
  clearAllChannelDeliveryContinuity,
  getChannelLastDelivery,
  recordChannelDeliveredBotMessage,
  recordChannelDeliveredWebhookIdentity,
} from "@/utils/discord/stream/channelDeliveryContinuity";

function lastWebhookIdentity(channelId: string): ResolvedWebhookIdentity | null {
  const last = getChannelLastDelivery(channelId);
  return last?.via === "webhook" ? last.identity : null;
}

const CHANNEL = "1382235263668846612";
const OTHER_CHANNEL = "1382235263668846613";

describe("channel delivery continuity — last delivered identity", () => {
  beforeEach(() => {
    clearAllChannelDeliveryContinuity();
  });

  it("returns null for a channel that has delivered nothing", () => {
    expect(lastWebhookIdentity(CHANNEL)).toBeNull();
  });

  /**
   * The whole point of storing the identity rather than re-resolving the sprite: the username
   * actually sent may be the DECORATED group-break form. Post-turn artifacts must reuse that
   * exact string, or Discord sees a different author and splits the group.
   */
  it("returns the decorated username verbatim so later sends group with it", () => {
    const decorated: ResolvedWebhookIdentity = {
      username: "Ellen (shy)",
      avatarUrl: "https://example.invalid/shy.png",
    };

    recordChannelDeliveredWebhookIdentity(CHANNEL, decorated, "1400000000000000001", null, "1400000000000000002");

    expect(lastWebhookIdentity(CHANNEL)).toEqual(decorated);
  });

  it("stores a copy so later mutation of the caller's identity cannot corrupt it", () => {
    const identity: ResolvedWebhookIdentity = { username: "Ellen", avatarUrl: "https://example.invalid/a.png" };
    recordChannelDeliveredWebhookIdentity(CHANNEL, identity, "1400000000000000001", null, "1400000000000000002");

    identity.username = "MUTATED";

    expect(lastWebhookIdentity(CHANNEL)?.username).toBe("Ellen");
  });

  it("keeps only the most recent identity", () => {
    recordChannelDeliveredWebhookIdentity(
      CHANNEL,
      { username: "Ellen" },
      "1400000000000000001",
      null,
      "1400000000000000002",
    );
    recordChannelDeliveredWebhookIdentity(
      CHANNEL,
      { username: "Ellen (mad)" },
      "1400000000000000001",
      null,
      "1400000000000000002",
    );

    expect(lastWebhookIdentity(CHANNEL)?.username).toBe("Ellen (mad)");
  });

  /**
   * Reverting to an ordinary bot message must clear the identity. Otherwise a sticker sent
   * afterwards would be posted under a persona name that nothing adjacent is using, so grouping
   * with nothing and looking like a stray impostor message.
   */
  it("clears the identity once an ordinary bot message is delivered", () => {
    recordChannelDeliveredWebhookIdentity(
      CHANNEL,
      { username: "Ellen (shy)" },
      "1400000000000000001",
      null,
      "1400000000000000002",
    );
    recordChannelDeliveredBotMessage(CHANNEL);

    expect(lastWebhookIdentity(CHANNEL)).toBeNull();
  });

  it("tracks identities per channel", () => {
    recordChannelDeliveredWebhookIdentity(
      CHANNEL,
      { username: "Ellen (shy)" },
      "1400000000000000001",
      null,
      "1400000000000000002",
    );
    recordChannelDeliveredWebhookIdentity(
      OTHER_CHANNEL,
      { username: "Tomori" },
      "1400000000000000001",
      null,
      "1400000000000000002",
    );

    expect(lastWebhookIdentity(CHANNEL)?.username).toBe("Ellen (shy)");
    expect(lastWebhookIdentity(OTHER_CHANNEL)?.username).toBe("Tomori");
  });

  it("keeps the sprite alternation and the delivered identity independent within a channel", () => {
    const messageId = "1400000000000000001";

    // Priming the alternation must not fabricate an identity: only a real send does that.
    advanceChannelSpriteGroupParity(CHANNEL, "mad", messageId);
    expect(lastWebhookIdentity(CHANNEL)).toBeNull();

    recordChannelDeliveredWebhookIdentity(CHANNEL, { username: "Ellen" }, messageId, null, "1400000000000000002");
    // ...and recording an identity must not disturb the alternation: a sprite CHANGE still
    // flips to the decorated name.
    expect(advanceChannelSpriteGroupParity(CHANNEL, "shy", messageId)).toBe(true);
  });

  /**
   * The identity is reused by post-turn artifacts, which want the name the final message went
   * out under regardless of who spoke since, so it must not inherit the sprite alternation's
   * adjacency reset.
   */
  it("keeps returning the delivered identity after another author posts", () => {
    recordChannelDeliveredWebhookIdentity(
      CHANNEL,
      { username: "Ellen (shy)" },
      "1400000000000000001",
      null,
      "1400000000000000002",
    );

    advanceChannelSpriteGroupParity(CHANNEL, "mad", "1400000000000000009");

    expect(lastWebhookIdentity(CHANNEL)?.username).toBe("Ellen (shy)");
  });
});
