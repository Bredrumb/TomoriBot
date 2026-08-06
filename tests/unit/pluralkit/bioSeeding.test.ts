import { afterEach, describe, expect, it } from "bun:test";
import {
  composePluralKitBioSeedContent,
  seedPluralKitMemberBio,
  type PluralKitBioSeedDeps,
} from "@/utils/pluralkit/bioSeeding";

function makeDeps(overrides: Partial<PluralKitBioSeedDeps> = {}): {
  deps: PluralKitBioSeedDeps;
  addCalls: Array<{ userId: number; personaLineageId: number; content: string }>;
  invalidateCalls: string[];
} {
  const addCalls: Array<{ userId: number; personaLineageId: number; content: string }> = [];
  const invalidateCalls: string[] = [];

  const deps: PluralKitBioSeedDeps = {
    getHostProtection: async () => ({ protected: false, isPluralKitUser: true }),
    addPersonalMemory: async (userId, personaLineageId, content) => {
      addCalls.push({ userId, personaLineageId, content });
      return { personal_memory_id: 1 };
    },
    invalidateCache: (userDiscId: string) => {
      invalidateCalls.push(userDiscId);
    },
    ...overrides,
  };

  return { deps, addCalls, invalidateCalls };
}

const originalBioSeedMaxChars = process.env.PLURALKIT_BIO_SEED_MAX_CHARS;

afterEach(() => {
  if (originalBioSeedMaxChars === undefined) delete process.env.PLURALKIT_BIO_SEED_MAX_CHARS;
  else process.env.PLURALKIT_BIO_SEED_MAX_CHARS = originalBioSeedMaxChars;
});

describe("composePluralKitBioSeedContent", () => {
  it("flattens newlines and repeated whitespace to single spaces", () => {
    const content = composePluralKitBioSeedContent("TestA", "line one\n\nline   two\tline three");
    expect(content).toBe("From TestA's PluralKit bio: line one line two line three");
  });

  it("truncates to PLURALKIT_BIO_SEED_MAX_CHARS", () => {
    process.env.PLURALKIT_BIO_SEED_MAX_CHARS = "20";
    const content = composePluralKitBioSeedContent("TestA", "a very long bio that exceeds the cap");
    expect(content).toHaveLength(20);
    expect(content).toBe("From TestA's PluralK");
  });
});

describe("seedPluralKitMemberBio", () => {
  it("inserts a memory and invalidates the cache on a new member with a bio", async () => {
    const { deps, addCalls, invalidateCalls } = makeDeps();

    await seedPluralKitMemberBio(
      {
        isNewMember: true,
        memberUserDiscId: "pk:mem-uuid",
        memberUserId: 42,
        memberDisplayName: "TestA",
        description: "pronouns: she/her",
        serverDiscId: "server_1",
      },
      deps,
    );

    expect(addCalls).toHaveLength(1);
    expect(addCalls[0]?.userId).toBe(42);
    expect(addCalls[0]?.personaLineageId).toBe(0);
    expect(addCalls[0]?.content).toBe("From TestA's PluralKit bio: pronouns: she/her");
    expect(invalidateCalls).toEqual(["pk:mem-uuid"]);
  });

  it("does not insert when the description is empty or absent", async () => {
    const { deps, addCalls, invalidateCalls } = makeDeps();

    await seedPluralKitMemberBio(
      {
        isNewMember: true,
        memberUserDiscId: "pk:mem-uuid",
        memberUserId: 42,
        memberDisplayName: "TestB",
        description: "   ",
        serverDiscId: "server_1",
      },
      deps,
    );
    await seedPluralKitMemberBio(
      {
        isNewMember: true,
        memberUserDiscId: "pk:mem-uuid",
        memberUserId: 42,
        memberDisplayName: "TestB",
        description: undefined,
        serverDiscId: "server_1",
      },
      deps,
    );

    expect(addCalls).toHaveLength(0);
    expect(invalidateCalls).toHaveLength(0);
  });

  it("does not insert when isNewMember is false", async () => {
    const { deps, addCalls } = makeDeps();

    await seedPluralKitMemberBio(
      {
        isNewMember: false,
        memberUserDiscId: "pk:mem-uuid",
        memberUserId: 42,
        memberDisplayName: "TestA",
        description: "pronouns: she/her",
        serverDiscId: "server_1",
      },
      deps,
    );

    expect(addCalls).toHaveLength(0);
  });

  it("does not insert when the host is protected", async () => {
    const { deps, addCalls } = makeDeps({
      getHostProtection: async () => ({
        protected: true,
        isPluralKitUser: true,
        reason: "host_full_privacy",
        hostUserDiscId: "host_1",
      }),
    });

    await seedPluralKitMemberBio(
      {
        isNewMember: true,
        memberUserDiscId: "pk:mem-uuid",
        memberUserId: 42,
        memberDisplayName: "TestA",
        description: "pronouns: she/her",
        serverDiscId: "server_1",
      },
      deps,
    );

    expect(addCalls).toHaveLength(0);
  });

  it("does not invalidate the cache when the personal-memory limit is reached", async () => {
    const { deps, invalidateCalls } = makeDeps({
      addPersonalMemory: async () => null,
    });

    await seedPluralKitMemberBio(
      {
        isNewMember: true,
        memberUserDiscId: "pk:mem-uuid",
        memberUserId: 42,
        memberDisplayName: "TestA",
        description: "pronouns: she/her",
        serverDiscId: "server_1",
      },
      deps,
    );

    expect(invalidateCalls).toHaveLength(0);
  });
});
