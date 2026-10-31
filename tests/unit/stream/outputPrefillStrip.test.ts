import { describe, expect, it } from "bun:test";
import { HumanizerDegree } from "@/types/db/schema";
import type { StreamContext } from "@/types/stream/interfaces";
import {
  createDefaultStreamState,
  type StreamState,
  type TextProcessingConfig,
  type TypingSimulationConfig,
  VisibleDeliveryMode,
} from "@/types/stream/types";
import type { StreamMessageDelivery } from "@/utils/discord/stream/messageDelivery";
import { StreamSegmentProcessor } from "@/utils/discord/stream/segmentProcessor";

const textConfig: TextProcessingConfig = {
  humanizerDegree: HumanizerDegree.NONE,
  visibleDeliveryMode: VisibleDeliveryMode.STREAMING,
  emojiUsageEnabled: true,
  emojiStrings: [],
  botName: "Mirri",
  botNameAliases: [],
  registeredSpeakerNamesLower: new Set(),
  maxMessageLength: 2000,
};

const typingConfig: TypingSimulationConfig = {
  enabled: false,
  baseSpeedMsPerChar: 0,
  maxTypingTimeMs: 0,
  minVisibleDurationMs: 0,
  randomPauseEnabled: false,
  thinkingPauseChance: 0,
};

/** Runs segments through the real processor with a prefill prepared the way the stream does. */
async function deliver(segments: string[], outputPrefill = "Mirri: Sure, here"): Promise<string[]> {
  const context = {
    channel: { id: "1382235263668846612" },
    contextItems: [],
    outputPrefill,
    tomoriState: { persona_id: 1, persona_nickname: "Mirri", is_alter: false, config: {} },
  } as unknown as StreamContext;
  const sent: string[] = [];
  const delivery = {
    sendSegment: async (text: string, ...rest: unknown[]) => {
      sent.push(text);
      // Non-empty accumulated text keeps the opening-label leak guard off the database.
      (rest[4] as StreamState).accumulatedText += text;
    },
  } as unknown as StreamMessageDelivery;
  const processor = new StreamSegmentProcessor({ delivery, requestStop: () => false });
  const state = createDefaultStreamState();
  state.accumulatedText = " ";
  await processor.prepareOutputPrefill(context, { ...textConfig }, state);
  for (const segment of segments) {
    await processor.sendBufferSegment(segment, "newline", { ...textConfig }, typingConfig, context, state);
  }
  return sent;
}

describe("output prefill display", () => {
  it("strips a prefill the model echoes back", async () => {
    const sent = await deliver(["Mirri: Sure, here are three fruits.\n"]);
    expect(sent.join("")).not.toContain("Sure, here");
    expect(sent.join("")).toContain("are three fruits.");
  });

  it("strips an echo that opens with whitespace", async () => {
    const sent = await deliver(["\nMirri: Sure, here are three fruits.\n"]);
    expect(sent.join("")).not.toContain("Sure, here");
    expect(sent.join("")).toContain("are three fruits.");
  });

  it("releases text withheld by a partial match once the output diverges", async () => {
    const sent = await deliver(["Sure,", " there we go.\n"]);
    expect(sent.join("")).toContain("Sure,");
    expect(sent.join("")).toContain("there we go.");
  });

  it("strips a multi-line echo whose line breaks the buffer consumed at each flush", async () => {
    const sent = await deliver(["Line one.\n", "Line two.\n", "And then more."], "Mirri: Line one.\nLine two.");
    expect(sent.join("")).not.toContain("Line");
    expect(sent.join("")).toContain("And then more.");
  });

  // Regression: an echo matched across several lines, diverged later, and was reposted with its
  // withheld lines run together.
  it("keeps line breaks between withheld lines when a multi-line echo diverges", async () => {
    const sent = await deliver(
      ["I leave for five minutes.", "Anyway, it's Saturday.", "A few thoughts on the tracks."],
      "Mirri: I leave for five minutes.\nAnyway, it's Saturday.\nA few other thoughts.",
    );
    expect(sent.join("")).toContain("I leave for five minutes.\nAnyway, it's Saturday.\nA few thoughts on the tracks.");
  });

  it("never shows a prefill the model continued without echoing", async () => {
    const sent = await deliver(["apples, pears, and plums.\n"]);
    expect(sent.join("")).not.toContain("Sure, here");
    expect(sent.join("")).toContain("apples, pears, and plums.");
  });
});
