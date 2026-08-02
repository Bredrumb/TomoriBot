import {
  createBotKey,
  createDiscordUserKey,
  createMatrixUserKey,
  createPersonaKey,
  createWebhookKey,
  mergeParticipantSeeds,
  type ParticipantInclusionReason,
  type ParticipantKey,
  type ParticipantSeed,
  type SyntheticParticipantDefinition,
} from "./identity";

export interface LegacySyntheticUser {
  displayName: string;
  type: "persona" | "webhook";
}

export interface LegacyPublicPersonaProfileIdentity {
  personaId: number;
  personaName: string;
}

export interface LegacyParticipantAdapterInput {
  userList: readonly string[];
  clientUserId?: string;
  activePersonaId?: number;
  activePersonaIsAlter?: boolean;
  syntheticUsers?: ReadonlyMap<string, LegacySyntheticUser>;
  matrixUsers?: ReadonlyMap<string, string>;
  referencedUserReasons?: ReadonlyMap<string, ReadonlySet<"real_mention" | "unique_text_alias">>;
  publicPersonaProfiles?: readonly LegacyPublicPersonaProfileIdentity[];
  personaProfileReasons?: ReadonlyMap<number, ReadonlySet<ParticipantInclusionReason>>;
}

function parseLegacyPersonaId(value: string): number | null {
  const candidate = value.startsWith("persona:") ? value.slice("persona:".length) : value;
  if (!/^\d+$/.test(candidate)) return null;
  const parsed = Number.parseInt(candidate, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function keyForLegacyUserListEntry(
  legacyId: string,
  input: LegacyParticipantAdapterInput,
): { key: ParticipantKey; sourceDisplayName?: string } {
  const normalizedLegacyId = legacyId.trim();
  if (!normalizedLegacyId) throw new Error("Legacy participant IDs must not be empty");

  const syntheticUser = input.syntheticUsers?.get(normalizedLegacyId);
  const isClientBot = input.clientUserId === normalizedLegacyId;
  if (isClientBot && syntheticUser) {
    throw new Error(`Legacy participant ${normalizedLegacyId} cannot be both the active bot and a synthetic user`);
  }
  if (syntheticUser && input.referencedUserReasons?.has(normalizedLegacyId)) {
    throw new Error(`Legacy participant ${normalizedLegacyId} cannot be both synthetic and a referenced Discord user`);
  }

  if (isClientBot) {
    return input.activePersonaIsAlter && input.activePersonaId !== undefined
      ? { key: createPersonaKey(input.activePersonaId) }
      : { key: createBotKey(normalizedLegacyId) };
  }
  if (syntheticUser?.type === "persona") {
    const personaId = parseLegacyPersonaId(normalizedLegacyId);
    if (personaId === null) {
      throw new Error(`Synthetic persona key ${normalizedLegacyId} does not contain a valid persona ID`);
    }
    return { key: createPersonaKey(personaId), sourceDisplayName: syntheticUser.displayName };
  }
  if (syntheticUser?.type === "webhook") {
    return { key: createWebhookKey(normalizedLegacyId), sourceDisplayName: syntheticUser.displayName };
  }

  const activePersonaId = input.activePersonaId;
  const legacyPersonaId = parseLegacyPersonaId(normalizedLegacyId);
  if (activePersonaId !== undefined && legacyPersonaId === activePersonaId) {
    return { key: createPersonaKey(activePersonaId) };
  }
  return { key: createDiscordUserKey(normalizedLegacyId) };
}

function reasonsForLegacyUserListEntry(
  legacyId: string,
  key: ParticipantKey,
  input: LegacyParticipantAdapterInput,
): ReadonlySet<ParticipantInclusionReason> {
  const referenceReasons = input.referencedUserReasons?.get(legacyId);
  if (referenceReasons && referenceReasons.size > 0) return referenceReasons;

  switch (key.kind) {
    case "bot":
      return new Set(["active_identity"]);
    case "persona":
      return new Set(key.personaId === input.activePersonaId ? ["active_identity"] : ["historical_persona"]);
    case "matrix_user":
      return new Set(["bridge_presence"]);
    case "discord_user":
    case "webhook":
      return new Set(["visible_author"]);
  }
}

export function adaptLegacySyntheticParticipants(
  syntheticUsers?: ReadonlyMap<string, LegacySyntheticUser>,
  matrixUsers?: ReadonlyMap<string, string>,
): SyntheticParticipantDefinition[] {
  const definitions: SyntheticParticipantDefinition[] = [];

  for (const [legacyId, syntheticUser] of syntheticUsers ?? []) {
    if (matrixUsers?.has(legacyId)) {
      throw new Error(`Legacy participant ${legacyId} cannot be both a synthetic webhook and a Matrix user`);
    }
    if (syntheticUser.type === "persona") {
      const personaId = parseLegacyPersonaId(legacyId);
      if (personaId === null) throw new Error(`Synthetic persona key ${legacyId} does not contain a valid persona ID`);
      definitions.push({
        key: createPersonaKey(personaId),
        displayName: syntheticUser.displayName,
        transport: "persona_webhook",
      });
    } else {
      definitions.push({
        key: createWebhookKey(legacyId),
        displayName: syntheticUser.displayName,
        transport: "webhook",
      });
    }
  }

  for (const [matrixId, displayName] of matrixUsers ?? []) {
    definitions.push({ key: createMatrixUserKey(matrixId), displayName, transport: "matrix" });
  }
  return definitions;
}

export function adaptLegacyParticipantSeeds(input: LegacyParticipantAdapterInput): ParticipantSeed[] {
  const seeds: ParticipantSeed[] = [];
  let firstSeenOrder = 0;

  for (const legacyId of input.userList) {
    const { key, sourceDisplayName } = keyForLegacyUserListEntry(legacyId, input);
    seeds.push({
      key,
      reasons: reasonsForLegacyUserListEntry(legacyId, key, input),
      firstSeenOrder,
      ...(sourceDisplayName && { sourceDisplayName }),
    });
    firstSeenOrder += 1;
  }

  for (const definition of adaptLegacySyntheticParticipants(input.syntheticUsers, input.matrixUsers)) {
    const reason: ParticipantInclusionReason =
      definition.key.kind === "matrix_user"
        ? "bridge_presence"
        : definition.key.kind === "persona"
          ? "historical_persona"
          : "visible_author";
    seeds.push({
      key: definition.key,
      reasons: new Set([reason]),
      firstSeenOrder,
      sourceDisplayName: definition.displayName,
    });
    firstSeenOrder += 1;
  }

  for (const profile of input.publicPersonaProfiles ?? []) {
    seeds.push({
      key: createPersonaKey(profile.personaId),
      reasons: input.personaProfileReasons?.get(profile.personaId) ?? new Set(["persona_trigger_reference"]),
      firstSeenOrder,
      sourceDisplayName: profile.personaName,
    });
    firstSeenOrder += 1;
  }

  return mergeParticipantSeeds(seeds);
}
