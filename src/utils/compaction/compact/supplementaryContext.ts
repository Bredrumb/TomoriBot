import { PrivacyLevel } from "@/types/db/schema";
import { getCachedBlacklistStatus, getCachedPrivacyLevel, getCachedUserRow } from "@/utils/cache/userCache";
import { personaRepository, personalMemoryRepository } from "@/utils/db/repositories";

export async function buildSupplementaryContext(params: {
  serverDiscId: string;
  userIds: string[];
  includePersonas: boolean;
}): Promise<string> {
  const sections: string[] = [];
  const tomoriState = await personaRepository.loadState(params.serverDiscId);

  if (tomoriState?.server_memories?.length) {
    sections.push(`Server memories:\n- ${tomoriState.server_memories.join("\n- ")}`);
  }

  if (tomoriState?.config.personal_memories_enabled ?? true) {
    const userMemoryLines = await buildUserMemoryLines(
      params.serverDiscId,
      params.userIds,
      tomoriState?.persona_lineage_id ?? 0,
    );
    if (userMemoryLines.length > 0) {
      sections.push(`User memories:\n- ${userMemoryLines.join("\n- ")}`);
    }
  }

  if (params.includePersonas) {
    const personas = await personaRepository.loadAllForServer(params.serverDiscId);
    if (personas.length > 0) {
      sections.push(
        `Personas:\n- ${personas
          .map((persona) => {
            const attributes = persona.attribute_list?.length ? persona.attribute_list.join(" | ") : "(no attributes)";
            return `${persona.persona_nickname}: ${attributes}`;
          })
          .join("\n- ")}`,
      );
    }
  }

  return sections.join("\n\n");
}

async function buildUserMemoryLines(serverDiscId: string, userIds: string[], lineageId: number): Promise<string[]> {
  const userMemoryLines: string[] = [];
  for (const userId of userIds) {
    const userPrivacyLevel = await getCachedPrivacyLevel(userId);
    if (userPrivacyLevel !== PrivacyLevel.MINIMAL) continue;

    const userRow = await getCachedUserRow(userId);
    if (!userRow?.user_id) continue;
    if (await getCachedBlacklistStatus(serverDiscId, userId)) continue;

    const personalMemoryRows = await personalMemoryRepository.loadForUserLineage(userRow.user_id, lineageId, true);
    if (personalMemoryRows.length === 0) continue;

    userMemoryLines.push(
      `${userRow.user_nickname || userId}: ${personalMemoryRows.map((row) => row.content).join("; ")}`,
    );
  }
  return userMemoryLines;
}
