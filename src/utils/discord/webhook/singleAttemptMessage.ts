import {
  type APIMessage,
  type Client,
  type Message,
  type MessageCreateOptions,
  MessagePayload,
  makeURLSearchParams,
  RateLimitError,
  REST,
  type RequestData,
  Routes,
  type Webhook,
  type WebhookMessageCreateOptions,
  type WebhookType,
} from "discord.js";
import type { SendableChannel } from "@/utils/discord/resolveSendableChannel";
import { DiscordDeliveryError } from "@/utils/discord/webhook/deliveryOutcome";
import {
  buildIdentityPayload,
  captureDiscordOwnership,
  dispatchWebhookWithIdentity,
  type ResolvedWebhookIdentity,
  sendSelectedWebhookMessage,
  type WebhookIdentitySelection,
} from "@/utils/discord/webhook/webhookCore";

// Single-attempt REST clients disable retries (no duplicate-guard nonce) and reject all rate limits, so callers must
// stay inside postWithRateLimitWait.
const singleAttemptClients = new WeakMap<REST, REST>();
const SINGLE_ATTEMPT_RATE_LIMIT_BUDGET_MS = 30_000;
const SINGLE_ATTEMPT_STOP_CHECK_INTERVAL_MS = 100;

class SingleAttemptRateLimitTimeoutError extends DiscordDeliveryError {
  constructor() {
    super("definite_refusal", new Error("Single-attempt POST rate-limit budget exhausted"));
    this.name = "SingleAttemptRateLimitTimeoutError";
  }
}

// Built from the client's own options so a single-attempt POST keeps its transport and timeouts.
function getSingleAttemptRest(client: Client): REST {
  let rest = singleAttemptClients.get(client.rest);
  if (!rest) {
    rest = new REST({ ...client.rest.options, retries: 0, rejectOnRateLimit: () => true });
    singleAttemptClients.set(client.rest, rest);
  }
  if (client.token) rest.setToken(client.token);
  return rest;
}

// Rate-limited POST retries cannot duplicate because refusal precedes delivery; beforePost runs before each attempt
// and during waits to abort cleanly.
async function postWithRateLimitWait(
  client: Client,
  beforePost: () => void,
  ...args: Parameters<REST["post"]>
): Promise<unknown> {
  const rest = getSingleAttemptRest(client);
  const deadline = Date.now() + SINGLE_ATTEMPT_RATE_LIMIT_BUDGET_MS;
  for (;;) {
    beforePost();
    if (Date.now() >= deadline) throw new SingleAttemptRateLimitTimeoutError();
    try {
      return await client.rest.post.call(rest, ...args);
    } catch (error) {
      if (!(error instanceof RateLimitError)) throw error;
      // A 429 reports the bucket reset in `timeToReset` and Discord's Retry-After in `retryAfter`.
      beforePost();
      const retryAt = Date.now() + Math.max(error.timeToReset, error.retryAfter);
      if (retryAt >= deadline) throw new SingleAttemptRateLimitTimeoutError();
      // A caller may hold a watchdog exemption during this wait (expression delivery does), so
      // repeated refusals need their own deadline.
      while (Date.now() < retryAt) {
        beforePost();
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(SINGLE_ATTEMPT_STOP_CHECK_INTERVAL_MS, retryAt - Date.now())),
        );
      }
    }
  }
}

// A per-send client view preserves discord.js serialization and message reconstruction without mutating its readonly
// client.
async function withPostRest<T extends { client: Client }, R>(
  target: T,
  beforePost: () => void,
  send: (view: T) => Promise<R>,
): Promise<R> {
  let active = true;
  const transport = new Proxy(target.client.rest, {
    get(original, key) {
      if (key === "post")
        return (...args: Parameters<REST["post"]>) =>
          active ? postWithRateLimitWait(target.client, beforePost, ...args) : original.post.call(original, ...args);
      const value = Reflect.get(original, key, original);
      return typeof value === "function" ? value.bind(original) : value;
    },
  });
  const client: T["client"] = Object.create(target.client, { rest: { value: transport } });
  const view: T = Object.create(target, { client: { value: client } });
  try {
    return await send(view);
  } finally {
    active = false;
  }
}

export function sendSelectedWebhookMessageOnce(
  selection: WebhookIdentitySelection,
  payload: WebhookMessageCreateOptions,
  beforePost: () => void,
) {
  const assertOwned = captureDiscordOwnership(selection.webhook.guildId);
  return withPostRest(
    selection.webhook,
    () => {
      assertOwned();
      beforePost();
    },
    (webhook) => sendSelectedWebhookMessage({ ...selection, webhook }, payload),
  );
}

export function sendChannelMessageOnce(
  channel: SendableChannel,
  payload: MessageCreateOptions,
  beforePost: () => void,
): Promise<Message> {
  const assertOwned = captureDiscordOwnership(
    "guildId" in channel ? channel.guildId : channel.id,
    !("guildId" in channel),
  );
  return withPostRest<SendableChannel, Message>(
    channel,
    () => {
      assertOwned();
      beforePost();
    },
    (view) => view.send(payload),
  );
}

export function postChannelMessageOnce(
  channel: SendableChannel,
  request: RequestData,
  beforePost: () => void,
): Promise<unknown> {
  const assertOwned = captureDiscordOwnership(
    "guildId" in channel ? channel.guildId : channel.id,
    !("guildId" in channel),
  );
  return postWithRateLimitWait(
    channel.client,
    () => {
      assertOwned();
      beforePost();
    },
    Routes.channelMessages(channel.id),
    request,
  );
}

// Transport retries stay disabled to avoid duplicates, and beforePost runs after avatar setup settles so throwing
// aborts cleanly before any POST.
export async function sendWebhookMessageOnce(
  webhook: Webhook,
  payload: WebhookMessageCreateOptions,
  identity: ResolvedWebhookIdentity | undefined,
  beforePost: () => void,
): Promise<{ id: string; channelId?: string; webhookId: string; identity: ResolvedWebhookIdentity }> {
  const assertOwned = captureDiscordOwnership(webhook.guildId);
  const delivery = await dispatchWebhookWithIdentity(webhook, identity, async (selected) => {
    const token = selected.webhook.token;
    if (!token) throw new Error(`Webhook ${selected.webhookId} has no token.`);
    const finalPayload = buildIdentityPayload(payload, selected.identity) as WebhookMessageCreateOptions;
    // Only an incoming webhook has the token checked above, which is what execution requires.
    const target = selected.webhook as Webhook<WebhookType.Incoming>;
    const { body, files } = await MessagePayload.create(target, finalPayload).resolveBody().resolveFiles();
    const created = (await postWithRateLimitWait(
      selected.webhook.client,
      () => {
        assertOwned();
        beforePost();
      },
      Routes.webhook(selected.webhookId, token),
      {
        body,
        files: files ?? undefined,
        query: makeURLSearchParams({ wait: true, thread_id: finalPayload.threadId }),
        auth: false,
      },
    )) as APIMessage;
    if (!created || typeof created.id !== "string" || !created.id)
      throw new DiscordDeliveryError("unconfirmed", new Error("Discord expression response has no message ID"));
    return { id: created.id, channelId: created.channel_id };
  });
  return { ...delivery.result, webhookId: delivery.webhookId, identity: delivery.identity };
}
