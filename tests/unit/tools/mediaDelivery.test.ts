import { StreamUiUpdater } from "@/utils/discord/stream/uiUpdater";
import { createDefaultStreamState } from "@/types/stream/types";
import type { StreamContext } from "@/types/stream/interfaces";
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  AttachmentBuilder,
  type AnyThreadChannel,
  ChannelType,
  Client,
  ClientUser,
  Collection,
  type Guild,
  MessagePayload,
  TextChannel,
  ThreadChannel,
  Webhook,
  WebhookType,
} from "discord.js";
import sharp from "sharp";
import { GenerateImageTool } from "@/tools/functionCalls/generateImageTool";
import { GenerateImageNaiTool } from "@/tools/functionCalls/generateImageNaiTool";
import { GenerateVideoTool } from "@/tools/functionCalls/generateVideoTool";
import { brave_image_search } from "@/tools/restAPIs/brave/toolImplementations";
import * as braveService from "@/tools/restAPIs/brave/braveSearchService";
import { searxng_image_search } from "@/tools/restAPIs/searxng/toolImplementations";
import * as searxngService from "@/tools/restAPIs/searxng/searxngService";
import { executeWebSearchWithFallback } from "@/tools/webSearch/dispatcher";
import { BraveEngine } from "@/tools/webSearch/braveEngine";
import { SearxngEngine } from "@/tools/webSearch/searxngEngine";
import type { ToolContext } from "@/types/tool/interfaces";
import { clearPersonaAppearances, getPersonaAppearance } from "@/utils/cache/personaAppearanceCacheStore";
import { clearPersonaSpriteCache, setPersonaSpriteCache } from "@/utils/cache/personaSpriteCacheStore";
import { personaSpriteMessageRepository } from "@/utils/db/repositories/PersonaSpriteMessageRepository";
import {
  clearAllChannelDeliveryContinuity,
  getChannelLastDelivery,
} from "@/utils/discord/stream/channelDeliveryContinuity";
import { DiscordDeliveryError } from "@/utils/discord/webhook/deliveryOutcome";
import * as lifecycle from "@/utils/discord/webhook/lifecycle";
import * as identity from "@/utils/discord/webhook/identity";
import { recordPersonaDelivery, type PersonaDeliveryReceipt } from "@/utils/discord/webhook/personaPost";
import { getSingleAttemptWebhookRest } from "@/utils/discord/webhook/webhookCore";
import { deliverVoiceMessage, postVoiceTranscriptCaption } from "@/utils/discord/webhook/voiceMessageDelivery";
import { buildToolPersonaPostContext } from "@/utils/discord/webhook/toolPersonaDelivery";
import * as remoteFetch from "@/utils/security/userRemoteFetch";
import * as download from "@/utils/security/safeDownload";
import { initializeLocalizer } from "@/utils/text/localizer";
import { GENERATED_IMAGE_PROMPT_FILENAME } from "@/utils/image/generatedImageMetadata";
import { createPersona } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";

const BASE = "https://example.com/base.png";
const SPRITE = "https://example.com/joy.png";
const BOT = "1400000000000000001";
let serial = 1400000000000000010n;
const clients: Client[] = [];
let bucket: { globalRemaining: number; globalReset: number };
type Outcome = "sent" | "lost" | "components" | "attachment" | "server" | "missing_id" | "refused";

beforeAll(initializeLocalizer);
beforeEach(() => {
  const rest = getSingleAttemptWebhookRest();
  bucket = { globalRemaining: rest.globalRemaining, globalReset: rest.globalReset };
});
afterEach(() => {
  mock.restore();
  Object.assign(getSingleAttemptWebhookRest(), bucket);
  clearPersonaSpriteCache();
  clearPersonaAppearances();
  clearAllChannelDeliveryContinuity();
  for (const client of clients.splice(0)) client.destroy();
});

function fixture(isAlter = false, isIdentity = false, inThread = true, rememberSprite = true) {
  const webhookRest = getSingleAttemptWebhookRest();
  webhookRest.globalRemaining = webhookRest.options.globalRequestsPerSecond;
  webhookRest.globalReset = 0;
  clearPersonaAppearances();
  clearAllChannelDeliveryContinuity();
  const persona = createPersona({
    persona_id: 7,
    persona_nickname: "Juno",
    is_alter: isAlter,
    webhook_avatar_url: BASE,
  });
  const client = new Client({ intents: [] });
  clients.push(client);
  client.token = "synthetic-token";
  client.user = Reflect.construct(ClientUser, [
    client,
    { id: BOT, username: "DeliveryBot", discriminator: "0", avatar: null },
  ]);
  const guildChannels = new Collection<string, TextChannel | AnyThreadChannel>();
  const guild = {
    id: "1400000000000000002",
    client,
    members: { me: null, resolve: () => null },
    channels: { cache: guildChannels, resolve: (id: string) => guildChannels.get(id) },
  } as unknown as Guild;
  const parent = Reflect.construct(TextChannel, [
    guild,
    { id: String(++serial), type: ChannelType.GuildText, name: "media" },
    client,
  ]) as TextChannel;
  const channel = inThread
    ? (Reflect.construct(ThreadChannel, [
        guild,
        { id: String(++serial), type: ChannelType.PublicThread, parent_id: parent.id },
        client,
      ]) as AnyThreadChannel)
    : parent;
  guild.channels.cache.set(parent.id, parent);
  guild.channels.cache.set(channel.id, channel);
  client.channels.cache.set(parent.id, parent);
  client.channels.cache.set(channel.id, channel);
  const webhook = Reflect.construct(Webhook, [
    client,
    {
      id: String(++serial),
      type: WebhookType.Incoming,
      channel_id: parent.id,
      guild_id: guild.id,
      token: "synthetic-token",
    },
  ]) as Webhook;
  spyOn(lifecycle, "getOrCreateWebhook").mockResolvedValue({ webhook });
  spyOn(identity, "resolvePersonaWebhookIdentity").mockResolvedValue({ username: "Juno", avatarUrl: BASE });
  spyOn(personaSpriteMessageRepository, "record").mockResolvedValue(true);
  setPersonaSpriteCache(7, [
    {
      sprite_id: 3,
      persona_id: 7,
      sprite_name: "joy",
      sprite_key: "joy",
      avatar_url: SPRITE,
      usage_instructions: "",
      is_identity: isIdentity,
    },
  ]);
  if (rememberSprite)
    recordPersonaDelivery({
      messageId: String(++serial),
      channelId: channel.id,
      route: "webhook",
      webhookId: webhook.id,
      identity: { username: isIdentity ? "joy (Juno)" : "Juno", avatarUrl: SPRITE },
      speaker: { personaId: 7, kind: isIdentity ? "identity_sprite" : "appearance" },
      sprite: { personaId: 7, spriteName: "joy", isIdentity },
      serverDiscId: guild.id,
    });
  channel.lastMessageId = String(++serial);
  const receipts: PersonaDeliveryReceipt[] = [];
  const context: ToolContext = {
    channel,
    client,
    tomoriState: persona,
    locale: "en-US",
    provider: "fixture",
    streamContext: {
      disableYouTubeProcessing: false,
      deliveryMode: "persona",
      deliveryReceipts: receipts,
      deliveryState: { unconfirmed: false },
    },
  };
  const outcomes: Outcome[] = [];
  const requests: Array<{ url: URL; payload: Record<string, unknown>; form?: FormData }> = [];
  const transport = mock(async (url: string, init: { body?: unknown }) => {
    const form = typeof init.body === "string" ? undefined : (init.body as FormData);
    const payload = JSON.parse(typeof init.body === "string" ? init.body : String(form?.get("payload_json"))) as Record<
      string,
      unknown
    >;
    requests.push({ url: new URL(url), payload, form });
    const outcome = outcomes.shift() ?? "sent";
    if (outcome === "lost") throw Object.assign(new Error("Accepted POST response lost"), { code: "ECONNRESET" });
    if (outcome === "server") return Response.json({ message: "uncertain" }, { status: 503 });
    if (outcome === "missing_id") return Response.json({ channel_id: channel.id });
    if (outcome === "components" || outcome === "attachment")
      return Response.json(
        {
          code: 50035,
          message: "Invalid form body",
          errors: {
            [outcome === "components" ? "components" : "attachments"]: {
              _errors: [{ code: "INVALID", message: "refused" }],
            },
          },
        },
        { status: 400 },
      );
    if (outcome === "refused") return Response.json({ code: 50013, message: "refused" }, { status: 403 });
    const attachments = (payload.attachments ?? []) as Array<{ id: string; filename: string }>;
    const isWebhook = url.includes("/webhooks/");
    return Response.json({
      id: String(++serial),
      channel_id: channel.id,
      guild_id: guild.id,
      type: 0,
      author: {
        id: isWebhook ? webhook.id : BOT,
        username: isWebhook ? payload.username : "DeliveryBot",
        discriminator: "0",
        avatar: null,
        bot: true,
      },
      webhook_id: isWebhook ? webhook.id : undefined,
      attachments: attachments.map((attachment) => ({
        ...attachment,
        size: 5,
        url: `https://cdn.discordapp.com/attachments/${channel.id}/${attachment.filename}`,
        proxy_url: `https://cdn.discordapp.com/attachments/${channel.id}/${attachment.filename}`,
        content_type: "image/png",
      })),
    });
  });
  const makeRequest: typeof client.rest.options.makeRequest = async (url, init) => {
    const response = await transport(url, init);
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
  };
  spyOn(getSingleAttemptWebhookRest().options, "makeRequest").mockImplementation(makeRequest);
  spyOn(client.rest.options, "makeRequest").mockImplementation(makeRequest);
  const voiceFetch = () =>
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (url: Parameters<typeof fetch>[0], init?: RequestInit) => transport(String(url), init ?? {}),
        { preconnect: () => undefined },
      ),
    );
  const target = {
    ownership: "persona" as const,
    channel,
    personaPost: buildToolPersonaPostContext(context, context.tomoriState),
  };
  return { context, channel, parent, webhook, receipts, outcomes, requests, transport, target, voiceFetch, persona };
}

const generatedSenders = [
  {
    name: "image",
    send: (context: ToolContext) =>
      new GenerateImageTool()["sendGeneratedImage"](
        context,
        new AttachmentBuilder(Buffer.from("image"), { name: "SPOILER_generated.png" }),
        "SPOILER_generated.png",
        1200,
        ["Mirri"],
        new AttachmentBuilder(Buffer.from("prompt"), { name: GENERATED_IMAGE_PROMPT_FILENAME }),
      ),
  },
  {
    name: "NovelAI image",
    send: (context: ToolContext) =>
      new GenerateImageNaiTool()["sendGeneratedImage"](
        context,
        new AttachmentBuilder(Buffer.from("image"), { name: "SPOILER_generated.png" }),
        "SPOILER_generated.png",
        1200,
        new AttachmentBuilder(Buffer.from("prompt"), { name: GENERATED_IMAGE_PROMPT_FILENAME }),
      ),
  },
  {
    name: "video",
    send: (context: ToolContext) =>
      new GenerateVideoTool()["sendGeneratedVideo"](context, Buffer.from("video"), "SPOILER_generated.mp4", 1200, true),
  },
];

async function searchSetup() {
  spyOn(braveService, "braveImageSearch").mockResolvedValue({
    success: true,
    data: {
      type: "images",
      query: { original: "sunset" },
      results: [{ type: "image_result", properties: { url: "https://example.com/image.png" } }],
      extra: {},
    },
  });
  spyOn(searxngService, "searxngSearch").mockResolvedValue({
    success: true,
    data: { query: "sunset", results: [{ img_src: "https://example.com/image.png" }] },
  });
  spyOn(remoteFetch, "fetchUserRemoteUrl").mockResolvedValue(
    new Response(null, { headers: { "content-type": "image/png", "content-length": String(30 * 1024 * 1024) } }),
  );
  const buffer = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#fff" } })
    .png()
    .toBuffer();
  spyOn(download, "safeDownload").mockResolvedValue({ success: true, buffer });
}

describe("persona media delivery", () => {
  it("delivers images, video, both search engines, native voice, and captions as main and alter sprites in threads", async () => {
    await searchSetup();
    for (const isAlter of [false, true])
      for (const isIdentity of [false, true]) {
        const f = fixture(isAlter, isIdentity);
        f.voiceFetch();
        for (const sender of generatedSenders) await sender.send(f.context);
        for (const search of [brave_image_search, searxng_image_search]) {
          const result = await search({ query: "sunset", count: 1 }, f.context);
          expect(result.success).toBe(true);
          expect(result.imageMetadata?.messageIds?.[0]).toBe(f.receipts.at(-1)?.messageId);
          expect(result.imageMetadata?.imageUrls[0].wasCompressed).toBe(true);
        }
        await deliverVoiceMessage({
          target: f.target,
          audioBuffer: Buffer.from("voice"),
          mimeType: "audio/ogg; codecs=opus",
          filename: "voice.ogg",
          voiceMeta: { waveform: "AA==", durationSecs: 1.25 },
        });
        await postVoiceTranscriptCaption(f.target, "first line\nsecond line @everyone");
        expect(f.requests).toHaveLength(7);
        expect(f.receipts).toHaveLength(7);
        for (const request of f.requests) {
          expect(request.url.pathname).toContain(`/webhooks/${f.webhook.id}/`);
          expect(request.url.searchParams.get("thread_id")).toBe(f.channel.id);
          expect(request.url.searchParams.get("wait")).toBe("true");
          expect(request.payload.username).toBe(isIdentity ? "joy (Juno)" : "Juno");
          expect(request.payload.avatar_url).toBe(SPRITE);
          expect(request.payload.allowed_mentions).toMatchObject({ parse: [] });
        }
        for (const receipt of f.receipts)
          expect(receipt).toMatchObject({
            channelId: f.channel.id,
            route: "webhook",
            webhookId: f.webhook.id,
            sprite: { spriteName: "joy", isIdentity },
            speaker: { personaId: 7, kind: isIdentity ? "identity_sprite" : "appearance" },
          });
        expect(f.requests[0].payload.flags).toBe(32768);
        expect((f.requests[0].payload.components as unknown[])[0]).toMatchObject({
          type: 12,
          items: [{ spoiler: true, media: { url: "attachment://SPOILER_generated.png" } }],
        });
        expect(f.requests[0].url.searchParams.get("with_components")).toBe("true");
        expect(f.requests[0].payload.attachments).toHaveLength(2);
        expect(f.requests[5].payload).toMatchObject({
          flags: 8192,
          attachments: [{ waveform: "AA==", duration_secs: 1.25 }],
        });
        expect((f.requests[5].form?.get("files[0]") as Blob).type).toBe("audio/ogg");
        expect(f.requests[6].payload.content).toBe("> first line\n> second line @everyone");
      }
  });

  for (const sender of generatedSenders) {
    it(`uncertain ${sender.name} POST makes exactly one transport attempt and commits no delivery`, async () => {
      for (const outcome of ["lost", "server"] as const) {
        const f = fixture();
        f.outcomes.push(outcome);
        await expect(sender.send(f.context)).rejects.toMatchObject({ outcome: "unconfirmed" });
        expect(f.requests).toHaveLength(1);
        expect(f.receipts).toHaveLength(0);
        expect(getPersonaAppearance(f.channel.id, 7)?.sprite?.spriteName).toBe("joy");
      }
    });

    it(`${sender.name} downgrades only a proven component refusal and reconstructs attachments`, async () => {
      const f = fixture();
      f.outcomes.push("components");
      await sender.send(f.context);
      expect(f.requests).toHaveLength(2);
      expect(f.requests[0].payload.components).toBeDefined();
      expect(f.requests[1].payload.components).toBeUndefined();
      expect(f.requests[1].payload.flags).toBeUndefined();
      expect(f.requests[1].payload.attachments).toEqual(f.requests[0].payload.attachments);
      expect(f.receipts).toHaveLength(1);
      const badAttachment = fixture();
      badAttachment.outcomes.push("attachment");
      await expect(sender.send(badAttachment.context)).rejects.toMatchObject({ outcome: "definite_refusal" });
      expect(badAttachment.requests).toHaveLength(1);
      expect(badAttachment.receipts).toHaveLength(0);
      const uncertainDowngrade = fixture();
      uncertainDowngrade.outcomes.push("components", "lost");
      await expect(sender.send(uncertainDowngrade.context)).rejects.toMatchObject({ outcome: "unconfirmed" });
      expect(uncertainDowngrade.requests).toHaveLength(2);
      expect(uncertainDowngrade.receipts).toHaveLength(0);
    });
  }

  it("uncertain search attachment POSTs stop without reporting success or trying another send", async () => {
    await searchSetup();
    for (const search of [brave_image_search, searxng_image_search]) {
      const f = fixture();
      f.outcomes.push("lost");
      const result = await search({ query: "sunset", count: 1 }, f.context);
      expect(result).toMatchObject({
        success: false,
        endTurn: true,
        error: localizedCopy("en-US", "tools.media.delivery_unconfirmed"),
      });
      expect(result.imageMetadata).toBeUndefined();
      expect(f.requests).toHaveLength(1);
      expect(f.receipts).toHaveLength(0);
    }
  });

  it("an uncertain image search prevents the dispatcher from posting through another engine", async () => {
    await searchSetup();
    const f = fixture();
    f.context.suppressProgressNotices = true;
    f.outcomes.push("lost");
    spyOn(BraveEngine.prototype, "available").mockResolvedValue(true);
    const nextEngine = spyOn(SearxngEngine.prototype, "search");
    const result = await executeWebSearchWithFallback("sunset", "image", f.context, 1);
    expect(result).toMatchObject({ success: false, endTurn: true });
    expect(nextEngine).not.toHaveBeenCalled();
    expect(f.requests).toHaveLength(1);
  });

  it("records actual bot delivery and clears webhook continuity for a main base media post", async () => {
    const f = fixture(false, false, false, false);
    await generatedSenders[0].send(f.context);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].url.pathname).toContain(`/channels/${f.channel.id}/messages`);
    expect(f.receipts[0]).toMatchObject({
      route: "bot",
      webhookId: null,
      identity: { username: "DeliveryBot" },
      speaker: { personaId: 7 },
    });
    expect(getChannelLastDelivery(f.channel.id)?.via).toBe("bot");
  });

  it("checks cancellation after serialization and before dispatch, including a component downgrade", async () => {
    const f = fixture();
    let cancelled = false;
    f.context.isExecutionCancelled = () => cancelled;
    const post = f.transport.getMockImplementation();
    f.transport.mockImplementation(async (...args) => {
      const response = await post?.(...args);
      cancelled = true;
      return response as Response;
    });
    f.outcomes.push("components");
    await expect(generatedSenders[0].send(f.context)).rejects.toMatchObject({ outcome: "pre_dispatch" });
    expect(f.requests).toHaveLength(1);
    expect(f.receipts).toHaveLength(0);
  });

  it("delivers admitted generated media, voice, and captions while ordinary prose remains held", async () => {
    const f = fixture();
    if (f.context.streamContext) f.context.streamContext.holdResponseText = true;
    f.target.personaPost = buildToolPersonaPostContext(f.context, f.persona);
    f.voiceFetch();
    for (const sender of generatedSenders) await sender.send(f.context);
    await deliverVoiceMessage({
      target: f.target,
      audioBuffer: Buffer.from("voice"),
      mimeType: "audio/ogg",
      filename: "voice.ogg",
      voiceMeta: { waveform: "AA==", durationSecs: 1 },
    });
    await postVoiceTranscriptCaption(f.target, "caption");

    expect(f.requests).toHaveLength(generatedSenders.length + 2);
    expect(f.receipts).toHaveLength(f.requests.length);
    expect(f.context.streamContext?.holdResponseText).toBe(true);
  });

  it("uncertain native voice POSTs never try bot REST or attachment fallback", async () => {
    for (const isAlter of [false, true])
      for (const outcome of ["lost", "server", "missing_id"] as const) {
        const f = fixture(isAlter);
        f.voiceFetch();
        f.outcomes.push(outcome);
        await expect(
          deliverVoiceMessage({
            target: f.target,
            audioBuffer: Buffer.from("voice"),
            mimeType: "audio/ogg",
            filename: "voice.ogg",
            voiceMeta: { waveform: "AA==", durationSecs: 1 },
          }),
        ).rejects.toMatchObject({ outcome: "unconfirmed" });
        expect(f.requests).toHaveLength(1);
        expect(f.receipts).toHaveLength(0);
      }
  });

  it("cancellation during attachment serialization prevents the first POST", async () => {
    const f = fixture();
    let cancelled = false;
    f.context.isExecutionCancelled = () => cancelled;
    const resolveFiles = MessagePayload.prototype.resolveFiles;
    spyOn(MessagePayload.prototype, "resolveFiles").mockImplementation(async function (this: MessagePayload) {
      const payload = await resolveFiles.call(this);
      cancelled = true;
      return payload;
    });
    await expect(generatedSenders[0].send(f.context)).rejects.toMatchObject({ outcome: "pre_dispatch" });
    expect(f.requests).toHaveLength(0);
    expect(f.receipts).toHaveLength(0);
  });

  it("keeps slash-command voice on its explicitly resolved base author", async () => {
    for (const isAlter of [false, true]) {
      const f = fixture(isAlter, true);
      f.voiceFetch();
      await deliverVoiceMessage({
        target: {
          channel: f.channel,
          personaId: 7,
          ...(isAlter ? { webhook: f.webhook, personaUsername: "Juno", personaAvatarUrl: BASE } : {}),
        },
        audioBuffer: Buffer.from("voice"),
        mimeType: "audio/ogg",
        filename: "voice.ogg",
        voiceMeta: { waveform: "AA==", durationSecs: 1 },
      });
      expect(f.requests).toHaveLength(1);
      expect(f.requests[0].url.pathname).toContain(
        isAlter ? `/webhooks/${f.webhook.id}/` : `/channels/${f.channel.id}/messages`,
      );
      if (isAlter) expect(f.requests[0].payload).toMatchObject({ username: "Juno", avatar_url: BASE });
      expect(getPersonaAppearance(f.channel.id, 7)?.sprite).toBeUndefined();
    }
  });

  it("uncertain bot native voice POSTs never retry or send an attachment", async () => {
    const f = fixture(false, false, true, false);
    f.outcomes.push("lost");
    await expect(
      deliverVoiceMessage({
        target: f.target,
        audioBuffer: Buffer.from("voice"),
        mimeType: "audio/ogg",
        filename: "voice.ogg",
        voiceMeta: { waveform: "AA==", durationSecs: 1 },
      }),
    ).rejects.toBeInstanceOf(DiscordDeliveryError);
    expect(f.requests).toHaveLength(1);
    expect(f.receipts).toHaveLength(0);
  });

  it("withheld voice and cancellation during author selection dispatch no POST", async () => {
    for (const held of [false, true]) {
      const f = fixture();
      f.target.personaPost.holdResponseText = held;
      let cancelled = false;
      f.target.personaPost.isExecutionCancelled = () => cancelled;
      spyOn(lifecycle, "getOrCreateWebhook").mockImplementation(async () => {
        cancelled = true;
        return { webhook: f.webhook };
      });
      await expect(
        deliverVoiceMessage({
          target: f.target,
          audioBuffer: Buffer.from("voice"),
          mimeType: "audio/ogg",
          filename: "voice.ogg",
          voiceMeta: { waveform: "AA==", durationSecs: 1 },
        }),
      ).rejects.toMatchObject({ outcome: "pre_dispatch" });
      expect(f.requests).toHaveLength(0);
      expect(f.receipts).toHaveLength(0);
    }
  });

  it("voice without waveform keeps its sprite author and never retries an uncertain attachment", async () => {
    for (const outcome of ["sent", "lost"] as const) {
      const f = fixture(false, true);
      f.outcomes.push(outcome);
      const delivery = deliverVoiceMessage({
        target: f.target,
        audioBuffer: Buffer.from("voice"),
        mimeType: "audio/ogg",
        filename: "voice.ogg",
        voiceMeta: null,
      });
      if (outcome === "sent") await expect(delivery).resolves.toBeDefined();
      else await expect(delivery).rejects.toMatchObject({ outcome: "unconfirmed" });
      expect(f.requests).toHaveLength(1);
      expect(f.requests[0].payload).toMatchObject({ username: "joy (Juno)", avatar_url: SPRITE });
      expect(f.receipts).toHaveLength(outcome === "sent" ? 1 : 0);
    }
  });

  it("an uncertain caption POST has no alternate send or successful receipt", async () => {
    const f = fixture();
    f.outcomes.push("lost");
    await postVoiceTranscriptCaption(f.target, "caption");
    expect(f.requests).toHaveLength(1);
    expect(f.receipts).toHaveLength(0);
  });

  it("records the actual bot author after definite native webhook refusal", async () => {
    const f = fixture(true);
    f.voiceFetch();
    f.outcomes.push("refused");
    await deliverVoiceMessage({
      target: f.target,
      audioBuffer: Buffer.from("voice"),
      mimeType: "audio/ogg",
      filename: "voice.ogg",
      voiceMeta: { waveform: "AA==", durationSecs: 1 },
    });
    expect(f.requests).toHaveLength(2);
    expect(f.receipts).toHaveLength(1);
    expect(f.receipts[0]).toMatchObject({
      route: "bot",
      webhookId: null,
      sprite: undefined,
      identity: { username: "DeliveryBot" },
      speaker: { personaId: null },
    });
    expect(getChannelLastDelivery(f.channel.id)?.via).toBe("bot");
    expect(getPersonaAppearance(f.channel.id, 7)?.sprite?.spriteName).toBe("joy");
  });
});

it("delivers sprite text then generated media under the same persona across another speaker", async () => {
  const f = fixture(false, true, true, false);
  const updater = new StreamUiUpdater({
    hasStopRequest: () => false,
    requestStop: () => true,
    notifyStreamProgress: () => undefined,
  });
  const stream: StreamContext = {
    channel: f.channel,
    client: f.context.client,
    tomoriState: f.persona,
    contextItems: [],
    currentTurnModelParts: [],
    locale: "en-US",
    provider: "fixture",
    deliveryMode: "persona",
    deliveryReceipts: f.receipts,
  };
  await updater.sendSinglePayload(
    {
      content: "sprite text",
      identityOverride: { username: "joy (Juno)", avatarUrl: SPRITE },
      spriteRecord: { personaId: 7, spriteName: "joy", isIdentity: true },
    },
    "sprite text",
    stream,
    createDefaultStreamState(),
  );
  f.channel.lastMessageId = String(++serial);
  await generatedSenders[0].send(f.context);
  expect(f.requests.map((request) => request.payload.username)).toEqual(["joy (Juno)", "joy (Juno)"]);
  expect(f.receipts.map((receipt) => receipt.sprite?.spriteName)).toEqual(["joy", "joy"]);
  expect(f.receipts.every((receipt) => receipt.channelId === f.channel.id && receipt.speaker?.personaId === 7)).toBe(
    true,
  );
});

it("never retries uncertain streaming text through webhook or bot REST", async () => {
  for (const isAlter of [false, true]) {
    const f = fixture(isAlter, false, true, false);
    const deliveryState = { unconfirmed: false };
    const updater = new StreamUiUpdater({
      hasStopRequest: () => false,
      requestStop: () => true,
      notifyStreamProgress: () => undefined,
    });
    const context: StreamContext = {
      channel: f.channel,
      client: f.context.client,
      tomoriState: f.persona,
      contextItems: [],
      currentTurnModelParts: [],
      locale: "en-US",
      provider: "fixture",
      deliveryMode: "persona",
      webhook: isAlter ? f.webhook : undefined,
      personaUsername: isAlter ? "Juno" : undefined,
      deliveryReceipts: f.receipts,
      deliveryState,
    };
    f.outcomes.push(isAlter ? "lost" : "server");
    await expect(
      updater.sendSinglePayload({ content: "pending text" }, "pending text", context, createDefaultStreamState()),
    ).rejects.toThrow();
    expect(f.requests).toHaveLength(1);
    expect(deliveryState.unconfirmed).toBe(true);
    expect(f.receipts).toEqual([]);
    expect(getPersonaAppearance(f.channel.id, 7)).toBeUndefined();
    expect(
      await updater.sendSinglePayload({ content: "later text" }, "later text", context, createDefaultStreamState()),
    ).toBeNull();
    expect(f.requests).toHaveLength(1);
    mock.restore();
  }
});
