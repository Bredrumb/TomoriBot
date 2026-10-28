import {
  AttachmentBuilder,
  MessageFlags,
  Routes,
  type AnyThreadChannel,
  type BaseGuildTextChannel,
  type TextChannel,
  type Webhook,
} from "discord.js";
import type { VoiceMessageMetadata } from "@/utils/audio/voiceMessageMetadata";
import { log } from "@/utils/misc/logger";
import { classifyDiscordDeliveryFailure, DiscordDeliveryError } from "@/utils/discord/webhook/deliveryOutcome";
import { dispatchWebhookWithIdentity } from "@/utils/discord/webhook/personaDispatch";
import {
  type PersonaDeliveryReceipt,
  type PersonaPostAuthor,
  type PersonaPostContext,
  type PersonaPostPayload,
  recordPersonaDelivery,
  resolvePersonaPostAuthor,
  sendPersonaPost,
} from "@/utils/discord/webhook/personaPost";
import {
  getSingleAttemptBotRest,
  sendChannelMessageOnce,
  sendSelectedWebhookMessageOnce,
} from "@/utils/discord/webhook/singleAttemptMessage";

const DISCORD_API_BASE = "https://discord.com/api/v10";

interface VoiceDeliveryDestination {
  channel: TextChannel | BaseGuildTextChannel | AnyThreadChannel;
  webhook?: Webhook | null;
  threadId?: string;
  personaUsername?: string;
  personaAvatarUrl?: string | null;
  personaId?: number;
}

export type VoiceDeliveryTarget = VoiceDeliveryDestination &
  ({ ownership: "persona"; personaPost: PersonaPostContext } | { ownership?: "base"; personaPost?: never });

interface NativeVoiceSendOptions {
  audioBuffer: Buffer;
  mimeType: string;
  filename: string;
  voiceMeta: VoiceMessageMetadata;
}

function assertCanDispatch(target: VoiceDeliveryTarget): void {
  const context = target.personaPost;
  if (
    context?.deliveryState?.unconfirmed ||
    context?.holdResponseText ||
    context?.abortSignal?.aborted ||
    context?.isExecutionCancelled?.()
  )
    throw new DiscordDeliveryError("pre_dispatch", new Error("Voice delivery withheld or cancelled"));
}

async function resolveAuthor(target: VoiceDeliveryTarget): Promise<PersonaPostAuthor> {
  assertCanDispatch(target);
  if (target.ownership === "persona") {
    try {
      return await resolvePersonaPostAuthor(target.personaPost);
    } catch (error) {
      throw new DiscordDeliveryError("pre_dispatch", error);
    }
  }
  return {
    route: target.webhook ? "webhook" : "bot",
    webhook: target.webhook ?? undefined,
    identity: {
      username: target.personaUsername,
      avatarUrl: target.personaAvatarUrl ?? undefined,
      avatarDataUri: target.personaAvatarUrl?.startsWith("data:image/") ? target.personaAvatarUrl : undefined,
    },
    speaker: { personaId: target.personaId ?? null, kind: "appearance" },
  };
}

function botAuthor(target: VoiceDeliveryTarget, author: PersonaPostAuthor): PersonaPostAuthor {
  const bot = target.channel.client.user;
  const member = target.channel.guild?.members?.me;
  return {
    route: "bot",
    identity: {
      username: member?.displayName ?? bot?.username,
      avatarUrl: member?.displayAvatarURL?.() ?? bot?.displayAvatarURL?.(),
    },
    speaker: {
      personaId:
        author.route === "bot" || target.personaPost?.persona.is_alter === false ? author.speaker.personaId : null,
      kind: "appearance",
    },
  };
}

function commitDelivery(
  target: VoiceDeliveryTarget,
  author: PersonaPostAuthor,
  message: { id: string; channel_id?: string },
  webhookId: string | null,
): void {
  const receipt: PersonaDeliveryReceipt = {
    messageId: message.id,
    channelId: message.channel_id ?? target.channel.id,
    route: author.route,
    webhookId,
    identity: author.identity,
    speaker: author.speaker,
    sprite: author.sprite,
    serverDiscId: target.channel.guildId,
  };
  recordPersonaDelivery(receipt);
  target.personaPost?.deliveryReceipts?.push(receipt);
}

function requireMessage(value: unknown): { id: string; channel_id?: string } {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" || !value.id)
    throw new DiscordDeliveryError("unconfirmed", new Error("Discord voice response has no message ID"));
  if ("channel_id" in value && typeof value.channel_id !== "string")
    throw new DiscordDeliveryError("unconfirmed", new Error("Discord voice response has an invalid channel ID"));
  return value as { id: string; channel_id?: string };
}

function voiceForm(options: NativeVoiceSendOptions, author: PersonaPostAuthor): FormData {
  const { audioBuffer, filename, voiceMeta } = options;
  const mimeType = options.mimeType.split(";")[0].trim();
  const payload: Record<string, unknown> = {
    flags: MessageFlags.IsVoiceMessage,
    attachments: [{ id: 0, filename, waveform: voiceMeta.waveform, duration_secs: voiceMeta.durationSecs }],
    allowed_mentions: { parse: [] },
  };
  if (author.route === "webhook") {
    if (author.identity.username) payload.username = author.identity.username;
    if (!author.identity.avatarDataUri && author.identity.avatarUrl) payload.avatar_url = author.identity.avatarUrl;
  }
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  form.append("files[0]", new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), filename);
  return form;
}

async function sendNativeVoice(
  target: VoiceDeliveryTarget,
  author: PersonaPostAuthor,
  options: NativeVoiceSendOptions,
): Promise<string> {
  let dispatched = false;
  try {
    if (author.route === "webhook") {
      const webhook = author.webhook;
      if (!webhook?.token) throw new DiscordDeliveryError("pre_dispatch", new Error("Voice webhook token unavailable"));
      const delivery = await dispatchWebhookWithIdentity(webhook, author.identity, async (selected) => {
        if (!selected.webhook.token)
          throw new DiscordDeliveryError("pre_dispatch", new Error("Voice webhook token unavailable"));
        const actualAuthor = { ...author, identity: selected.identity };
        const form = voiceForm(options, actualAuthor);
        const threadId = target.channel.isThread() ? target.channel.id : target.threadId;
        const threadParam = threadId ? `&thread_id=${encodeURIComponent(threadId)}` : "";
        // Discord returns an empty 204 unless wait=true requests the created message.
        const url = `${DISCORD_API_BASE}/webhooks/${selected.webhookId}/${selected.webhook.token}?wait=true${threadParam}`;
        assertCanDispatch(target);
        dispatched = true;
        const response = await fetch(url, {
          method: "POST",
          body: form,
          redirect: "error",
          signal: target.personaPost?.abortSignal,
        });
        if (!response.ok) {
          const error = Object.assign(new Error("Discord refused native voice delivery"), { status: response.status });
          throw new DiscordDeliveryError(classifyDiscordDeliveryFailure(error), error);
        }
        return requireMessage(await response.json());
      });
      commitDelivery(target, { ...author, identity: delivery.identity }, delivery.result, delivery.webhookId);
      return delivery.result.id;
    }
    const form = voiceForm(options, author);
    const rest = target.channel.client.rest;
    assertCanDispatch(target);
    dispatched = true;
    // Bot REST needs passThroughBody because JSON serialization would corrupt the multipart boundary and drop native waveform metadata.
    const message = requireMessage(
      await rest.post.call(getSingleAttemptBotRest(target.channel.client), Routes.channelMessages(target.channel.id), {
        body: form,
        passThroughBody: true,
        signal: target.personaPost?.abortSignal,
      }),
    );
    commitDelivery(target, botAuthor(target, author), message, null);
    return message.id;
  } catch (error) {
    const status =
      error instanceof DiscordDeliveryError
        ? error.outcome
        : dispatched
          ? classifyDiscordDeliveryFailure(error)
          : "pre_dispatch";
    if (status === "unconfirmed" && target.personaPost?.deliveryState)
      target.personaPost.deliveryState.unconfirmed = true;
    log.warn("Native voice delivery was not confirmed", {
      channelId: target.channel.id,
      outcome: status,
      code: (error as { code?: unknown })?.code,
    });
    throw new DiscordDeliveryError(status, error);
  }
}

async function sendVoicePayload(target: VoiceDeliveryTarget, payload: PersonaPostPayload): Promise<string> {
  try {
    if (target.ownership === "persona") {
      const outcome = await sendPersonaPost(target.personaPost, payload);
      if (outcome.status !== "sent") throw new DiscordDeliveryError(outcome.status, outcome.error);
      return outcome.message.id;
    }
    const author = await resolveAuthor(target);
    if (author.route === "webhook" && author.webhook) {
      const delivery = await dispatchWebhookWithIdentity(author.webhook, author.identity, (selected) => {
        assertCanDispatch(target);
        return sendSelectedWebhookMessageOnce(
          selected,
          { ...payload, threadId: target.channel.isThread() ? target.channel.id : target.threadId },
          () => assertCanDispatch(target),
        );
      });
      commitDelivery(
        target,
        { ...author, identity: delivery.identity },
        { id: delivery.result.id, channel_id: delivery.result.channelId },
        delivery.webhookId,
      );
      return delivery.result.id;
    }
    assertCanDispatch(target);
    const sent = await sendChannelMessageOnce(target.channel, payload, () => assertCanDispatch(target));
    commitDelivery(target, botAuthor(target, author), { id: sent.id, channel_id: sent.channelId }, null);
    return sent.id;
  } catch (error) {
    if (error instanceof DiscordDeliveryError) throw error;
    throw new DiscordDeliveryError(classifyDiscordDeliveryFailure(error), error);
  }
}

export async function deliverVoiceMessage(input: {
  target: VoiceDeliveryTarget;
  audioBuffer: Buffer;
  mimeType: string;
  filename: string;
  voiceMeta: VoiceMessageMetadata | null;
}): Promise<string | undefined> {
  const { target, audioBuffer, mimeType, filename, voiceMeta } = input;
  if (voiceMeta) {
    const author = await resolveAuthor(target);
    const options = { audioBuffer, mimeType, filename, voiceMeta };
    try {
      return await sendNativeVoice(target, author, options);
    } catch (error) {
      if (!(error instanceof DiscordDeliveryError) || error.outcome === "unconfirmed") throw error;
      assertCanDispatch(target);
      if (author.route === "webhook") {
        try {
          return await sendNativeVoice(target, botAuthor(target, author), options);
        } catch (botError) {
          if (!(botError instanceof DiscordDeliveryError) || botError.outcome !== "definite_refusal") throw botError;
        }
      } else if (error.outcome !== "definite_refusal") throw error;
    }
  }
  return sendVoicePayload(target, {
    files: [new AttachmentBuilder(audioBuffer, { name: filename })],
    allowedMentions: { parse: [], repliedUser: false },
  });
}

export async function postVoiceTranscriptCaption(target: VoiceDeliveryTarget, captionText: string): Promise<void> {
  try {
    await sendVoicePayload(target, {
      content: `> ${captionText.replace(/\n/g, "\n> ")}`,
      allowedMentions: { parse: [], repliedUser: false },
    });
  } catch (error) {
    if (classifyDiscordDeliveryFailure(error) === "unconfirmed" && target.personaPost?.deliveryState)
      target.personaPost.deliveryState.unconfirmed = true;
    log.warn("Voice transcript caption was not confirmed", {
      channelId: target.channel.id,
      outcome: classifyDiscordDeliveryFailure(error),
    });
  }
}
