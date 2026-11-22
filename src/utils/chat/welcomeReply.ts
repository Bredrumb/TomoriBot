import type { Message, TextChannel } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { isAutochatQualifyingMessage, isMatrixRelayMessage } from "@/utils/chat/triggerProcessor";
import { resolvePersonaForMessage } from "@/utils/chat/webhookIdentity";
import { getMessageProxyMessageRecord, type MessageProxyMessageRecord } from "@/utils/messageProxy/proxyExpectation";

interface WelcomeReply {
  userDiscId: string;
  personaId: number;
  interruptionId?: bigint;
}

interface ChannelSpeaker {
  messageId: bigint;
  userDiscId?: string;
  personaId?: number;
}

interface ChannelWelcomes {
  personas: TomoriState[];
  pending: Set<WelcomeReply>;
  active?: WelcomeReply;
  latestGreetingId?: bigint;
  lastSpeaker?: ChannelSpeaker;
  observation: Promise<void>;
}

const channelWelcomes = new WeakMap<Message["channel"], ChannelWelcomes>();
const eligibleReplies = new WeakMap<Message, number>();

function releaseIdleChannel(channel: Message["channel"], state: ChannelWelcomes): void {
  if (!state.active && state.pending.size === 0 && channelWelcomes.get(channel) === state) {
    channelWelcomes.delete(channel);
  }
}

export function trackWelcomeReply(
  channel: TextChannel,
  userDiscId: string,
  personaId: number,
  personas: TomoriState[],
) {
  let state = channelWelcomes.get(channel);
  if (!state) {
    state = { personas, pending: new Set(), observation: Promise.resolve() };
    channelWelcomes.set(channel, state);
  }
  state.personas = personas;
  const welcome: WelcomeReply = { userDiscId, personaId };
  state.pending.add(welcome);
  const welcomes = state;

  return {
    cancel: () => {
      welcomes.pending.delete(welcome);
      releaseIdleChannel(channel, welcomes);
    },
    confirm: (messageId: string) => {
      welcomes.observation = welcomes.observation.then(() => {
        if (!welcomes.pending.delete(welcome)) return;
        const deliveredId = BigInt(messageId);
        if (welcomes.latestGreetingId && deliveredId <= welcomes.latestGreetingId) {
          releaseIdleChannel(channel, welcomes);
          return;
        }
        welcomes.latestGreetingId = deliveredId;
        welcomes.active = welcome.interruptionId && welcome.interruptionId > deliveredId ? undefined : welcome;
        if (!welcomes.lastSpeaker || welcomes.lastSpeaker.messageId <= deliveredId) {
          welcomes.lastSpeaker = { messageId: deliveredId, personaId };
        }
        releaseIdleChannel(channel, welcomes);
      });
      return welcomes.observation;
    },
  };
}

function interruptsWelcome(speaker: ChannelSpeaker, welcome: WelcomeReply): boolean {
  return (
    (speaker.userDiscId !== undefined && speaker.userDiscId !== welcome.userDiscId) ||
    (speaker.personaId !== undefined && speaker.personaId !== welcome.personaId)
  );
}

export function observeWelcomeReply(
  message: Message,
  proxyResolution: Promise<MessageProxyMessageRecord | null>,
): Promise<void> | undefined {
  const channel = message.channel;
  const welcomes = channelWelcomes.get(channel);
  if (!welcomes || (!welcomes.active && welcomes.pending.size === 0)) return;

  const resolvedProxy = proxyResolution.catch(() => null);
  // Proxy lookup can finish after a later gateway event, so reserve the observation before awaiting verification.
  welcomes.observation = welcomes.observation.then(async () => {
    const messageId = BigInt(message.id);
    const previous = welcomes.lastSpeaker;
    if (previous && messageId <= previous.messageId) return;
    const proxy = await resolvedProxy;
    const userDiscId =
      proxy?.senderDiscId ??
      ((!message.author.bot && !message.webhookId) || isMatrixRelayMessage(message) ? message.author.id : undefined);
    const personaId =
      userDiscId === undefined
        ? (resolvePersonaForMessage(message, welcomes.personas, message.client.user?.id)?.persona_id ?? undefined)
        : undefined;
    const speaker = { messageId, userDiscId, personaId };
    const active = welcomes.active;
    if (active && interruptsWelcome(speaker, active)) {
      welcomes.active = undefined;
    } else if (active && userDiscId === active.userDiscId && previous?.personaId === active.personaId) {
      if (proxy?.originalMessage) eligibleReplies.set(proxy.originalMessage, active.personaId);
      if (!eligibleReplies.has(message)) eligibleReplies.set(message, active.personaId);
    }
    for (const welcome of welcomes.pending) {
      if (interruptsWelcome(speaker, welcome)) welcome.interruptionId = messageId;
    }
    welcomes.lastSpeaker = speaker;
    releaseIdleChannel(channel, welcomes);
  });
  return welcomes.observation;
}

export function inheritWelcomeReplyFromOriginal(message: Message, original: Message): void {
  const personaId = eligibleReplies.get(original);
  if (personaId !== undefined) eligibleReplies.set(message, personaId);
}

export function resolveWelcomeReplyPersona(
  message: Message,
  tomoriState: TomoriState,
  allPersonas: readonly TomoriState[],
  allowedPersonaIds: ReadonlySet<number> | null,
  isSelfMessage: boolean,
  isDtmActive: boolean,
): TomoriState | undefined {
  const original = message.webhookId ? getMessageProxyMessageRecord(message.id)?.originalMessage : null;
  const personaId = eligibleReplies.get(message) ?? (original ? eligibleReplies.get(original) : undefined);
  if (
    personaId === undefined ||
    tomoriState.config.welcome_channel_disc_id !== message.channelId ||
    isDtmActive ||
    !isAutochatQualifyingMessage(message, isSelfMessage) ||
    (allowedPersonaIds && !allowedPersonaIds.has(personaId))
  ) {
    return;
  }
  return allPersonas.find((persona) => persona.persona_id === personaId);
}
