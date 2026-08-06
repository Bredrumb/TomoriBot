import { beforeAll, describe, expect, it, mock } from "bun:test";
import type { ChatIncoming, ChatTurnContext, GenerationTurnResult } from "@/utils/chat/types";
import { runPostTurnEffects, shouldRetryEmptyResponse } from "@/utils/chat/postTurnEffects";
import { initializeLocalizer } from "@/utils/text/localizer";

const emptyResponseResult: GenerationTurnResult = {
  status: "empty_response",
  streamResults: [],
  personaResponses: [],
};

function makeContext(options: { shouldSurfaceUserErrors: boolean; isUserImpersonation?: boolean }): {
  context: ChatTurnContext;
  send: ReturnType<typeof mock>;
} {
  const send = mock(async (_payload: unknown) => undefined);
  const channel = {
    id: `channel_${options.shouldSurfaceUserErrors ? "deliberate" : "passive"}`,
    send,
    isThread: () => false,
  };
  const message = {
    id: `message_${options.shouldSurfaceUserErrors ? "deliberate" : "passive"}`,
    channel,
    createdTimestamp: Date.now(),
  };
  const incoming = {
    client: {
      channels: {
        fetch: async () => null,
      },
    },
    message,
    isFromQueue: false,
    retryCount: 2,
    skipLock: false,
    isPersonaJob: false,
    isUserImpersonation: options.isUserImpersonation ?? false,
    textQuotaSource: "user",
  } as unknown as ChatIncoming;
  const tomoriState = {
    config: {
      thought_log_channel_disc_id: null,
      private_channel_ids: [],
    },
  };

  return {
    context: {
      client: incoming.client,
      message,
      channel,
      locale: "en-US",
      turn: {
        lockedTurn: {
          admission: {
            incoming,
          },
        },
      },
      currentPersona: tomoriState,
      tomoriState,
      shouldSurfaceUserErrors: options.shouldSurfaceUserErrors,
      isUserImpersonation: options.isUserImpersonation ?? false,
      shouldApplyTextQuota: false,
      simplifiedMessages: [],
      isStopResponse: false,
      isDMChannel: false,
      reunionPresence: null,
    } as unknown as ChatTurnContext,
    send,
  };
}

describe("empty-response post-turn handling", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("allows two retries before exhausting the retry budget", () => {
    const incoming = { retryCount: 0 } as ChatIncoming;

    expect(shouldRetryEmptyResponse(incoming, emptyResponseResult)).toBe(true);
    incoming.retryCount = 1;
    expect(shouldRetryEmptyResponse(incoming, emptyResponseResult)).toBe(true);
    incoming.retryCount = 2;
    expect(shouldRetryEmptyResponse(incoming, emptyResponseResult)).toBe(false);
  });

  it("surfaces the localized terminal warning for a deliberate turn", async () => {
    const { context, send } = makeContext({ shouldSurfaceUserErrors: true });

    await runPostTurnEffects(context, emptyResponseResult);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as
      | {
          embeds?: Array<{ toJSON: () => { title?: string } }>;
        }
      | undefined;
    expect(payload?.embeds?.[0]?.toJSON().title).toBe("Empty Response");
  });

  it("keeps terminal exhaustion silent for a passive turn", async () => {
    const { context, send } = makeContext({ shouldSurfaceUserErrors: false });

    await runPostTurnEffects(context, emptyResponseResult);

    expect(send).not.toHaveBeenCalled();
  });

  it("throws terminal exhaustion back to a user-impersonation flow", async () => {
    const { context, send } = makeContext({
      shouldSurfaceUserErrors: true,
      isUserImpersonation: true,
    });

    await expect(runPostTurnEffects(context, emptyResponseResult)).rejects.toThrow(
      "User impersonation returned an empty response.",
    );
    expect(send).not.toHaveBeenCalled();
  });
});
