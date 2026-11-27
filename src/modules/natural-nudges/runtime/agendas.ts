import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { log } from "@/utils/misc/logger";

export interface PersonaAgenda {
  messageId: string;
  agenda: string;
}

export async function loadLatestPersonaAgenda(
  personaId: number | null | undefined,
  messageIds: readonly string[],
): Promise<PersonaAgenda | null> {
  if (typeof personaId !== "number") return null;
  try {
    let latest: PersonaAgenda | null = null;
    for (const [messageId, agenda] of await naturalNudgeRepository.loadAgendas(personaId, messageIds)) {
      if (!latest || BigInt(messageId) > BigInt(latest.messageId)) latest = { messageId, agenda };
    }
    return latest;
  } catch (error) {
    log.warn("Natural Nudges: failed to load agendas for context", error, { personaId });
    return null;
  }
}

export function formatAgendaNotice(personaName: string, agenda: string): string {
  return `[System: From the next message on, ${personaName} has a private goal that nobody else can see: ${agenda}]`;
}

export function agendaNoticeId(messageId: string): string {
  return `synthetic-nudge-agenda-${messageId}`;
}

// Synthetic author ID distinct from all real authors so message-merging logic never merges the opener into an agenda
// notice.
export const AGENDA_NOTICE_AUTHOR_ID = "synthetic-nudge-agenda";
