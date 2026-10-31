import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { ChannelType, Client, ClientUser, type Guild, TextChannel } from "discord.js";
import { sendChannelMessageOnce } from "@/utils/discord/webhook/singleAttemptMessage";

const BOT = "1400000000000000001";
let serial = 1400000000000000010n;
const clients: Client[] = [];

afterEach(() => {
  mock.restore();
  for (const client of clients.splice(0)) client.destroy();
});

/** Discord's 429, with a Retry-After short enough to keep the test fast. */
function rateLimited(): Response {
  return Response.json(
    { message: "You are being rate limited.", retry_after: 0.05, global: false },
    { status: 429, headers: { "Retry-After": "0.05", "X-RateLimit-Scope": "user" } },
  );
}

/** A real channel whose bot REST transport answers from `responses`, then accepts every POST. */
function fixture(responses: Array<() => Response>) {
  const client = new Client({ intents: [] });
  clients.push(client);
  client.token = "synthetic-token";
  client.user = Reflect.construct(ClientUser, [
    client,
    { id: BOT, username: "DeliveryBot", discriminator: "0", avatar: null },
  ]);
  const guild = { id: String(++serial), client, members: { me: null, resolve: () => null } } as unknown as Guild;
  const channel = Reflect.construct(TextChannel, [
    guild,
    { id: String(++serial), type: ChannelType.GuildText, name: "chat" },
    client,
  ]) as TextChannel;
  const transport = mock(async () => {
    const response =
      responses.shift()?.() ??
      Response.json({
        id: String(++serial),
        channel_id: channel.id,
        type: 0,
        content: "reply",
        author: { id: BOT, username: "DeliveryBot", discriminator: "0", avatar: null, bot: true },
        attachments: [],
      });
    return {
      body: null,
      bodyUsed: response.bodyUsed,
      headers: response.headers,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      arrayBuffer: () => response.arrayBuffer(),
      json: () => response.json(),
      text: () => response.text(),
    };
  });
  // The single-attempt bot client copies these options when first built for this client.
  spyOn(client.rest.options, "makeRequest").mockImplementation(transport);
  return { channel, transport };
}

describe("sendChannelMessageOnce", () => {
  it("waits out a rate limit and posts the message exactly once", async () => {
    const { channel, transport } = fixture([rateLimited]);

    const message = await sendChannelMessageOnce(channel, { content: "reply" }, () => undefined);

    expect(message.channelId).toBe(channel.id);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("a stop observed during the rate-limit wait cancels the retry with nothing posted", async () => {
    const { channel, transport } = fixture([rateLimited]);
    const stopped = new Error("stopped");

    const send = sendChannelMessageOnce(channel, { content: "reply" }, () => {
      if (transport.mock.calls.length > 0) throw stopped;
    });

    await expect(send).rejects.toBe(stopped);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
