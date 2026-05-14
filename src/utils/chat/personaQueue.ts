import type { Message } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { ForcedMention } from "@/types/discord/mentions";
import type { StructuredContextItem } from "@/types/misc/context";
import { log } from "@/utils/misc/logger";
import { queuePersonaJobsAtFront, type ChannelLockEntry } from "@/utils/chat/channelQueue";
import type { TextQuotaSource } from "@/utils/chat/types";

export function queueAdditionalPersonaTurns(args: {
  lockEntry: ChannelLockEntry;
  message: Message;
  personasToRespond: TomoriState[];
  forceReason?: boolean;
  reasoningQuery?: string;
  llmOverrideCodename?: string;
  textQuotaSource: TextQuotaSource;
  textQuotaTriggerKey: string;
  textQuotaUserDiscId: string;
  injectedContextItems?: StructuredContextItem[];
  forcedMentions?: ForcedMention[];
}): TomoriState[] {
  const [firstPersona, ...remainingPersonas] = args.personasToRespond;
  if (!firstPersona) {
    return [];
  }

  const personasToQueue: Array<{ persona: TomoriState; selectedPersonaId: number }> = [];
  const personasToHandleNow: TomoriState[] = [firstPersona];

  for (const persona of remainingPersonas) {
    if (persona.tomori_id) {
      personasToQueue.push({
        persona,
        selectedPersonaId: persona.tomori_id,
      });
    } else {
      log.warn(
        `Persona "${persona.tomori_nickname}" is missing tomori_id; handling in current pass instead of queueing.`,
      );
      personasToHandleNow.push(persona);
    }
  }

  if (personasToQueue.length > 0) {
    queuePersonaJobsAtFront({
      lockEntry: args.lockEntry,
      message: args.message,
      personaJobs: personasToQueue.map((queuedPersona) => ({
        personaName: queuedPersona.persona.tomori_nickname,
        selectedPersonaId: queuedPersona.selectedPersonaId,
      })),
      forceReason: args.forceReason,
      reasoningQuery: args.reasoningQuery,
      llmOverrideCodename: args.llmOverrideCodename,
      textQuotaSource: args.textQuotaSource,
      textQuotaTriggerKey: args.textQuotaTriggerKey,
      textQuotaUserDiscId: args.textQuotaUserDiscId,
      injectedContextItems: args.injectedContextItems,
      forcedMentions: args.forcedMentions,
    });
  }

  return personasToHandleNow;
}
