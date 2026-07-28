import { beforeEach, describe, expect, it } from "bun:test";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import type { StreamMessageDelivery } from "@/utils/discord/stream/messageDelivery";
import { StreamSegmentProcessor } from "@/utils/discord/stream/segmentProcessor";
import { clearAllChannelDeliveryContinuity } from "@/utils/discord/stream/channelDeliveryContinuity";

// `resolveSpriteGroupBreakIdentity` is private; we exercise it through a typed cast
// so the toggle behavior is pinned without standing up the full resolver/delivery
// chain. The method keys its alternation off the channel id alone, so the processor's
// dependencies can be inert stubs.
type SpriteGroupBreakFn = (
  identity: ResolvedWebhookIdentity,
  decoratedUsername: string,
  spriteKey: string,
  channelId: string,
) => ResolvedWebhookIdentity;

function makeResolver(): SpriteGroupBreakFn {
  const processor = new StreamSegmentProcessor({
    delivery: {} as StreamMessageDelivery,
    requestStop: () => false,
  });
  return (
    processor as unknown as { resolveSpriteGroupBreakIdentity: SpriteGroupBreakFn }
  ).resolveSpriteGroupBreakIdentity.bind(processor);
}

const CLEAN = "Touko Fukawa";
const CHANNEL = "1382235263668846612";
const cleanIdentity: ResolvedWebhookIdentity = {
  username: CLEAN,
  avatarUrl: "https://example.com/sprites/clean.png",
};
const decoratedFor = (sprite: string) => `${CLEAN} (${sprite})`;

describe("StreamSegmentProcessor sprite group-break naming", () => {
  // Continuity is module-level and channel-scoped, so it deliberately outlives any one
  // stream — which means tests must clear it explicitly rather than rely on fresh state.
  beforeEach(() => {
    clearAllChannelDeliveryContinuity();
  });

  it("keeps the first sprite clean so the decorated suffix never appears unnecessarily", () => {
    const resolve = makeResolver();

    const result = resolve(cleanIdentity, decoratedFor("imagining"), "imagining", CHANNEL);

    expect(result.username).toBe(CLEAN);
  });

  it("alternates clean/decorated so adjacent different sprites never share a username", () => {
    const resolve = makeResolver();

    // 1. First sprite stays clean.
    expect(resolve(cleanIdentity, decoratedFor("imagining"), "imagining", CHANNEL).username).toBe(CLEAN);
    // 2. Sprite change collides with the previous clean name → decorated fallback.
    expect(resolve(cleanIdentity, decoratedFor("mad"), "mad", CHANNEL).username).toBe(decoratedFor("mad"));
    // 3. Another change flips back to clean (still distinct from the prior decorated name).
    expect(resolve(cleanIdentity, decoratedFor("imagining"), "imagining", CHANNEL).username).toBe(CLEAN);
    // 4. And back to decorated.
    expect(resolve(cleanIdentity, decoratedFor("mad"), "mad", CHANNEL).username).toBe(decoratedFor("mad"));
  });

  it("keeps a consecutive run of the same sprite on one identical username so Discord still groups it", () => {
    const resolve = makeResolver();

    // Same sprite twice: both clean, identical → they group under one avatar.
    expect(resolve(cleanIdentity, decoratedFor("mad"), "mad", CHANNEL).username).toBe(CLEAN);
    expect(resolve(cleanIdentity, decoratedFor("mad"), "mad", CHANNEL).username).toBe(CLEAN);

    // Switch sprite → decorated, then repeat it: both decorated and identical → group.
    expect(resolve(cleanIdentity, decoratedFor("imagining"), "imagining", CHANNEL).username).toBe(
      decoratedFor("imagining"),
    );
    expect(resolve(cleanIdentity, decoratedFor("imagining"), "imagining", CHANNEL).username).toBe(
      decoratedFor("imagining"),
    );
  });

  it("only rewrites the username, leaving the resolved avatar untouched", () => {
    const resolve = makeResolver();

    resolve(cleanIdentity, decoratedFor("imagining"), "imagining", CHANNEL); // prime: clean
    const decorated = resolve(cleanIdentity, decoratedFor("mad"), "mad", CHANNEL); // decorated

    expect(decorated.username).toBe(decoratedFor("mad"));
    expect(decorated.avatarUrl).toBe(cleanIdentity.avatarUrl);
    // The clean source identity must not be mutated in place.
    expect(cleanIdentity.username).toBe(CLEAN);
  });

  /**
   * Regression: the alternation used to live in StreamState, which is rebuilt for every SDK
   * call. A queued turn therefore saw its first sprite as "the channel's first" and kept the
   * clean name — colliding with the previous turn's final sprite, which Discord then grouped
   * under one avatar. A separate resolver instance stands in for the new turn's stream.
   */
  it("carries the alternation across turn boundaries in the same channel", () => {
    const firstTurn = makeResolver();
    expect(firstTurn(cleanIdentity, decoratedFor("mad"), "mad", CHANNEL).username).toBe(CLEAN);

    // New turn, new processor/stream — but the same channel, so a sprite CHANGE must still
    // break the group rather than restart on the clean name.
    const queuedTurn = makeResolver();
    expect(queuedTurn(cleanIdentity, decoratedFor("shy"), "shy", CHANNEL).username).toBe(decoratedFor("shy"));
  });

  it("tracks channels independently so one channel's sprite run cannot skew another's", () => {
    const resolve = makeResolver();
    const otherChannel = "1382235263668846613";

    expect(resolve(cleanIdentity, decoratedFor("mad"), "mad", CHANNEL).username).toBe(CLEAN);
    // A different channel starts its own run: first sprite there is still clean.
    expect(resolve(cleanIdentity, decoratedFor("shy"), "shy", otherChannel).username).toBe(CLEAN);
    // The original channel's alternation is unaffected by the interleaved channel.
    expect(resolve(cleanIdentity, decoratedFor("shy"), "shy", CHANNEL).username).toBe(decoratedFor("shy"));
  });
});
