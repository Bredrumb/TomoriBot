import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { personalMemorySchema } from "@/types/db/schema";
import { personalMemoryRepository } from "@/utils/db/repositories/PersonalMemoryRepository";
import * as hostProtection from "@/utils/messageProxy/hostProtection";
import * as userCache from "@/utils/cache/userCache";
import {
  composeMessageProxyBioSeedContent,
  seedMessageProxyIdentityBio,
  type MessageProxyBioSeedDeps,
} from "@/utils/messageProxy/bioSeeding";

function makeDeps(overrides: Partial<MessageProxyBioSeedDeps> = {}): {
  deps: MessageProxyBioSeedDeps;
  addCalls: Array<{ userId: number; personaLineageId: number; content: string }>;
  invalidateCalls: string[];
} {
  const addCalls: Array<{ userId: number; personaLineageId: number; content: string }> = [];
  const invalidateCalls: string[] = [];

  const deps: MessageProxyBioSeedDeps = {
    getHostProtection: async () => ({ protected: false, isMessageProxyIdentity: true }),
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

const originalBioSeedMaxChars = process.env.MESSAGE_PROXY_BIO_SEED_MAX_CHARS;

afterEach(() => {
  if (originalBioSeedMaxChars === undefined) delete process.env.MESSAGE_PROXY_BIO_SEED_MAX_CHARS;
  else process.env.MESSAGE_PROXY_BIO_SEED_MAX_CHARS = originalBioSeedMaxChars;
});

describe("composeMessageProxyBioSeedContent", () => {
  it("flattens newlines and repeated whitespace to single spaces", () => {
    const content = composeMessageProxyBioSeedContent("line one\n\nline   two\tline three");
    expect(content).toBe("line one line two line three");
  });

  it("stores the bio verbatim, with no provenance prefix", () => {
    expect(composeMessageProxyBioSeedContent("pronouns: she/her")).toBe("pronouns: she/her");
  });

  it("truncates to MESSAGE_PROXY_BIO_SEED_MAX_CHARS", () => {
    process.env.MESSAGE_PROXY_BIO_SEED_MAX_CHARS = "20";
    const content = composeMessageProxyBioSeedContent("a very long bio that exceeds the cap");
    expect(content).toHaveLength(20);
    expect(content).toBe("a very long bio that");
  });
});

describe("seedMessageProxyIdentityBio", () => {
  it("uses the ordinary repository insert without requesting manual protection", async () => {
    const add = spyOn(personalMemoryRepository, "add").mockResolvedValue(
      personalMemorySchema.parse({
        personal_memory_id: 1,
        user_id: 42,
        persona_lineage_id: 0,
        content: "A short bio",
        tags: [],
        manually_written: false,
      }),
    );
    const protection = spyOn(hostProtection, "getMessageProxyHostProtection").mockResolvedValue({
      protected: false,
      isMessageProxyIdentity: true,
    });
    const invalidate = spyOn(userCache, "invalidateUserCache").mockImplementation(() => {});
    try {
      await seedMessageProxyIdentityBio({
        isNewIdentity: true,
        identityUserDiscId: "fixture:identity-1",
        identityUserId: 42,
        description: "A short bio",
        serverDiscId: "server_1",
      });
      expect(add).toHaveBeenCalledWith(42, 0, "A short bio");
    } finally {
      add.mockRestore();
      protection.mockRestore();
      invalidate.mockRestore();
    }
  });
  it("inserts a memory and invalidates the cache on a new member with a bio", async () => {
    const { deps, addCalls, invalidateCalls } = makeDeps();

    await seedMessageProxyIdentityBio(
      {
        isNewIdentity: true,
        identityUserDiscId: "fixture:identity-1",
        identityUserId: 42,
        description: "pronouns: she/her",
        serverDiscId: "server_1",
      },
      deps,
    );

    expect(addCalls).toHaveLength(1);
    expect(addCalls[0]?.userId).toBe(42);
    expect(addCalls[0]?.personaLineageId).toBe(0);
    expect(addCalls[0]?.content).toBe("pronouns: she/her");
    expect(invalidateCalls).toEqual(["fixture:identity-1"]);
  });

  it("does not insert when the description is empty or absent", async () => {
    const { deps, addCalls, invalidateCalls } = makeDeps();

    await seedMessageProxyIdentityBio(
      {
        isNewIdentity: true,
        identityUserDiscId: "fixture:identity-1",
        identityUserId: 42,
        description: "   ",
        serverDiscId: "server_1",
      },
      deps,
    );
    await seedMessageProxyIdentityBio(
      {
        isNewIdentity: true,
        identityUserDiscId: "fixture:identity-1",
        identityUserId: 42,
        description: undefined,
        serverDiscId: "server_1",
      },
      deps,
    );

    expect(addCalls).toHaveLength(0);
    expect(invalidateCalls).toHaveLength(0);
  });

  it("does not insert when isNewIdentity is false", async () => {
    const { deps, addCalls } = makeDeps();

    await seedMessageProxyIdentityBio(
      {
        isNewIdentity: false,
        identityUserDiscId: "fixture:identity-1",
        identityUserId: 42,
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
        isMessageProxyIdentity: true,
        reason: "host_full_privacy",
        hostUserDiscId: "host_1",
      }),
    });

    await seedMessageProxyIdentityBio(
      {
        isNewIdentity: true,
        identityUserDiscId: "fixture:identity-1",
        identityUserId: 42,
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

    await seedMessageProxyIdentityBio(
      {
        isNewIdentity: true,
        identityUserDiscId: "fixture:identity-1",
        identityUserId: 42,
        description: "pronouns: she/her",
        serverDiscId: "server_1",
      },
      deps,
    );

    expect(invalidateCalls).toHaveLength(0);
  });
});
