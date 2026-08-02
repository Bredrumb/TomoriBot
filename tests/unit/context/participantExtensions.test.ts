import { describe, expect, it } from "bun:test";
import type { Client } from "discord.js";
import {
  ContributionExecutionError,
  ContributionRegistryError,
  createContributionRegistry,
  executeContribution,
  type ContributionDescriptor,
} from "@/utils/contributions/registry";
import { buildParticipantDiscoveryPlan } from "@/utils/text/participants/discoveryPlan";
import { canMentionParticipant, type HydratedParticipantProfile } from "@/utils/text/participants/hydration";
import { createBotKey, createDiscordUserKey, serializeParticipantKey } from "@/utils/text/participants/identity";
import {
  applyParticipantProfileEnrichers,
  createParticipantProfileEnricherRegistry,
  type ParticipantProfileEnricher,
} from "@/utils/text/participants/profileEnrichers";
import {
  composeParticipantDiscoveryPlan,
  createParticipantSourceRegistry,
  type ParticipantSource,
  type ParticipantSourceInput,
} from "@/utils/text/participants/sources";
import { renderParticipantPrompt } from "@/utils/text/participants/renderer";
import { prepareParticipantContext } from "@/utils/text/participants/preparation";

function descriptor(
  id: string,
  options: { after?: readonly string[]; before?: readonly string[]; owner?: string } = {},
): ContributionDescriptor {
  return {
    meta: {
      id,
      owner: options.owner ?? `owner:${id}`,
      source: `fixtures/${id}.ts`,
      order: 100,
      criticality: "optional",
      after: options.after,
      before: options.before,
    },
  };
}

function sourceInput(): ParticipantSourceInput {
  return {
    visibleInput: {
      userList: [],
      syntheticUsers: new Map(),
      matrixUsers: new Map(),
    },
    personas: [],
    referencePlan: buildParticipantDiscoveryPlan({ candidates: [] }),
  };
}

function source(id: string, options: Partial<ParticipantSource> = {}): ParticipantSource {
  return {
    meta: {
      id,
      owner: `owner:${id}`,
      source: `fixtures/${id}.ts`,
      order: 350,
      criticality: "optional",
      after: ["core.referenced-users"],
      before: ["core.matrix"],
      ...options.meta,
    },
    discover: options.discover ?? (async () => []),
  };
}

describe("contribution registry kernel", () => {
  it("hard-fails duplicate IDs with both owners and source paths", () => {
    expect(() =>
      createContributionRegistry("fixture", [
        descriptor("duplicate", { owner: "owner-a" }),
        descriptor("DUPLICATE", { owner: "owner-b" }),
      ]),
    ).toThrow(ContributionRegistryError);
    expect(() =>
      createContributionRegistry("fixture", [
        descriptor("duplicate", { owner: "owner-a" }),
        descriptor("duplicate", { owner: "owner-b" }),
      ]),
    ).toThrow("owner-a (fixtures/duplicate.ts) conflicts with owner-b (fixtures/duplicate.ts)");
  });

  it("resolves a stable dependency order independent of registration order", () => {
    const alpha = descriptor("alpha");
    const beta = descriptor("beta", { after: ["alpha"] });
    const gamma = descriptor("gamma", { before: ["beta"] });

    const forward = createContributionRegistry("fixture", [alpha, beta, gamma]);
    const reverse = createContributionRegistry("fixture", [gamma, beta, alpha]);

    expect(forward.inventory.map((item) => item.id)).toEqual(["alpha", "gamma", "beta"]);
    expect(reverse.inventory).toEqual(forward.inventory);
  });

  it("rejects unknown dependencies and cycles before execution", () => {
    expect(() => createContributionRegistry("fixture", [descriptor("alpha", { after: ["missing"] })])).toThrow(
      'references unknown dependency "missing"',
    );
    expect(() =>
      createContributionRegistry("fixture", [
        descriptor("alpha", { after: ["beta"] }),
        descriptor("beta", { after: ["alpha"] }),
      ]),
    ).toThrow("dependency cycle: alpha, beta");
  });

  it("aborts an optional contribution at its bounded timeout", async () => {
    let signal: AbortSignal | null = null;
    const result = await executeContribution<readonly string[]>({
      descriptor: descriptor("slow"),
      timeoutMs: 5,
      outputCount: (output) => output.length,
      run: (abortSignal) => {
        signal = abortSignal;
        return new Promise(() => undefined);
      },
    });

    expect(result.value).toBeNull();
    expect(result.diagnostic.status).toBe("timed_out");
    expect(signal?.aborted).toBe(true);
  });
});

describe("participant source extensions", () => {
  it("adds a fixture source without granting mentionability or routing access", async () => {
    let receivedKeys: string[] = [];
    const fixtureSource = source("fixture.audit", {
      discover: async (input) => {
        receivedKeys = Object.keys(input).sort();
        return [
          {
            key: createDiscordUserKey("400000000000000099"),
            reasons: new Set(["visible_author"]),
            aliases: [],
            sourceDisplayName: "Fixture User",
            evidenceSources: ["visible_author"],
          },
        ];
      },
    });
    const registry = createParticipantSourceRegistry([{ source: fixtureSource }]);

    const composition = await composeParticipantDiscoveryPlan(sourceInput(), registry);
    const fixtureSeed = composition.plan.seeds.find(
      (seed) => serializeParticipantKey(seed.key) === "discord_user:400000000000000099",
    );

    expect(receivedKeys).toEqual(["personas", "referencePlan", "visibleInput"]);
    expect(fixtureSeed).toBeDefined();
    expect(fixtureSeed ? canMentionParticipant(fixtureSeed) : true).toBe(false);
    expect(composition.diagnostics.find((item) => item.id === "fixture.audit")).toMatchObject({
      status: "success",
      outputCount: 1,
    });
  });

  it("flows source and enricher registries through the adapter-ready preparation entry point", async () => {
    const fixtureSource = source("fixture.prepared", {
      discover: async () => [
        {
          key: createDiscordUserKey("400000000000000099"),
          reasons: new Set(["visible_author"]),
          aliases: [],
          evidenceSources: ["visible_author"],
        },
      ],
    });
    const fixtureEnricher: ParticipantProfileEnricher = {
      meta: {
        id: "fixture.prepared-field",
        owner: "fixture-plugin",
        source: "fixtures/preparedField.ts",
        order: 200,
        criticality: "optional",
        after: ["core.profile-fields"],
      },
      supports: () => true,
      enrich: async () => [],
    };
    const sourceRegistry = createParticipantSourceRegistry([{ source: fixtureSource }]);
    const profileEnricherRegistry = createParticipantProfileEnricherRegistry([{ enricher: fixtureEnricher }]);

    const prepared = await prepareParticipantContext({
      client: {} as Client,
      guildId: "missing",
      simplifiedMessageHistory: [],
      personas: [],
      activePersona: null,
      visibleUserIds: [],
      memberDirectory: null,
      sourceRegistry,
      profileEnricherRegistry,
    });

    expect(prepared.discoveryPlan.seeds.map((seed) => serializeParticipantKey(seed.key))).toContain(
      "discord_user:400000000000000099",
    );
    expect(prepared.profileEnricherRegistry).toBe(profileEnricherRegistry);
  });

  it("continues after optional failure and throws a structured critical failure", async () => {
    const optional = source("fixture.optional-failure", {
      discover: async () => {
        throw new Error("optional unavailable");
      },
    });
    const optionalResult = await composeParticipantDiscoveryPlan(
      sourceInput(),
      createParticipantSourceRegistry([{ source: optional }]),
    );
    expect(optionalResult.diagnostics.find((item) => item.id === "fixture.optional-failure")?.status).toBe("failed");

    const critical = source("fixture.critical-failure", {
      meta: {
        id: "fixture.critical-failure",
        owner: "participant-core",
        source: "fixtures/critical.ts",
        order: 350,
        criticality: "critical",
        after: ["core.referenced-users"],
        before: ["core.matrix"],
      },
      discover: async () => {
        throw new Error("critical unavailable");
      },
    });
    await expect(
      composeParticipantDiscoveryPlan(sourceInput(), createParticipantSourceRegistry([{ source: critical }])),
    ).rejects.toBeInstanceOf(ContributionExecutionError);
  });

  it("rejects an extension attempt to claim the active identity", async () => {
    const spoof = source("fixture.active-spoof", {
      discover: async () => [
        {
          key: createBotKey("300000000000000001"),
          reasons: new Set(["active_identity"]),
          aliases: [],
          evidenceSources: ["active_identity"],
        },
      ],
    });

    const result = await composeParticipantDiscoveryPlan(
      sourceInput(),
      createParticipantSourceRegistry([{ source: spoof }]),
    );

    expect(result.plan.seeds).toEqual([]);
    expect(result.diagnostics.find((item) => item.id === "fixture.active-spoof")?.status).toBe("failed");
  });
});

describe("participant profile enricher extensions", () => {
  it("appends an owned field without mutating core identity, privacy, or order", async () => {
    const key = createDiscordUserKey("400000000000000001");
    const profile: HydratedParticipantProfile = {
      key,
      reasons: new Set(["visible_author"]),
      displayName: "Alice",
      aliases: [],
      primaryAlias: "Alice",
      mentionable: true,
      isBot: false,
      resolvableTargetId: key.discordId,
      fields: [
        {
          owner: key,
          kind: "personal_memories",
          order: 50,
          visibility: { visible: false, reason: "privacy" },
          lines: [],
        },
      ],
    };
    const fixtureEnricher: ParticipantProfileEnricher = {
      meta: {
        id: "fixture.badge",
        owner: "fixture-plugin",
        source: "fixtures/badge.ts",
        order: 200,
        criticality: "optional",
        after: ["core.profile-fields"],
      },
      supports: () => true,
      enrich: async (participant, context) => {
        expect(() => {
          (participant as { displayName: string }).displayName = "Mutated";
        }).toThrow();
        expect(context.coreFields[0]?.visibility).toEqual({ visible: false, reason: "privacy" });
        expect(() => {
          if (context.coreFields[0]) {
            (context.coreFields[0].visibility as { visible: boolean }).visible = true;
          }
        }).toThrow();
        return [
          {
            kind: "extension:fixture.badge",
            order: -100,
            visibility: { visible: true, reason: "visible" },
            lines: ["- Community badge: Cartographer"],
          },
        ];
      },
    };

    const result = await applyParticipantProfileEnrichers({
      profiles: [profile],
      activePersonaScope: {
        personaId: 7,
        lineageId: 70,
        isMainPersona: true,
        isUserImpersonation: false,
      },
      registry: createParticipantProfileEnricherRegistry([{ enricher: fixtureEnricher }]),
    });
    const enriched = result.profiles[0];

    expect(enriched?.key).toEqual(key);
    expect(enriched?.displayName).toBe("Alice");
    expect(enriched?.mentionable).toBe(true);
    expect(enriched?.fields).toEqual([
      profile.fields[0],
      {
        owner: key,
        kind: "extension:fixture.badge",
        order: 51,
        visibility: { visible: true, reason: "visible" },
        lines: ["- Community badge: Cartographer"],
      },
    ]);
    const rendered = renderParticipantPrompt({
      profiles: result.profiles,
      personaTaskLines: [],
      isUserImpersonation: false,
      botName: "Tomori",
      isDMChannel: false,
      channelName: "general",
      channelId: "200000000000000001",
      currentTime: "Aug 2, 2026, 02:00 PM",
      timezoneLabel: "UTC+8",
      timeOfDayPhrase: "afternoon",
    });
    expect(rendered.text).toContain("- Community badge: Cartographer");
    expect(rendered.text).not.toContain("personal_memories");
  });

  it("rejects an optional enricher that tries to emit a core privacy-owned field", async () => {
    const key = createDiscordUserKey("400000000000000001");
    const profile: HydratedParticipantProfile = {
      key,
      reasons: new Set(["visible_author"]),
      displayName: "Alice",
      aliases: [],
      primaryAlias: "Alice",
      mentionable: true,
      isBot: false,
      resolvableTargetId: key.discordId,
      fields: [],
    };
    const invalid: ParticipantProfileEnricher = {
      meta: {
        id: "fixture.privacy-bypass",
        owner: "fixture-plugin",
        source: "fixtures/privacyBypass.ts",
        order: 200,
        criticality: "optional",
        after: ["core.profile-fields"],
      },
      supports: () => true,
      enrich: async () => [
        {
          kind: "personal_memories",
          visibility: { visible: true, reason: "visible" },
          lines: ["- Invented private memory"],
        },
      ],
    };

    const result = await applyParticipantProfileEnrichers({
      profiles: [profile],
      activePersonaScope: { isMainPersona: true, isUserImpersonation: false },
      registry: createParticipantProfileEnricherRegistry([{ enricher: invalid }]),
    });

    expect(result.profiles[0]?.fields).toEqual([]);
    expect(result.diagnostics.find((item) => item.id === "fixture.privacy-bypass")?.status).toBe("failed");
  });
});
