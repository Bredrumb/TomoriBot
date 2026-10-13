import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import type { Client } from "discord.js";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import { userSavedProviderConfigSchema } from "@/types/db/schema";
import * as channelLlm from "@/utils/cache/channelLlmCache";
import * as channelPrompt from "@/utils/cache/channelPromptCache";
import * as channelNote from "@/utils/cache/channelContextNoteCache";
import * as preset from "@/utils/cache/stPresetCache";
import * as userCache from "@/utils/cache/userCache";
import * as credentials from "@/utils/provider/credentialResolver";
import * as personalRuntime from "@/utils/provider/personalProviderRuntime";
import * as crypto from "@/utils/security/crypto";
import * as rotation from "@/utils/security/keyRotation";
import * as contextBuilder from "@/utils/text/contextBuilder";
import * as participants from "@/utils/text/participants/preparation";
import { userNamingRepository, userRepository } from "@/utils/db/repositories";
import { clearNovelaiSubscriptionCache } from "@/utils/cache/novelaiSubscriptionCache";
import { getKayraVirtualContextLength } from "@/utils/cache/novelaiCapabilityCache";
import { assemblePromptInspection, type PromptInspectionRequest } from "@/utils/text/promptInspection/assemble";
import { buildJsonSnapshot, buildRequestConfig, buildTextSnapshot } from "@/utils/text/promptInspection/serialize";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";
import { stubGlobalFetch } from "../../helpers/fetchStub";

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
  clearNovelaiSubscriptionCache();
});

describe("NovelAI prompt inspection credentials", () => {
  it("uses the resolved server/personal key without rotating and keeps credential identities out of exports", async () => {
    const client = { guilds: { cache: new Map() } } as unknown as Client;
    const prepared = await participants.prepareParticipantContext({
      client,
      guildId: "guild-1",
      simplifiedMessageHistory: [],
      personas: [],
      activePersona: null,
      visibleUserIds: [],
      candidateSource: { loadCandidates: async () => [] },
      memberDirectory: null,
    });
    const items: StructuredContextItem[] = Array.from({ length: 6 }, () => [
      {
        role: "user" as const,
        metadataTag: ContextItemTag.DIALOGUE_HISTORY,
        parts: [{ type: "text" as const, text: `Mirri: ${"x".repeat(1500)}` }],
      },
      {
        role: "model" as const,
        metadataTag: ContextItemTag.DIALOGUE_HISTORY,
        parts: [{ type: "text" as const, text: `Juno: ${"y".repeat(1500)}` }],
      },
    ]).flat();
    const spies = [
      spyOn(channelLlm, "getCachedChannelLlm").mockResolvedValue(null),
      spyOn(channelPrompt, "getCachedChannelPrompt").mockResolvedValue(null),
      spyOn(channelNote, "getCachedChannelContextNote").mockResolvedValue(null),
      spyOn(preset, "getCachedActivePreset").mockResolvedValue(null),
      spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(0),
      spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false),
      spyOn(userNamingRepository, "loadPreferences").mockResolvedValue(new Map()),
      spyOn(userRepository, "isBlacklisted").mockResolvedValue(false),
      spyOn(participants, "prepareParticipantContext").mockResolvedValue(prepared),
      spyOn(contextBuilder, "buildContext").mockImplementation(async () => ({
        contextItems: [...items],
        tailDirectives: [],
        lowerPriorityTailDirectives: [],
        messageIdMap: new MessageIdMap(),
      })),
    ];
    for (const spy of spies) restores.push(() => spy.mockRestore());
    const rotated = spyOn(rotation, "selectApiKey");
    restores.push(() => rotated.mockRestore());
    const decrypted = spyOn(crypto, "decryptApiKey").mockImplementation(async (key) =>
      key.toString().replace("encrypted-", ""),
    );
    restores.push(() => decrypted.mockRestore());
    const server = createPersona({
      persona_nickname: "Juno",
      llm: createLlmRow({ llm_provider: "novelai", llm_codename: "kayra-v1" }),
      config: { api_key: Buffer.from("encrypted-server-key"), deliberate_tool_mode: false },
    });
    const personal = { ...server, config: { ...server.config, api_key: Buffer.from("encrypted-personal-key") } };
    const userData = createUserRow({ user_id: 4, user_disc_id: "user-1" });
    const user = { id: "user-1", bot: false, username: "Mirri", displayName: "Mirri" };
    const message = {
      id: "message-1",
      author: user,
      content: "hello",
      attachments: new Map(),
      stickers: new Map(),
      embeds: [],
      components: [],
      createdTimestamp: 1000,
    };
    const request = {
      client,
      guild: { id: "guild-1", name: "Test guild" },
      channel: {
        id: "channel-1",
        name: "test",
        isThread: () => false,
        messages: { fetch: async () => new Map([[message.id, message]]) },
      },
      user,
      userData,
      tomoriState: server,
      selectedPersona: server,
      personas: [server],
      includeTools: false,
    } as unknown as PromptInspectionRequest;
    const savedConfig = userSavedProviderConfigSchema.parse({
      user_id: 4,
      provider: "novelai",
      api_key: personal.config.api_key,
      llm_id: server.llm.llm_id,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
      enabled_capabilities: ["text"],
      assigned_capabilities: ["text"],
      llm_disabled_params: [],
      llm_logit_biases: [],
      fallback_model_refs: [],
    });
    const resolved = spyOn(credentials, "resolveCapabilityCredentials");
    const overlay = spyOn(personalRuntime, "applyPersonalProviderSelectionsToTomoriState").mockResolvedValue({
      tomoriState: personal,
      activeConfigs: { text: savedConfig },
    });
    restores.push(
      () => resolved.mockRestore(),
      () => overlay.mockRestore(),
    );
    const seenKeys: string[] = [];
    const fetch = stubGlobalFetch((_input, init) => {
      const key = new Headers(init?.headers).get("Authorization")?.replace("Bearer ", "") ?? "";
      seenKeys.push(key);
      return Response.json({ tier: key === "personal-key" ? 1 : 3, active: true });
    });
    restores.push(() => fetch.mockRestore());
    const snapshots = [];
    for (const source of ["server", "personal"] as const) {
      resolved.mockResolvedValue({ provider: "novelai", apiKey: `${source}-key`, keyVersion: 1, savedConfig, source });
      const snapshot = await assemblePromptInspection(request);
      expect(snapshot?.budget?.contextLength).toBe(getKayraVirtualContextLength(source === "personal" ? 4096 : 8192));
      if (!snapshot) throw new Error("Inspection returned no snapshot");
      snapshots.push(snapshot);
      const exports = JSON.stringify([
        buildTextSnapshot(snapshot.contextItems),
        await buildJsonSnapshot(
          snapshot.contextItems,
          snapshot.answeringState,
          snapshot.providerName,
          snapshot.modelName,
          snapshot.toolsData,
          buildRequestConfig(
            snapshot.answeringState,
            snapshot.providerName,
            snapshot.modelName,
            snapshot.budget?.outputReserve,
          ),
        ),
      ]);
      for (const key of ["server-key", "personal-key"]) {
        expect(exports).not.toContain(key);
        expect(exports).not.toContain(createHash("sha256").update(key).digest("hex"));
      }
    }
    expect(snapshots[1].historyPairsDropped).toBeGreaterThan(snapshots[0].historyPairsDropped);
    expect(seenKeys).toEqual(["server-key", "personal-key"]);
    expect(rotated).not.toHaveBeenCalled();
  });
});
