import { describe, expect, it } from "bun:test";
import { createDefaultStreamState, type StreamState } from "@/types/stream/types";
import type { ResolvedWebhookIdentity } from "@/utils/discord/webhook/identity";
import type { StreamMessageDelivery } from "@/utils/discord/stream/messageDelivery";
import { StreamSegmentProcessor } from "@/utils/discord/stream/segmentProcessor";

// `resolveSpriteGroupBreakIdentity` is private; we exercise it through a typed cast
// so the toggle behavior is pinned without standing up the full resolver/delivery
// chain. The method only reads/mutates the passed-in StreamState, so the processor's
// dependencies can be inert stubs.
type SpriteGroupBreakFn = (
  identity: ResolvedWebhookIdentity,
  decoratedUsername: string,
  spriteKey: string,
  state: StreamState,
) => ResolvedWebhookIdentity;

function makeHelper(): { resolve: SpriteGroupBreakFn; state: StreamState } {
  const processor = new StreamSegmentProcessor({
    delivery: {} as StreamMessageDelivery,
    requestStop: () => false,
  });
  const resolve = (
    processor as unknown as { resolveSpriteGroupBreakIdentity: SpriteGroupBreakFn }
  ).resolveSpriteGroupBreakIdentity.bind(processor);
  return { resolve, state: createDefaultStreamState() };
}

const CLEAN = "Touko Fukawa";
const cleanIdentity: ResolvedWebhookIdentity = {
  username: CLEAN,
  avatarUrl: "https://example.com/sprites/clean.png",
};
const decoratedFor = (sprite: string) => `${CLEAN} (${sprite})`;

describe("StreamSegmentProcessor sprite group-break naming", () => {
  it("keeps the first sprite clean so the decorated suffix never appears unnecessarily", () => {
    const { resolve, state } = makeHelper();

    const result = resolve(cleanIdentity, decoratedFor("imagining"), "imagining", state);

    expect(result.username).toBe(CLEAN);
    expect(state.lastDeliveredSpriteKey).toBe("imagining");
    expect(state.spriteGroupParity).toBe(false);
  });

  it("alternates clean/decorated so adjacent different sprites never share a username", () => {
    const { resolve, state } = makeHelper();

    // 1. First sprite stays clean.
    expect(resolve(cleanIdentity, decoratedFor("imagining"), "imagining", state).username).toBe(CLEAN);
    // 2. Sprite change collides with the previous clean name → decorated fallback.
    expect(resolve(cleanIdentity, decoratedFor("mad"), "mad", state).username).toBe(decoratedFor("mad"));
    // 3. Another change flips back to clean (still distinct from the prior decorated name).
    expect(resolve(cleanIdentity, decoratedFor("imagining"), "imagining", state).username).toBe(CLEAN);
    // 4. And back to decorated.
    expect(resolve(cleanIdentity, decoratedFor("mad"), "mad", state).username).toBe(decoratedFor("mad"));
  });

  it("keeps a consecutive run of the same sprite on one identical username so Discord still groups it", () => {
    const { resolve, state } = makeHelper();

    // Same sprite twice: both clean, identical → they group under one avatar.
    expect(resolve(cleanIdentity, decoratedFor("mad"), "mad", state).username).toBe(CLEAN);
    expect(resolve(cleanIdentity, decoratedFor("mad"), "mad", state).username).toBe(CLEAN);

    // Switch sprite → decorated, then repeat it: both decorated and identical → group.
    expect(resolve(cleanIdentity, decoratedFor("imagining"), "imagining", state).username).toBe(
      decoratedFor("imagining"),
    );
    expect(resolve(cleanIdentity, decoratedFor("imagining"), "imagining", state).username).toBe(
      decoratedFor("imagining"),
    );
  });

  it("only rewrites the username, leaving the resolved avatar untouched", () => {
    const { resolve, state } = makeHelper();

    resolve(cleanIdentity, decoratedFor("imagining"), "imagining", state); // prime: clean
    const decorated = resolve(cleanIdentity, decoratedFor("mad"), "mad", state); // decorated

    expect(decorated.username).toBe(decoratedFor("mad"));
    expect(decorated.avatarUrl).toBe(cleanIdentity.avatarUrl);
    // The clean source identity must not be mutated in place.
    expect(cleanIdentity.username).toBe(CLEAN);
  });
});
