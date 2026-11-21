import { afterEach, describe, expect, it } from "bun:test";
import type { Message } from "discord.js";
import {
  acquireChannelLockForTurn,
  channelLocks,
  getOrCreateChannelLockEntry,
  queueFollowUpForLockedTurn,
  setActiveChannelTurnState,
} from "@/utils/chat/channelQueue";
import { StreamOrchestrator } from "@/utils/discord/streamOrchestrator";
import { stubAllShardOwnership } from "../../helpers/shardOwnership";

stubAllShardOwnership();

const CHANNEL_ID = "follow-up-identity";
const USER_ID = "follow-up-author";

afterEach(() => {
  channelLocks.delete(CHANNEL_ID);
  StreamOrchestrator.clearStopRequest(CHANNEL_ID);
});

describe("follow-up identity", () => {
  for (const isInToolCallChain of [false, true]) {
    for (const isUserImpersonation of [false, true]) {
      it.each([
        undefined,
        "incoming-member",
      ])(`preserves follow-up identity with tools=${isInToolCallChain}, active impersonation=${isUserImpersonation}, incoming target=%s`, (incomingImpersonatedUserId) => {
        const lockEntry = getOrCreateChannelLockEntry(CHANNEL_ID, "follow-up-guild");
        acquireChannelLockForTurn(lockEntry, {
          messageId: "reply-to-impersonation",
          userDiscId: USER_ID,
          isPersonaJob: false,
          isCommandTriggered: false,
        });
        const impersonatedUserId = isUserImpersonation ? "impersonated-member" : undefined;
        setActiveChannelTurnState(lockEntry, {
          activePersonaId: 1,
          triggeredPersonaIds: [1],
          followUpEligible: true,
          isUserImpersonation,
          impersonatedUserId,
        });
        lockEntry.isInToolCallChain = isInToolCallChain;
        const message = {
          id: "plain-follow-up",
          guildId: "follow-up-guild",
          channelId: CHANNEL_ID,
          author: { id: USER_ID, bot: false },
          webhookId: null,
        } as unknown as Message;

        expect(
          queueFollowUpForLockedTurn({
            lockEntry,
            channelId: CHANNEL_ID,
            userDiscId: USER_ID,
            message,
            isUserImpersonation: incomingImpersonatedUserId !== undefined,
            impersonatedUserId: incomingImpersonatedUserId,
            textQuotaSource: "user",
            textQuotaTriggerKey: message.id,
            textQuotaUserDiscId: USER_ID,
            manualStreamingContextOverrides: undefined,
            isNaturalStopMessage: false,
          }),
        ).toBe(true);
        expect(lockEntry.messageQueue[0]).toMatchObject({
          message,
          isManuallyTriggered: true,
          selectedPersonaId: 1,
          triggeredPersonaIds: [1],
          isUserImpersonation: incomingImpersonatedUserId !== undefined || isUserImpersonation || undefined,
          impersonatedUserId: incomingImpersonatedUserId ?? impersonatedUserId,
        });
        expect(StreamOrchestrator.isFollowUpRequest(CHANNEL_ID)).toBe(!isInToolCallChain);
      });
    }
  }
});
