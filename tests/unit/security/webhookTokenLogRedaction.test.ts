import { describe, expect, spyOn, test } from "bun:test";
import { DiscordAPIError, type RateLimitData, REST, RESTEvents, Routes } from "discord.js";
import rateLimitLogger from "@/events/rateLimit/rateLimitLogger";
import { log, sanitizeLogPayload } from "@/utils/misc/logger";

const WEBHOOK_ID = "123456789012345678";
const MESSAGE_ID = "223456789012345678";
const WEBHOOK_TOKEN = "synthetic-webhook-token-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const VERSIONED_WEBHOOK_PATH = `/api/v10/webhooks/${WEBHOOK_ID}/${WEBHOOK_TOKEN}`;

function restWith(respond: () => Response): REST {
  return new REST({ makeRequest: async () => respond() as never });
}

async function captureRateLimitedEvent(): Promise<RateLimitData> {
  const rest = restWith(
    () =>
      new Response(JSON.stringify({ id: "1" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Limit": "5",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset-After": "0.05",
        },
      }),
  );
  let event: RateLimitData | undefined;
  rest.on(RESTEvents.RateLimited, (data) => {
    event ??= data;
  });
  const route = Routes.webhook(WEBHOOK_ID, WEBHOOK_TOKEN);
  await rest.post(route, { auth: false, body: { content: "first" } });
  await rest.post(route, { auth: false, body: { content: "second" } });
  if (!event) throw new Error("Expected the second webhook execution to wait on its exhausted bucket");
  return event;
}

async function captureOversizedEditError(): Promise<DiscordAPIError> {
  const rest = restWith(
    () =>
      new Response(JSON.stringify({ message: "Invalid Form Body", code: 50035 }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
  );
  try {
    await rest.patch(Routes.webhookMessage(WEBHOOK_ID, WEBHOOK_TOKEN, MESSAGE_ID), {
      auth: false,
      body: { content: "x".repeat(2001) },
    });
  } catch (error) {
    if (error instanceof DiscordAPIError) return error;
    throw error;
  }
  throw new Error("Expected the webhook message edit to fail");
}

describe("managed webhook tokens in operator logs", () => {
  test("rate-limit records redact the webhook token", async () => {
    const event = await captureRateLimitedEvent();
    expect(event.url).toContain(VERSIONED_WEBHOOK_PATH);
    const rateLimit = spyOn(log, "rateLimit").mockImplementation(() => {});
    try {
      await rateLimitLogger({} as never, event);
      expect(rateLimit).toHaveBeenCalledTimes(1);
      const metadata = rateLimit.mock.calls[0]?.[1];
      expect(JSON.stringify(sanitizeLogPayload(metadata))).not.toContain(WEBHOOK_TOKEN);
    } finally {
      rateLimit.mockRestore();
    }
  });

  test("error fields copied into log records redact a failed webhook edit's token", async () => {
    const error = await captureOversizedEditError();
    expect(error.url).toContain(VERSIONED_WEBHOOK_PATH);
    expect(JSON.stringify(sanitizeLogPayload({ url: error.url }))).not.toContain(WEBHOOK_TOKEN);
  });
});
