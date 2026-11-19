import { verifyMessageWebhook } from "@/utils/chat/webhookIdentity";
import type { Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { findLastActivePersona } from "@/utils/discord/personaTurnDetection";

export interface FallbackPersonaResolutionOptions {
  availablePersonas: TomoriState[];
  // Unfiltered workspace personas stay separate from availablePersonas so turn detection does not skip past an
  // ineligible speaker to an older turn.
  allPersonas: TomoriState[];
  tomoriState: TomoriState;
  effectiveChannelId: string;
  personalAutoTriggerPersonaId?: number | null;
  clientUserId?: string;
  // Lazy callback skips the Discord REST history fetch when fewer than two personas are eligible, because all tiers
  // resolve identically.
  fetchRecentMessages: () => Promise<Message[]>;
}

function getChannelAutoTriggerPersona(
  personas: TomoriState[],
  effectiveChannelId: string,
  tomoriState: TomoriState,
  personalAutoTriggerPersonaId?: number | null,
): TomoriState | null {
  const resolveById = (personaId: number | null | undefined): TomoriState | null => {
    if (personaId === null || personaId === undefined) return null;
    return personas.find((persona) => persona.persona_id === personaId) ?? null;
  };

  const personalAutoTriggerPersona = resolveById(personalAutoTriggerPersonaId);
  if (personalAutoTriggerPersona) {
    return personalAutoTriggerPersona;
  }

  if (!tomoriState.config.autoch_disc_ids.includes(effectiveChannelId)) {
    return null;
  }

  const serverAutoTriggerPersonaId =
    tomoriState.config.autoch_persona_overrides.find((entry) => entry.channel_disc_id === effectiveChannelId)
      ?.persona_id ?? null;

  return serverAutoTriggerPersonaId === null
    ? (personas.find((persona) => !persona.is_alter) ?? null)
    : resolveById(serverAutoTriggerPersonaId);
}

export async function resolveFallbackPersona(options: FallbackPersonaResolutionOptions): Promise<TomoriState | null> {
  const {
    availablePersonas,
    allPersonas,
    tomoriState,
    effectiveChannelId,
    personalAutoTriggerPersonaId,
    clientUserId,
    fetchRecentMessages,
  } = options;

  if (availablePersonas.length === 0) {
    return null;
  }

  if (availablePersonas.length === 1) {
    return availablePersonas[0];
  }

  const defaultPersona = availablePersonas.find((persona) => !persona.is_alter) ?? availablePersonas[0];
  const autoTriggerPersona = getChannelAutoTriggerPersona(
    availablePersonas,
    effectiveChannelId,
    tomoriState,
    personalAutoTriggerPersonaId,
  );

  const messages = await fetchRecentMessages();
  await Promise.all(messages.map(verifyMessageWebhook));
  const availablePersonaIds = new Set(availablePersonas.map((persona) => persona.persona_id));
  const lastActivePersona = findLastActivePersona({ messages, allPersonas, clientUserId });
  const allowedLastActivePersona =
    lastActivePersona && availablePersonaIds.has(lastActivePersona.persona_id) ? lastActivePersona : null;

  return allowedLastActivePersona ?? autoTriggerPersona ?? defaultPersona;
}
