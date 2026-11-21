import type { SpriteMessageRecordInfo } from "@/types/stream/types";

const MAX_APPEARANCES = 2000;
const APPEARANCE_TTL_MS = 120 * 60 * 1000;

export interface PersonaAppearance {
  channelId: string;
  personaId: number;
  serverDiscId?: string;
  sprite?: SpriteMessageRecordInfo;
  genericAvatar: boolean;
}

const appearances = new Map<string, PersonaAppearance & { expiresAt: number }>();

export function getPersonaAppearance(channelId: string, personaId: number): PersonaAppearance | undefined {
  const key = `${channelId}:${personaId}`;
  const entry = appearances.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    appearances.delete(key);
    return undefined;
  }
  return { ...entry, sprite: entry.sprite ? { ...entry.sprite } : undefined };
}

export function commitPersonaAppearance(appearance: PersonaAppearance): void {
  const now = Date.now();
  for (const [key, entry] of appearances) {
    if (entry.expiresAt <= now) appearances.delete(key);
  }
  const key = `${appearance.channelId}:${appearance.personaId}`;
  appearances.delete(key);
  if (appearances.size >= MAX_APPEARANCES) {
    const oldest = appearances.keys().next().value;
    if (oldest !== undefined) appearances.delete(oldest);
  }
  appearances.set(key, {
    ...appearance,
    sprite: appearance.sprite ? { ...appearance.sprite } : undefined,
    expiresAt: now + APPEARANCE_TTL_MS,
  });
}

export function invalidatePersonaAppearance(personaId: number): void {
  for (const [key, entry] of appearances) {
    if (entry.personaId === personaId) appearances.delete(key);
  }
}

export function invalidateServerPersonaAppearances(serverDiscId: string): void {
  for (const [key, entry] of appearances) {
    if (entry.serverDiscId === serverDiscId) appearances.delete(key);
  }
}

export function clearPersonaAppearances(): void {
  appearances.clear();
}

export function getPersonaAppearanceCacheSize(): number {
  return appearances.size;
}
