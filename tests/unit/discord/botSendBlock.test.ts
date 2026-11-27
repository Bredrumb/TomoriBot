import { afterEach, describe, expect, it } from "bun:test";
import { type GuildBasedChannel, type GuildMember, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { resolveBotSendBlock } from "@/utils/discord/botSendBlock";
import { noteSendFailure, resetSendFailureCacheForTesting } from "@/utils/discord/stream/sendFailureCache";

const CHANNEL = "300000000000000051";
const { SendMessages, SendMessagesInThreads, ViewChannel } = PermissionFlagsBits;

afterEach(resetSendFailureCacheForTesting);

function channel(isThread: boolean, granted: bigint[]): GuildBasedChannel {
  return {
    id: CHANNEL,
    isThread: () => isThread,
    permissionsFor: () => new PermissionsBitField(granted),
  } as unknown as GuildBasedChannel;
}

function member(timedOutUntil: number | null): GuildMember {
  return {
    isCommunicationDisabled: () => timedOutUntil !== null && timedOutUntil > Date.now(),
    communicationDisabledUntilTimestamp: timedOutUntil,
  } as unknown as GuildMember;
}

describe("resolveBotSendBlock", () => {
  it("checks the send permission that matches the channel kind", () => {
    expect(resolveBotSendBlock(channel(true, [ViewChannel, SendMessages]), member(null))).toEqual({
      reason: "cannot_send_in_channel",
    });
    expect(resolveBotSendBlock(channel(true, [ViewChannel, SendMessagesInThreads]), member(null))).toBeNull();
    expect(resolveBotSendBlock(channel(false, [ViewChannel, SendMessagesInThreads]), member(null))).toEqual({
      reason: "cannot_send_in_channel",
    });
  });

  it("blocks a private channel that denies View Channel while the send bit stays set", () => {
    for (const [isThread, sendPermission] of [
      [false, SendMessages],
      [true, SendMessagesInThreads],
    ] as const) {
      expect(resolveBotSendBlock(channel(isThread, [sendPermission]), member(null))).toEqual({
        reason: "cannot_send_in_channel",
      });
    }
  });

  it("reports a timeout and its expiry while the permission bits still allow sending", () => {
    const until = Date.now() + 3_600_000;
    expect(resolveBotSendBlock(channel(false, [ViewChannel, SendMessages]), member(until))).toEqual({
      reason: "bot_timed_out_in_guild",
      until,
    });
  });

  it("holds a channel after a refused send and reports when it will retry", () => {
    noteSendFailure(CHANNEL, "missing_permissions");
    const block = resolveBotSendBlock(channel(false, [ViewChannel, SendMessages]), member(null));
    expect(block?.reason).toBe("recent_send_refused");
    expect(block !== null && "until" in block && block.until > Date.now()).toBe(true);
  });
});
