import {
  REST,
  type Client,
  type Message,
  type MessageCreateOptions,
  type WebhookMessageCreateOptions,
} from "discord.js";
import type { SendableChannel } from "@/utils/discord/resolveSendableChannel";
import {
  getSingleAttemptWebhookRest,
  sendSelectedWebhookMessage,
  type WebhookIdentitySelection,
} from "@/utils/discord/webhook/webhookCore";

const botRestClients = new WeakMap<REST, REST>();

export function getSingleAttemptBotRest(client: Client): REST {
  let rest = botRestClients.get(client.rest);
  if (!rest) {
    rest = new REST({ ...client.rest.options, retries: 0, rejectOnRateLimit: () => true });
    botRestClients.set(client.rest, rest);
  }
  if (client.token) rest.setToken(client.token);
  return rest;
}

// A per-send client view preserves discord.js serialization and message reconstruction without mutating its readonly client.
async function withPostRest<T extends { client: { rest: REST } }, R>(
  target: T,
  rest: REST,
  beforePost: () => void,
  send: (view: T) => Promise<R>,
): Promise<R> {
  let active = true;
  const transport = new Proxy(target.client.rest, {
    get(original, key) {
      if (key === "post")
        return (...args: Parameters<REST["post"]>) => {
          if (active) beforePost();
          return original.post.call(active ? rest : original, ...args);
        };
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
  return withPostRest(selection.webhook, getSingleAttemptWebhookRest(), beforePost, (webhook) =>
    sendSelectedWebhookMessage({ ...selection, webhook }, payload),
  );
}

export function sendChannelMessageOnce(
  channel: SendableChannel,
  payload: MessageCreateOptions,
  beforePost: () => void,
): Promise<Message> {
  return withPostRest<SendableChannel, Message>(channel, getSingleAttemptBotRest(channel.client), beforePost, (view) =>
    view.send(payload),
  );
}
