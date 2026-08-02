import type { TomoriState } from "@/types/db/schema";
import {
  createContributionRegistry,
  executeContribution,
  type ContributionExecutionDiagnostic,
  type ContributionMeta,
  type ContributionRegistry,
} from "@/utils/contributions/registry";
import {
  buildParticipantDiscoveryPlan,
  discoverBridgeCandidates,
  discoverHistoricalSyntheticCandidates,
  discoverVisibleAuthorCandidates,
  type DiscoveredParticipantCandidate,
  type ParticipantDiscoveryPlan,
  type ParticipantVisibleInput,
} from "@/utils/text/participants/discoveryPlan";
import type { ParticipantCapability } from "@/utils/text/participants/identity";
import { participantKeysEqual, serializeParticipantKey } from "@/utils/text/participants/identity";

const DEFAULT_SOURCE_TIMEOUT_MS = 1_500;

export interface ParticipantSourceInput {
  visibleInput: ParticipantVisibleInput;
  personas: readonly TomoriState[];
  referencePlan: ParticipantDiscoveryPlan;
}

export type ParticipantSourceCandidate = Omit<DiscoveredParticipantCandidate, "capabilities">;

export interface ParticipantSource {
  meta: ContributionMeta;
  discover(
    input: Readonly<ParticipantSourceInput>,
    signal: AbortSignal,
  ): Promise<readonly ParticipantSourceCandidate[]>;
}

export interface ParticipantSourceRegistration {
  source: ParticipantSource;
  grantedCapabilities?: readonly ParticipantCapability[];
}

interface RegisteredParticipantSource {
  meta: ContributionMeta;
  source: ParticipantSource;
  grantedCapabilities: readonly ParticipantCapability[];
  coreAuthority: boolean;
}

export type ParticipantSourceRegistry = ContributionRegistry<RegisteredParticipantSource>;

export interface ParticipantDiscoveryComposition {
  plan: ParticipantDiscoveryPlan;
  diagnostics: readonly ContributionExecutionDiagnostic[];
}

function sourceTimeoutMs(): number {
  const configured = Number.parseInt(process.env.PARTICIPANT_SOURCE_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SOURCE_TIMEOUT_MS;
}

function referenceCandidates(input: ParticipantSourceInput): DiscoveredParticipantCandidate[] {
  return input.referencePlan.seeds.map((seed) => ({
    key: seed.key,
    reasons: seed.reasons,
    aliases: seed.aliases,
    capabilities: seed.capabilities,
    ...(seed.sourceDisplayName && { sourceDisplayName: seed.sourceDisplayName }),
    evidenceSources: input.referencePlan.evidence
      .filter((evidence) => serializeParticipantKey(evidence.key) === serializeParticipantKey(seed.key))
      .map((evidence) => evidence.source),
  }));
}

const CORE_SOURCE_REGISTRATIONS: readonly ParticipantSourceRegistration[] = [
  {
    source: {
      meta: {
        id: "core.visible",
        owner: "participant-core",
        source: "src/utils/text/participants/discoveryPlan.ts",
        order: 100,
        criticality: "critical",
      },
      discover: async (input) => discoverVisibleAuthorCandidates(input.visibleInput, input.personas),
    },
    grantedCapabilities: ["mentionable"],
  },
  {
    source: {
      meta: {
        id: "core.synthetic",
        owner: "participant-core",
        source: "src/utils/text/participants/discoveryPlan.ts",
        order: 200,
        criticality: "critical",
        after: ["core.visible"],
      },
      discover: async (input) =>
        discoverHistoricalSyntheticCandidates(input.visibleInput.syntheticUsers, input.personas),
    },
  },
  {
    source: {
      meta: {
        id: "core.referenced-users",
        owner: "participant-core",
        source: "src/utils/text/contextReferences.ts",
        order: 300,
        criticality: "critical",
        after: ["core.synthetic"],
      },
      discover: async (input) =>
        referenceCandidates(input).filter((candidate) => candidate.key.kind === "discord_user"),
    },
    grantedCapabilities: ["mentionable"],
  },
  {
    source: {
      meta: {
        id: "core.matrix",
        owner: "matrix-bridge",
        source: "src/utils/text/participants/discoveryPlan.ts",
        order: 400,
        criticality: "critical",
        after: ["core.referenced-users"],
      },
      discover: async (input) => discoverBridgeCandidates(input.visibleInput.matrixUsers),
    },
  },
  {
    source: {
      meta: {
        id: "core.referenced-personas",
        owner: "participant-core",
        source: "src/utils/text/contextReferences.ts",
        order: 500,
        criticality: "critical",
        after: ["core.matrix"],
      },
      discover: async (input) =>
        referenceCandidates(input).filter((candidate) => candidate.key.kind !== "discord_user"),
    },
  },
];

export function createParticipantSourceRegistry(
  additions: readonly ParticipantSourceRegistration[] = [],
): ParticipantSourceRegistry {
  return createContributionRegistry(
    "participant source",
    [
      ...CORE_SOURCE_REGISTRATIONS.map((registration) => ({ registration, coreAuthority: true })),
      ...additions.map((registration) => ({ registration, coreAuthority: false })),
    ].map(({ registration, coreAuthority }) => ({
      meta: registration.source.meta,
      source: registration.source,
      grantedCapabilities: [...(registration.grantedCapabilities ?? [])],
      coreAuthority,
    })),
  );
}

const CORE_PARTICIPANT_SOURCE_REGISTRY = createParticipantSourceRegistry();

export async function composeParticipantDiscoveryPlan(
  input: ParticipantSourceInput,
  registry: ParticipantSourceRegistry = CORE_PARTICIPANT_SOURCE_REGISTRY,
): Promise<ParticipantDiscoveryComposition> {
  for (const participantId of input.visibleInput.syntheticUsers?.keys() ?? []) {
    if (input.visibleInput.matrixUsers?.has(participantId)) {
      throw new Error(`Participant ${participantId} cannot be both a synthetic webhook and a Matrix user`);
    }
  }
  const candidates: DiscoveredParticipantCandidate[] = [];
  const contributionDiagnostics: ContributionExecutionDiagnostic[] = [];
  for (const registration of registry.ordered) {
    const executed = await executeContribution<readonly ParticipantSourceCandidate[]>({
      descriptor: registration,
      timeoutMs: sourceTimeoutMs(),
      outputCount: (output) => output.length,
      run: async (signal) => {
        const output = await registration.source.discover(input, signal);
        for (const candidate of output) {
          if (
            !registration.coreAuthority &&
            (candidate.key.kind === "bot" || candidate.reasons.has("active_identity"))
          ) {
            throw new Error("Only core participant sources may contribute the active identity");
          }
          if (candidate.aliases.some((alias) => !participantKeysEqual(alias.owner, candidate.key))) {
            throw new Error("Participant source aliases must be owned by their candidate identity");
          }
        }
        return output;
      },
    });
    contributionDiagnostics.push(executed.diagnostic);
    for (const candidate of executed.value ?? []) {
      candidates.push({
        ...candidate,
        capabilities: new Set(registration.grantedCapabilities),
      });
    }
  }

  return {
    plan: buildParticipantDiscoveryPlan({
      candidates,
      rejections: input.referencePlan.rejections,
      aliasReferenceDiagnostics: input.referencePlan.aliasReferenceDiagnostics,
    }),
    diagnostics: contributionDiagnostics,
  };
}
