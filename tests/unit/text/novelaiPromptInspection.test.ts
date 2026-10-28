import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
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
import { appendDialogueHistoryContext, DOCUMENT_HINT_TEMPLATE } from "@/utils/text/context/dialogueHistory";
import { buildConditioningInteractionEmbed } from "@/utils/conditioning/conditioningEmbed";
import { initializeLocalizer } from "@/utils/text/localizer";
import * as participants from "@/utils/text/participants/preparation";
import { userNamingRepository, userRepository } from "@/utils/db/repositories";
import { clearNovelaiSubscriptionCache } from "@/utils/cache/novelaiSubscriptionCache";
import { assemblePromptInspection, type PromptInspectionRequest } from "@/utils/text/promptInspection/assemble";
import { buildJsonSnapshot, buildRequestConfig, buildTextSnapshot } from "@/utils/text/promptInspection/serialize";
import { MessageIdMap } from "@/utils/text/messageIdMap";
import { createLlmRow, createPersona, createUserRow } from "../../helpers/fixtures";
import { stubGlobalFetch } from "../../helpers/fetchStub";
import { NovelaiStreamAdapter } from "@/providers/novelai/novelaiStreamAdapter";
import { prepareNovelAIRequest } from "@/providers/novelai/promptFitting";
import { getNovelAIProfile } from "@/providers/novelai/modelProfiles";
import { createNovelAITokenizerEncoder } from "@/utils/provider/localTokenizerRegistry";
import type { StreamConfig, StreamContext } from "@/types/stream/interfaces";

const restores: Array<() => void> = [];
beforeAll(initializeLocalizer);
afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
  clearNovelaiSubscriptionCache();
});

describe("NovelAI prompt inspection credentials", () => {
  it("exports each profile's actual request and fitting decisions", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetch = stubGlobalFetch((url, init) => {
      if (String(url).endsWith("/user/subscription")) return Response.json({ tier: 3, active: true });
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response("data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
    });
    restores.push(() => fetch.mockRestore());
    const items: StructuredContextItem[] = [
      {
        role: "system",
        metadataTag: ContextItemTag.SYSTEM_INSTRUCTION_BLOCK,
        parts: [{ type: "text", text: "inactive-prompt" }],
      },
      {
        role: "system",
        metadataTag: ContextItemTag.SYSTEM_PERSONALITY,
        parts: [{ type: "text", text: "Quiet and curious." }],
      },
      {
        role: "user",
        metadataTag: ContextItemTag.KNOWLEDGE_SERVER_MEMORIES,
        parts: [{ type: "text", text: " river".repeat(7_000) }],
      },
      {
        role: "user",
        metadataTag: ContextItemTag.DIALOGUE_HISTORY,
        completionText: "Mirri: hello",
        parts: [{ type: "text", text: "Mirri: hello" }],
      },
    ];
    for (const model of ["glm-4-6", "xialong-v1", "kayra-v1", "llama-3-erato-v1"]) {
      const persona = createPersona({
        persona_nickname: "Juno",
        llm: createLlmRow({ llm_provider: "novelai", llm_codename: model }),
        config: { llm_max_output_tokens: 96, llm_stop_strings: ["END"], thinking_level: "auto" },
      });
      const prepared = await prepareNovelAIRequest({
        contextItems: items,
        tomoriState: persona,
        model,
        apiKey: "test-key",
      });
      const json = await buildJsonSnapshot(prepared.contextItems, persona, "novelai", model, null, {}, prepared);
      const text = buildTextSnapshot(prepared.contextItems, prepared);
      const requestConfig = buildRequestConfig(persona, "novelai", model, prepared.report.outputCap, prepared);
      if (getNovelAIProfile(model).endpoint === "/oa/v1/completions") {
        expect(requestConfig.stop).toContain("\nMirri:");
        expect(requestConfig.stop).not.toContain("\nJuno:");
      } else {
        expect(requestConfig.stop_sequences).toEqual(prepared.parameters.stop_sequences);
      }
      const adapter = new NovelaiStreamAdapter();
      for await (const chunk of adapter.startStream(
        {
          model,
          apiKey: "test-key",
          temperature: persona.config.llm_temperature,
          inactivityTimeoutMs: 5_000,
        } as StreamConfig,
        {
          tomoriState: persona,
          contextItems: items,
          currentTurnModelParts: [],
          locale: "en-US",
          holdResponseText: true,
        } as unknown as StreamContext,
      ))
        adapter.processChunk(chunk);
      const { fitting, ...payload } = json;
      const actualRequest = requests.at(-1);
      if (!actualRequest) throw new Error("Generation sent no request");
      expect(payload).toEqual(actualRequest);
      expect(fitting).toEqual(prepared.report);
      expect(text).toStartWith(`${prepared.prompt}\n\n`);
      expect(JSON.parse(text.slice(prepared.prompt.length).trim())).toEqual(prepared.report);
      expect(prepared.report.excluded.some((id) => id.includes(ContextItemTag.SYSTEM_INSTRUCTION_BLOCK))).toBe(true);
      expect(prepared.report.trimmed.some((id) => id.includes(ContextItemTag.KNOWLEDGE_SERVER_MEMORIES))).toBe(true);
      expect(prepared.report.included.some((id) => id.includes(ContextItemTag.SYSTEM_PERSONALITY))).toBe(true);
      const profile = getNovelAIProfile(model);
      expect(prepared.report.inputTokens).toBe(
        createNovelAITokenizerEncoder(profile.tokenizer)(prepared.prompt).length,
      );
      expect(
        prepared.report.inputTokens +
          prepared.report.outputCap +
          prepared.report.framingReserve +
          prepared.report.sentenceReserve,
      ).toBeLessThanOrEqual(prepared.report.window);
      expect(prepared.report.outputCap).toBe(96);
    }
    expect(requests).toHaveLength(4);
  });

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
        parts: [{ type: "text" as const, text: `Mirri: ${" river".repeat(800)}` }],
      },
      {
        role: "model" as const,
        metadataTag: ContextItemTag.DIALOGUE_HISTORY,
        parts: [{ type: "text" as const, text: `Juno: ${" forest".repeat(800)}` }],
      },
    ]).flat();
    for (const item of items)
      item.completionText = item.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
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
      spyOn(contextBuilder, "buildContext").mockImplementation(async (params) => {
        const contextItems = [...items];
        await appendDialogueHistoryContext({
          contextItems,
          client: params.client,
          guildId: params.guildId,
          simplifiedMessageHistory: params.simplifiedMessageHistory,
          botName: params.tomoriNickname,
          tomoriConfig: params.tomoriConfig,
          tomoriState: params.snapshot?.tomoriState ?? null,
          documentHintTemplate: DOCUMENT_HINT_TEMPLATE,
          includeTimestamps: false,
          isUserImpersonation: false,
          triggererFormattedName: "Mirri",
          messageIdMap: new MessageIdMap(),
          uncensorInputOptions: { unicodeSpacesEnabled: false, sanitizeEnabled: false },
          convertMentions: async (text) => text,
        });
        return {
          contextItems,
          tailDirectives: [],
          lowerPriorityTailDirectives: [],
          messageIdMap: new MessageIdMap(),
        };
      }),
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
      config: {
        api_key: Buffer.from("encrypted-server-key"),
        deliberate_tool_mode: false,
        response_prefill: "opening-fragment",
      },
    });
    const personal = { ...server, config: { ...server.config, api_key: Buffer.from("encrypted-personal-key") } };
    const userData = createUserRow({ user_id: 4, user_disc_id: "user-1" });
    const user = { id: "user-1", bot: false, username: "Mirri", displayName: "Mirri" };
    const message = {
      id: "message-1",
      author: user,
      content: "",
      attachments: new Map(),
      stickers: new Map(),
      embeds: [
        buildConditioningInteractionEmbed({
          locale: "en-US",
          type: "reward",
          actionKey: "hug",
          actorLabel: "Bau",
          targetName: "Juno",
          reasonText: "being kind",
          footerKey: null,
        }).toJSON(),
      ],
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
      expect(snapshot?.budget?.contextLength).toBe(source === "personal" ? 4096 : 8192);
      if (!snapshot) throw new Error("Inspection returned no snapshot");
      snapshots.push(snapshot);
      expect(snapshot.novelaiRequest?.prompt).toEndWith("Juno: opening-fragment");
      expect(snapshot.novelaiRequest?.prompt).toContain("_Bau");
      expect(snapshot.novelaiRequest?.prompt).not.toContain("System:");
      const textSnapshot = buildTextSnapshot(snapshot.contextItems, snapshot.novelaiRequest);
      const jsonSnapshot = await buildJsonSnapshot(
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
        snapshot.novelaiRequest,
      );
      expect(jsonSnapshot.input).toBe(snapshot.novelaiRequest?.prompt);
      expect(jsonSnapshot.parameters).toMatchObject({ max_length: snapshot.novelaiRequest?.report.outputCap });
      expect(textSnapshot).toStartWith(snapshot.novelaiRequest?.prompt ?? "");
      const exports = JSON.stringify([textSnapshot, jsonSnapshot]);
      for (const key of ["server-key", "personal-key"]) {
        expect(exports).not.toContain(key);
        expect(exports).not.toContain(createHash("sha256").update(key).digest("hex"));
      }
    }
    expect(snapshots[1].novelaiRequest?.report.trimmed.length).toBeGreaterThan(
      snapshots[0].novelaiRequest?.report.trimmed.length ?? 0,
    );
    expect(seenKeys).toEqual(["server-key", "personal-key"]);
    expect(rotated).not.toHaveBeenCalled();
  });
});
