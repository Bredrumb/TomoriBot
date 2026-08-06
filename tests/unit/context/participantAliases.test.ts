import { describe, expect, it } from "bun:test";
import {
  aliasesForPurpose,
  buildAliasCollisionIndex,
  buildBridgeUserAliases,
  buildDiscordUserAliases,
  buildPersonaAliases,
  buildWebhookAliases,
  normalizeParticipantAlias,
} from "@/utils/text/participants/aliases";
import {
  createDiscordUserKey,
  createMatrixUserKey,
  createPersonaKey,
  createWebhookKey,
  serializeParticipantKey,
  type ParticipantAlias,
} from "@/utils/text/participants/identity";
import { resolveUniqueParticipantAliasReferences } from "@/utils/text/participants/referenceDiscovery";

function buildUserAliases(userId: string, savedNickname: string, username: string, exposeSavedNickname = true) {
  return buildDiscordUserAliases({
    owner: createDiscordUserKey(userId),
    userRow: { user_nickname: savedNickname },
    identity: {
      displayName: `${savedNickname} Display`,
      nickname: `${savedNickname} Guild`,
      globalName: `${savedNickname} Global`,
      username,
    },
    exposeSavedNickname,
  });
}

describe("participant alias catalog", () => {
  it("normalizes casing, whitespace, Unicode text, punctuation, and leading at wrappers once", () => {
    expect(normalizeParticipantAlias("  @@  JOSÉ\t\nMaría  ")).toBe("josé maría");
    expect(normalizeParticipantAlias("@山田　太郎")).toBe("山田 太郎");
    expect(normalizeParticipantAlias("@Ren!")).toBe("ren!");
    expect(normalizeParticipantAlias("@{Ren}")).toBe("{ren}");
  });

  it("keeps lookup-only identity separate from displayed and pingable aliases", () => {
    const aliases = buildUserAliases("100", "Private Saved", "alice", false);
    const inputValues = aliasesForPurpose(aliases, "input_reference").map((alias) => alias.value);
    const outputValues = aliasesForPurpose(aliases, "output_mention").map((alias) => alias.value);
    const toolValues = aliasesForPurpose(aliases, "tool_target").map((alias) => alias.value);
    const copiedValues = aliasesForPurpose(aliases, "copied_identity").map((alias) => alias.value);
    const savedAlias = aliases.find((alias) => alias.source === "saved_nickname");
    const displayAlias = aliases.find((alias) => alias.source === "guild_display_name");

    expect(inputValues).toContain("Private Saved");
    expect(inputValues).toContain("Private Saved Display");
    expect(outputValues).not.toContain("Private Saved");
    expect(outputValues).not.toContain("Private Saved Display");
    expect(toolValues).not.toContain("Private Saved");
    expect(copiedValues).not.toContain("Private Saved");
    expect(savedAlias).toMatchObject({ exposure: "lookup_only", priority: 10 });
    expect(displayAlias).toMatchObject({ exposure: "lookup_only", priority: 15 });
    expect(savedAlias && serializeParticipantKey(savedAlias.owner)).toBe("discord_user:100");
  });

  it("derives purpose-specific user, persona, and cross-kind collision indexes", () => {
    const firstUser = buildUserAliases("100", "First", "shared");
    const secondUser = buildUserAliases("200", "Second", "SHARED");
    const firstPersona = buildPersonaAliases({
      owner: createPersonaKey(1),
      nickname: "Ren",
      triggerWords: ["lilya"],
    }).aliases;
    const secondPersona = buildPersonaAliases({
      owner: createPersonaKey(2),
      nickname: "ren",
      triggerWords: ["renee"],
    }).aliases;

    expect(
      buildAliasCollisionIndex([...firstUser, ...secondUser], "input_reference").get("shared")?.owners,
    ).toHaveLength(2);
    expect(
      buildAliasCollisionIndex([...firstPersona, ...secondPersona], "output_mention").get("ren")?.owners,
    ).toHaveLength(2);
    expect(buildAliasCollisionIndex([...firstUser, ...firstPersona], "output_mention").get("ren")?.owners).toHaveLength(
      1,
    );

    const overlappingUser = buildUserAliases("300", "Third", "ren");
    const crossKind = buildAliasCollisionIndex([...overlappingUser, ...firstPersona], "output_mention").get("ren");
    expect(crossKind?.owners.map(serializeParticipantKey).sort()).toEqual(["discord_user:300", "persona:1"]);
  });

  it("treats repeated sources for one owner as one owner rather than an ambiguity", () => {
    const aliases = buildDiscordUserAliases({
      owner: createDiscordUserKey("100"),
      userRow: { user_nickname: "Alice" },
      identity: { displayName: "Alice", nickname: "Alice", globalName: "ALICE", username: "alice" },
      exposeSavedNickname: true,
    });

    expect(buildAliasCollisionIndex(aliases, "input_reference").get("alice")?.owners).toHaveLength(1);
    expect(aliasesForPurpose(aliases, "input_reference").map((alias) => alias.value)).toEqual(["Alice"]);
  });

  it("keeps bridge and webhook aliases transport-owned with current capabilities", () => {
    const bridgeAliases = buildBridgeUserAliases({
      owner: createMatrixUserKey("@alice:example.org"),
      displayName: "Alice Matrix",
    });
    const webhookAliases = buildWebhookAliases({
      owner: createWebhookKey("webhook-1"),
      displayName: "Relay",
    });

    expect(aliasesForPurpose(bridgeAliases, "tool_target").map((alias) => alias.value)).toEqual(["Alice Matrix"]);
    expect(aliasesForPurpose(bridgeAliases, "output_mention")).toMatchObject([
      { value: "Alice Matrix", exposure: "lookup_only" },
    ]);
    expect(webhookAliases[0]?.source).toBe("webhook_display_name");
    expect(aliasesForPurpose(webhookAliases, "tool_target")).toEqual([]);
  });
});

describe("pure participant alias reference discovery", () => {
  it("accepts only standalone aliases with one eligible owner and reports aggregate diagnostics", () => {
    const uniqueAliases = buildUserAliases("100", "José María", "jose");
    const ambiguousAliases: ParticipantAlias[] = [
      ...buildUserAliases("200", "Apple", "apple_two"),
      ...buildUserAliases("300", "apple", "apple_three"),
    ];
    const resolved = resolveUniqueParticipantAliasReferences(
      "Ask @JOSÉ   MARÍA. Apple should wait; ignore Pineapple and x@Apple.example.",
      [...uniqueAliases, ...ambiguousAliases],
    );

    expect(resolved.referencedOwners.map(serializeParticipantKey)).toEqual(["discord_user:100"]);
    expect(resolved.diagnostics.acceptedAliasCount).toBeGreaterThan(0);
    expect(resolved.diagnostics.ambiguousAliasCount).toBeGreaterThan(0);
    expect(JSON.stringify(resolved.diagnostics)).not.toContain("José");
    expect(JSON.stringify(resolved.diagnostics)).not.toContain("Apple");
  });
});
