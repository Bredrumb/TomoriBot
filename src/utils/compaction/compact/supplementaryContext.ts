import type { Client, Guild } from "discord.js";
import { PrivacyLevel } from "@/types/db/schema";
import { getCachedBlacklistStatus, getCachedPrivacyLevel, getCachedUserRow } from "@/utils/cache/userCache";
import { personaRepository, personalMemoryRepository } from "@/utils/db/repositories";
import { resolvePersonaAvatarURL } from "@/utils/discord/webhook/identity";
import { resolvePersonaAvatarPublicUrl } from "@/utils/storage/avatarStorage";

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

export async function buildRoleplayAvatarMap(params: {
  userIds: string[];
  client: Client;
  guild?: Guild | null;
  serverDiscId: string;
}): Promise<Map<string, string>> {
  const avatarMap = await buildUserAvatarMap(params);
  const personaAvatarMap = await buildPersonaAvatarMap(params.serverDiscId, params.guild ?? null);
  for (const [key, value] of personaAvatarMap) {
    avatarMap.set(key, value);
  }
  return avatarMap;
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

async function buildPersonaAvatarMap(serverDiscId: string, guild?: Guild | null): Promise<Map<string, string>> {
  const personas = await personaRepository.loadAllForServer(serverDiscId);
  const avatarMap = new Map<string, string>();
  for (const persona of personas) {
    const avatarUrl = guild
      ? resolvePersonaAvatarURL(persona, guild)
      : persona.webhook_avatar_url
        ? (resolvePersonaAvatarPublicUrl(persona.webhook_avatar_url) ?? undefined)
        : undefined;
    const nameKey = persona.persona_nickname?.trim().toLowerCase();
    if (avatarUrl && nameKey) avatarMap.set(nameKey, avatarUrl);
  }
  return avatarMap;
}

async function buildUserAvatarMap(params: {
  userIds: string[];
  client: Client;
  guild?: Guild | null;
}): Promise<Map<string, string>> {
  const avatarMap = new Map<string, string>();
  for (const userId of params.userIds) {
    const member = params.guild ? await params.guild.members.fetch(userId).catch(() => null) : null;
    const user = member?.user ?? (await params.client.users.fetch(userId).catch(() => null));
    if (!user) continue;

    const avatarUrl =
      member?.displayAvatarURL({ extension: "png", size: 256, forceStatic: true }) ??
      user.displayAvatarURL({ extension: "png", size: 256, forceStatic: true });
    if (!isValidHttpUrl(avatarUrl)) continue;

    const userRow = await getCachedUserRow(userId);
    const nameCandidates = [
      member?.displayName,
      member?.nickname,
      user.globalName,
      user.username,
      userRow?.user_nickname,
    ]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => value.trim().toLowerCase());
    for (const name of nameCandidates) {
      if (!avatarMap.has(name)) avatarMap.set(name, avatarUrl);
    }
  }
  return avatarMap;
}

function isValidHttpUrl(url: string): boolean {
  if (!URL.canParse(url)) return false;
  const parsed = new URL(url);
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}
