import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, type Mock, spyOn } from "bun:test";
import type { AttachmentBuilder, ButtonInteraction, Message, TextChannel } from "discord.js";
import { MemoryTool } from "@/tools/functionCalls/memoryTool";
import { personalMemorySchema, PrivacyLevel, serverMemorySchema } from "@/types/db/schema";
import type { ToolContext } from "@/types/tool/interfaces";
import * as serverCache from "@/utils/cache/tomoriStateCache";
import * as userCache from "@/utils/cache/userCache";
import { personalMemoryRepository, serverMemoryRepository, userRepository } from "@/utils/db/repositories";
import { metricSampleRepository } from "@/utils/db/repositories/MetricSampleRepository";
import * as targetResolver from "@/utils/discord/targetResolver";
import * as interactionLocale from "@/utils/discord/interactionLocale";
import * as personaPost from "@/utils/discord/webhook/personaPost";
import * as noticeRouting from "@/utils/discord/toolProgressNotice";
import * as minimalNotices from "@/utils/discord/minimalNoticeBodies";
import * as hostProtection from "@/utils/messageProxy/hostProtection";
import { log } from "@/utils/misc/logger";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import { initializeLocalizer } from "@/utils/text/localizer";
import { buildTextPreview } from "@/utils/text/textPreview";
import { MEMORY_NOTICE_PREVIEW_LIMIT } from "@/utils/discord/expandableEmbedNotice";
import type { ComponentsV2MessagePayload } from "@/utils/discord/ui/componentsV2Limits";
import { useEnvSandbox } from "../../helpers/env";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";
import { collectTextDisplays, expectSafePanelPayload } from "../../helpers/panelLimits";

const USER_ID = "111111111111111111";
const BOT_ID = "222222222222222222";
const SERVER_ID = "333333333333333333";
const newContent = "{user} likes telling stories to {bot}.";
const forgottenContent = `{user} asked {bot} to greet <@${BOT_ID}>.`;
const scopes: ("server_wide" | "target_user")[] = ["server_wide", "target_user"];

describe("model memory save eviction", () => {
  useEnvSandbox(["MAX_MEMORY_LENGTH"]);
  let postSpy: Mock<typeof personaPost.sendPersonaPost>;
  let context: ToolContext;
  let events: string[];
  let collect: ((interaction: ButtonInteraction) => Promise<void>) | undefined;
  let serverResult: Awaited<ReturnType<typeof serverMemoryRepository.addWithEviction>>;
  let personalResult: Awaited<ReturnType<typeof personalMemoryRepository.addWithEviction>>;

  beforeAll(initializeLocalizer);
  beforeEach(() => {
    events = [];
    collect = undefined;
    const user = createUserRow({ user_id: 7, user_disc_id: USER_ID, user_nickname: "Juno" });
    context = {
      userId: USER_ID,
      memoryEmbeddingResolved: true,
      guildId: SERVER_ID,
      locale: "en-US",
      channel: { id: "444444444444444444", guild: { id: SERVER_ID }, isThread: () => false },
      client: { user: { id: BOT_ID, username: "Mirri" }, guilds: { cache: new Map() } },
      tomoriState: createPersona({
        server_id: 5,
        persona_id: 6,
        persona_lineage_id: 8,
        persona_nickname: "Mirri",
        config: { self_teaching_enabled: true, tool_notice_verbosity: "verbose" },
      }),
    } as unknown as ToolContext;
    serverResult = {
      status: "saved",
      memory: serverMemorySchema.parse({
        server_memory_id: 10,
        server_id: 5,
        persona_id: 6,
        persona_lineage_id: 8,
        user_id: 7,
        content: newContent,
        manually_written: false,
      }),
      evicted: { id: 9, content: forgottenContent, decay_days: 17 },
    };
    personalResult = {
      status: "saved",
      memory: personalMemorySchema.parse({
        personal_memory_id: 12,
        user_id: 7,
        persona_lineage_id: 8,
        content: newContent,
        manually_written: false,
      }),
      evicted: { id: 11, content: forgottenContent, decay_days: 17 },
    };
    spyOn(userRepository, "loadByDiscordId").mockResolvedValue(user);
    spyOn(userRepository, "getPrivacyLevel").mockResolvedValue(PrivacyLevel.MINIMAL);
    spyOn(userRepository, "isBlacklisted").mockResolvedValue(false);
    spyOn(interactionLocale, "resolveUserLocale").mockResolvedValue("en-US");
    spyOn(targetResolver, "resolveUserTarget").mockResolvedValue({
      status: "resolved",
      targetId: USER_ID,
      displayLabel: "Juno",
      isBridgeUser: false,
      source: "conversation",
    });
    spyOn(hostProtection, "getMessageProxyHostProtection").mockResolvedValue({
      protected: false,
      isMessageProxyIdentity: false,
    });
    spyOn(serverMemoryRepository, "addWithEviction").mockImplementation(async () => {
      events.push("write");
      return serverResult;
    });
    spyOn(personalMemoryRepository, "addWithEviction").mockImplementation(async () => {
      events.push("write");
      return personalResult;
    });
    spyOn(serverCache, "invalidateTomoriStateCache").mockImplementation(() => {
      events.push("invalidate-server");
    });
    spyOn(userCache, "invalidateUserCache").mockImplementation(() => {
      events.push("invalidate-personal");
    });
    spyOn(log, "metric").mockImplementation(() => {});
    spyOn(log, "success").mockImplementation(() => {});
    spyOn(log, "warn").mockImplementation(() => {});
    spyOn(log, "error").mockResolvedValue(undefined);
    spyOn(metricSampleRepository, "recordSample").mockResolvedValue(undefined);
    postSpy = spyOn(personaPost, "sendPersonaPost").mockImplementation(async (_context, _payload) => {
      events.push("notify");
      return {
        status: "sent",
        message: {
          id: "555555555555555555",
          createMessageComponentCollector: () => ({
            on: (event: string, handler: (interaction: ButtonInteraction) => Promise<void>) => {
              if (event === "collect") collect = handler;
            },
          }),
        } as unknown as Message,
        receipt: {
          messageId: "555555555555555555",
          channelId: context.channel.id,
          route: "bot",
          webhookId: null,
          identity: { username: "Mirri" },
          speaker: null,
        },
      };
    });
  });
  afterEach(() => mock.restore());

  function save(scope: (typeof scopes)[number], content = newContent) {
    return new MemoryTool().execute({ memory_scope: scope, memory_content: content, target_user: "Juno" }, context);
  }

  it.each(scopes)("surfaces a committed %s eviction and invalidates before notification", async (scope) => {
    const result = await save(scope);
    const metricScope = scope === "server_wide" ? "server" : "personal";
    expect(result).toMatchObject({
      success: true,
      data: {
        status: "memory_saved_with_eviction",
        scope,
        content_saved: newContent,
        content_forgotten: forgottenContent,
      },
    });
    expect(events).toEqual(["write", `invalidate-${metricScope}`, "notify"]);
    if (scope === "server_wide") {
      expect(serverMemoryRepository.addWithEviction).toHaveBeenCalledWith(5, 6, 8, 7, newContent, true);
      expect(serverCache.invalidateTomoriStateCache).toHaveBeenCalledWith(SERVER_ID);
    } else {
      expect(personalMemoryRepository.addWithEviction).toHaveBeenCalledWith(7, 8, newContent, true);
      expect(userCache.invalidateUserCache).toHaveBeenCalledWith(USER_ID);
    }
    const payload = postSpy.mock.calls[0]?.[1];
    const text = collectTextDisplays(payload).join("\n");
    expect(text).toContain("Juno likes telling stories to Mirri.");
    expect(text).toContain(
      localizedCopy("en-US", "genai.self_teach.memory_forgotten_description", {
        forgotten_content: "Juno asked Mirri to greet Mirri.",
      }),
    );
    expect(log.metric).toHaveBeenCalledTimes(1);
    expect(log.metric).toHaveBeenCalledWith("memory_eviction", { scope: metricScope, decay_days: 17 });
    expect(metricSampleRepository.recordSample).toHaveBeenCalledTimes(1);
    expect(metricSampleRepository.recordSample).toHaveBeenCalledWith("memory_eviction", {
      scope: metricScope,
      decay_days: 17,
    });
  });

  it.each(scopes)("preserves the %s refusal without invalidation, notices, or eviction metrics", async (scope) => {
    serverResult = personalResult = { status: "refused", currentCount: 100, limit: 100 };
    const result = await save(scope);
    expect(result).toMatchObject({
      success: false,
      data: { status: "memory_save_failed_limit_exceeded", scope, current_count: 100, max_allowed: 100 },
    });
    expect((result.data as { reason: string }).reason).toContain(
      scope === "server_wide" ? "'/memories'" : "'/personal memories'",
    );
    expect(events).toEqual(["write"]);
    expect(log.metric).not.toHaveBeenCalled();
    expect(metricSampleRepository.recordSample).not.toHaveBeenCalled();
  });

  it.each(scopes)("preserves the ordinary %s save result and notice", async (scope) => {
    if (serverResult.status === "saved") serverResult.evicted = null;
    if (personalResult.status === "saved") personalResult.evicted = null;
    const result = await save(scope);
    expect(result).toMatchObject({
      success: true,
      data: { status: "memory_saved_successfully", content_saved: newContent },
    });
    expect(result.data).not.toHaveProperty("content_forgotten");
    const text = collectTextDisplays(postSpy.mock.calls[0]?.[1]).join("\n");
    const key = `genai.self_teach.${scope === "server_wide" ? "server" : "personal"}_memory_learned_description`;
    expect(text).toContain(
      localizedCopy("en-US", key, { user_nickname: "Juno", memory_content: "Juno likes telling stories to Mirri." }),
    );
    expect(log.metric).not.toHaveBeenCalled();
    expect(metricSampleRepository.recordSample).not.toHaveBeenCalled();
  });

  it.each(scopes)("keeps a durable %s save successful when notification fails", async (scope) => {
    postSpy.mockRejectedValue(new Error("delivery failed"));
    const result = await save(scope);
    expect(result).toMatchObject({
      success: true,
      data: { status: "memory_saved_with_eviction", content_forgotten: forgottenContent },
    });
    expect(events).toEqual(["write", scope === "server_wide" ? "invalidate-server" : "invalidate-personal"]);
    expect(log.warn).toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(metricSampleRepository.recordSample).toHaveBeenCalledTimes(1);
  });

  it.each(scopes)("does not invalidate or notify when the %s transaction fails", async (scope) => {
    spyOn(serverMemoryRepository, "addWithEviction").mockRejectedValue(new Error("transaction failed"));
    spyOn(personalMemoryRepository, "addWithEviction").mockRejectedValue(new Error("transaction failed"));
    expect((await save(scope)).success).toBe(false);
    expect(events).toEqual([]);
    expect(log.metric).not.toHaveBeenCalled();
    expect(metricSampleRepository.recordSample).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalled();
  });

  it.each(scopes)("routes %s eviction content through Hidden, Minimal, and Verbose settings", async (scope) => {
    const thoughtLog = { id: "666666666666666666", isThread: () => false } as TextChannel;
    spyOn(noticeRouting, "resolveHiddenNoticeTarget").mockResolvedValue({
      channel: thoughtLog,
      webhookContext: { persona: context.tomoriState },
    });
    spyOn(minimalNotices, "recordMinimalNoticeRef").mockResolvedValue(undefined);
    for (const mode of ["hidden", "minimal", "verbose"] as const) {
      postSpy.mockClear();
      context.tomoriState.config.tool_notice_hidden_keys = mode === "hidden" ? ["memory_update"] : [];
      context.tomoriState.config.tool_notice_verbosity = mode === "verbose" ? "verbose" : "minimal";
      await save(scope);
      const conversation = postSpy.mock.calls.filter(([target]) => target.channel.id === context.channel.id);
      const mirrored = postSpy.mock.calls.filter(([target]) => target.channel.id === thoughtLog.id);
      expect(conversation).toHaveLength(mode === "hidden" ? 0 : 1);
      expect(mirrored).toHaveLength(mode === "verbose" ? 0 : 1);
      const fullCard = mode === "verbose" ? conversation[0] : mirrored[0];
      expect(collectTextDisplays(fullCard?.[1]).join("\n")).toContain("Juno asked Mirri to greet Mirri.");
      if (mode === "minimal") {
        expect(collectTextDisplays(conversation[0]?.[1]).join("\n")).not.toContain("Juno asked Mirri to greet Mirri.");
      }
    }
  });

  it.each(scopes)("passes missing turn embedding readiness to the %s save", async (scope) => {
    context.memoryEmbeddingResolved = undefined;
    await save(scope);
    const repository = scope === "server_wide" ? serverMemoryRepository : personalMemoryRepository;
    expect(repository.addWithEviction).toHaveBeenCalled();
    const call =
      scope === "server_wide"
        ? (serverMemoryRepository.addWithEviction as Mock<typeof serverMemoryRepository.addWithEviction>).mock.calls[0]
        : (personalMemoryRepository.addWithEviction as Mock<typeof personalMemoryRepository.addWithEviction>).mock
            .calls[0];
    expect(call?.at(-1)).toBe(false);
  });

  it("bounds both longest-memory previews and preserves the expanded content", async () => {
    process.env.MAX_MEMORY_LENGTH = "1000";
    const content = "`".repeat(getMemoryLimits().maxMemoryLength);
    if (serverResult.status !== "saved") throw new Error("Expected saved fixture");
    serverResult.evicted = { id: 9, content, decay_days: 14 };
    await save("server_wide", content);
    const payload = postSpy.mock.calls[0]?.[1];
    if (!payload || !("components" in payload)) throw new Error("Missing notice components");
    expectSafePanelPayload(payload as ComponentsV2MessagePayload, "memory eviction notice");
    const preview = buildTextPreview(content, MEMORY_NOTICE_PREVIEW_LIMIT).text;
    expect(collectTextDisplays(payload).join("\n")).toContain(
      localizedCopy("en-US", "genai.self_teach.memory_forgotten_description", { forgotten_content: preview }),
    );
    const reply = mock(async (_payload: unknown) => {});
    expect(collect).toBeDefined();
    await collect?.({ reply } as unknown as ButtonInteraction);
    const replyPayload = reply.mock.calls[0]?.[0] as unknown as { embeds: { toJSON(): { description?: string } }[] };
    const description = replyPayload.embeds[0]?.toJSON().description;
    expect(description?.length).toBeLessThanOrEqual(4096);
    expect(description).toContain(
      buildTextPreview(
        localizedCopy("en-US", "genai.self_teach.memory_saved_with_eviction_content", {
          memory_content: content,
          forgotten_content: content,
        }),
        Number.MAX_SAFE_INTEGER,
      ).text,
    );
  });

  it("offers the complete text as a file when placeholder expansion exceeds embed limits", async () => {
    process.env.MAX_MEMORY_LENGTH = "1000";
    const content = "{bot}".repeat(200);
    context.tomoriState.persona_nickname = "M".repeat(32);
    if (personalResult.status !== "saved") throw new Error("Expected saved fixture");
    personalResult.evicted = { id: 11, content, decay_days: 14 };
    await save("target_user", content);
    const reply = mock(async (_payload: unknown) => {});
    await collect?.({ reply } as unknown as ButtonInteraction);
    const payload = reply.mock.calls[0]?.[0] as { files: AttachmentBuilder[] };
    const text = payload.files[0]?.attachment.toString();
    expect(text).toBe(
      localizedCopy("en-US", "genai.self_teach.memory_saved_with_eviction_content", {
        memory_content: "M".repeat(32 * 200),
        forgotten_content: "M".repeat(32 * 200),
      }),
    );
  });
});
