import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { log } from "@/utils/misc/logger";

// Swallows read failures and returns an empty map because losing the reminder is acceptable and must never block the
// turn.
export async function loadPersonaAgendas(
  personaId: number | null | undefined,
  messageIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (typeof personaId !== "number") return new Map();
  try {
    return await naturalNudgeRepository.loadAgendas(personaId, messageIds);
  } catch (error) {
    log.warn("Natural Nudges: failed to load agendas for context", error, { personaId });
    return new Map();
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
