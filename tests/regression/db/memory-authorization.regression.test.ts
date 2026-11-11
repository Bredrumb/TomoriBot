import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { UpdateLongTermMemoryTool } from "@/tools/functionCalls/updateLongTermMemoryTool";
import { PrivacyLevel } from "@/types/db/schema";
import { ContextItemTag } from "@/types/misc/context";
import type { ToolContext } from "@/types/tool/interfaces";
import { personalMemoryRepository, serverRepository, userRepository } from "@/utils/db/repositories";
import { messageProxyRepository } from "@/utils/db/repositories/MessageProxyRepository";
import * as notices from "@/utils/discord/expandableEmbedNotice";
import { personalMemoriesOperations } from "@/utils/discord/interactions/personalMemoriesRoutes";
import { createPersona } from "../../helpers/fixtures";
import { cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

const targetId = "881111111111111111";
const actorId = "882222222222222222";
const guildId = "883333333333333333";
const proxyKey = "11111111-aaaa-4bbb-8ccc-555555555555";
const proxyId = `pk:${proxyKey}`;

describe.skipIf(!DB_TESTS_AVAILABLE)("personal memory deletion authorization", () => {
  let refs: FixtureRefs;
  let ownerId: number;
  let context: ToolContext;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    await testSql`UPDATE servers SET server_disc_id = ${guildId} WHERE server_id = ${refs.serverId}`;
    const owner = await userRepository.register(targetId, "Juno", "en-US");
    if (!owner?.user_id) throw new Error("Could not create memory owner");
    ownerId = owner.user_id;
    const member = { id: targetId, displayName: "Juno", user: { id: targetId, username: "Juno", bot: false } };
    const guild = {
      id: guildId,
      members: { cache: new Map([[targetId, member]]), fetch: async (id: string) => (id === targetId ? member : null) },
    };
    context = {
      userId: actorId,
      guildId,
      locale: "en-US",
      channel: { id: "884444444444444444", guild, isThread: () => false },
      client: { user: { id: "885555555555555555", username: "Mirri" }, guilds: { cache: new Map([[guildId, guild]]) } },
      tomoriState: createPersona({
        server_id: refs.serverId,
        persona_id: refs.personaId,
        persona_lineage_id: refs.personaLineageId,
        config: { self_teaching_enabled: true, personal_memories_enabled: true },
      }),
    } as unknown as ToolContext;
  });

  afterEach(async () => {
    await testSql`DELETE FROM personal_memories WHERE user_id IN (
      SELECT user_id FROM users WHERE user_disc_id IN (${targetId}, ${proxyId})
    )`;
  });

  afterAll(async () => {
    await testSql`DELETE FROM users WHERE user_disc_id = ${proxyId}`;
    await testSql`DELETE FROM message_proxy_namespaces WHERE namespace_key = 'memory-authorization-fixture'`;
    await testSql`DELETE FROM users WHERE user_disc_id = ${targetId}`;
    await testSql`DELETE FROM servers WHERE server_id = ${refs.serverId}`;
    await cleanupFixtures(testSql);
  });

  it.each([
    [PrivacyLevel.PARTIAL, false],
    [PrivacyLevel.FULL, false],
    [PrivacyLevel.PARTIAL, true],
    [PrivacyLevel.FULL, true],
  ] as const)("refuses another member's deletion at privacy %s with global=%s", async (privacy, global) => {
    await userRepository.setPrivacyLevel(targetId, PrivacyLevel.MINIMAL);
    const memory = await personalMemoryRepository.add(
      ownerId,
      global ? 0 : refs.personaLineageId,
      "Synthetic private preference",
    );
    if (!memory?.personal_memory_id) throw new Error("Could not create personal memory");
    await userRepository.setPrivacyLevel(targetId, privacy);
    expect(await userRepository.getPrivacyLevel(targetId)).toBe(privacy);
    const before = await personalMemoryRepository.loadForUserLineage(ownerId, refs.personaLineageId, true);
    expect(before.some((row) => row.personal_memory_id === memory.personal_memory_id)).toBe(true);
    const notice = spyOn(notices, "sendMemoryEmbedWithExpand").mockResolvedValue(undefined);
    try {
      const result = await new UpdateLongTermMemoryTool().execute(
        {
          target_user: targetId,
          memory_id: memory.personal_memory_id,
          memory_content: "",
        },
        context,
      );
      const remaining = await personalMemoryRepository.loadForUserLineage(ownerId, refs.personaLineageId, true);
      expect({
        success: result.success,
        retained: remaining.some((row) => row.personal_memory_id === memory.personal_memory_id),
        disclosedInResult: JSON.stringify(result).includes(memory.content),
        disclosedInNotice: notice.mock.calls.some((call) => call[2].includes(memory.content)),
      }).toEqual({ success: false, retained: true, disclosedInResult: false, disclosedInNotice: false });
    } finally {
      notice.mockRestore();
    }
  });

  it.each([false, true])("permits unprotected personal deletion with global=%s", async (global) => {
    await userRepository.setPrivacyLevel(targetId, PrivacyLevel.MINIMAL);
    const memory = await personalMemoryRepository.add(ownerId, global ? 0 : refs.personaLineageId, "Public preference");
    if (!memory?.personal_memory_id) throw new Error("Could not create personal memory");
    const notice = spyOn(notices, "sendMemoryEmbedWithExpand").mockResolvedValue(undefined);
    try {
      const result = await new UpdateLongTermMemoryTool().execute(
        { target_user: targetId, memory_id: memory.personal_memory_id, memory_content: "" },
        context,
      );
      const remaining = await personalMemoryRepository.loadForUserLineage(ownerId, refs.personaLineageId, true);
      expect(result.success).toBe(true);
      expect(remaining.some((row) => row.personal_memory_id === memory.personal_memory_id)).toBe(false);
      expect(notice).toHaveBeenCalledTimes(1);
    } finally {
      notice.mockRestore();
    }
  });

  it.each([
    [PrivacyLevel.PARTIAL, false],
    [PrivacyLevel.FULL, false],
    [PrivacyLevel.PARTIAL, true],
    [PrivacyLevel.FULL, true],
  ] as const)("preserves owner panel deletion at privacy %s with global=%s", async (privacy, global) => {
    await userRepository.setPrivacyLevel(targetId, PrivacyLevel.MINIMAL);
    const lineage = global ? 0 : refs.personaLineageId;
    const memory = await personalMemoryRepository.add(ownerId, lineage, "Owner-controlled preference");
    if (!memory?.personal_memory_id) throw new Error("Could not create personal memory");
    await userRepository.setPrivacyLevel(targetId, privacy);
    const result = await personalMemoriesOperations.remove({
      userId: ownerId,
      userDiscId: targetId,
      personaLineageId: lineage,
      memoryId: memory.personal_memory_id,
    });
    const remaining = await personalMemoryRepository.loadForUserLineage(ownerId, lineage, false);
    expect(result.status).toBe("success");
    expect(remaining.some((row) => row.personal_memory_id === memory.personal_memory_id)).toBe(false);
  });

  it.each([
    "full_privacy",
    "blacklisted",
  ] as const)("refuses proxy deletion when its host is %s", async (restriction) => {
    await userRepository.setPrivacyLevel(targetId, PrivacyLevel.MINIMAL);
    const identity = await messageProxyRepository.persistAttestedIdentity({
      input: {
        serviceId: "pluralkit",
        externalIdentityKind: "pluralkit_member",
        externalKey: proxyKey,
        shortId: null,
        displayName: "Mirri",
        bio: null,
        namespace: {
          namespaceKey: "memory-authorization-fixture",
          shortId: null,
          displayName: null,
          tag: null,
          description: null,
        },
      },
      messageDiscId: "886666666666666666",
      senderDiscId: targetId,
    });
    if (!identity?.userRow.user_id) throw new Error("Could not create proxy identity");
    const memory = await personalMemoryRepository.add(identity.userRow.user_id, 0, "Protected proxy preference");
    if (!memory?.personal_memory_id) throw new Error("Could not create proxy memory");
    if (restriction === "full_privacy") {
      await userRepository.setPrivacyLevel(targetId, PrivacyLevel.FULL);
    } else {
      expect(await serverRepository.addUserBlacklist(refs.serverId, targetId)).toBe(true);
    }
    const proxyContext: ToolContext = {
      ...context,
      contextItems: [
        {
          role: "user",
          parts: [{ type: "text", text: "Mirri" }],
          metadataTag: ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION,
          conversationUsers: [{ targetId: proxyId, displayLabel: "Mirri", aliases: ["Mirri"], mentionable: false }],
        },
      ],
    };
    const notice = spyOn(notices, "sendMemoryEmbedWithExpand").mockResolvedValue(undefined);
    try {
      const result = await new UpdateLongTermMemoryTool().execute(
        { target_user: proxyId, memory_id: memory.personal_memory_id, memory_content: "" },
        proxyContext,
      );
      const remaining = await personalMemoryRepository.loadForUserLineage(identity.userRow.user_id, 0, false);
      expect(result.data).toMatchObject({ status: "memory_update_failed_privacy_restricted" });
      expect({
        success: result.success,
        retained: remaining.some((row) => row.personal_memory_id === memory.personal_memory_id),
        disclosedInResult: JSON.stringify(result).includes(memory.content),
        disclosedInNotice: notice.mock.calls.some((call) => call[2].includes(memory.content)),
      }).toEqual({ success: false, retained: true, disclosedInResult: false, disclosedInNotice: false });
    } finally {
      notice.mockRestore();
      await userRepository.setPrivacyLevel(targetId, PrivacyLevel.MINIMAL);
      if (restriction === "blacklisted") await userRepository.removeBlacklistEntry(refs.serverId, targetId, guildId);
    }
  });
});
