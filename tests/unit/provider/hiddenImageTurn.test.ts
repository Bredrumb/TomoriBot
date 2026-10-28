import { MessageIdMap } from "@/utils/text/messageIdMap";
import { beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { Client } from "discord.js";
import { runHiddenImageTurn, type HiddenImageTurnParams } from "@/utils/provider/hiddenImageTurn";
import * as credentials from "@/utils/provider/credentialResolver";
import * as factory from "@/utils/provider/providerFactory";
import * as context from "@/utils/text/contextBuilder";
import * as participants from "@/utils/text/participants/preparation";
import * as prompts from "@/utils/cache/channelPromptCache";
import * as personas from "@/utils/cache/tomoriStateCache";
import { OpenrouterProvider } from "@/providers/openrouter/openrouterProvider";
import { ToolRegistry } from "@/tools/toolRegistry";
import { createLlmRow, createPersona } from "../../helpers/fixtures";
import { userSavedProviderConfigSchema } from "@/types/db/schema";
import { llmModelRepo } from "@/utils/db/repositories";
import { currentProviderUsageContext } from "@/utils/provider/providerUsage";
import { log } from "@/utils/misc/logger";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";
import type { ProviderError } from "@/types/stream/interfaces";

beforeAll(initializeLocalizer);

describe("hidden image planning credentials", () => {
  it("uses the resolved planning model, settings and key and passes its usage owner to image tools", async () => {
    const state = createPersona({
      config: { api_key: null, custom_endpoint_url: "https://stale.invalid" },
      llm: createLlmRow({ llm_provider: "google", has_tools: false }),
    });
    const usageContext = { credentialProvider: "test-option" };
    const model = createLlmRow({
      llm_id: 9,
      llm_provider: "openrouter",
      has_tools: true,
      llm_codename: "fixture/selected-planner",
    });
    const provider = new OpenrouterProvider();
    const resolve = spyOn(credentials, "resolveCapabilityCredentials").mockResolvedValue({
      provider: "openrouter",
      apiKey: "synthetic-member",
      keyVersion: 1,
      source: "personal",
      modelId: 9,
      savedConfig: userSavedProviderConfigSchema.parse({
        user_id: 1,
        provider: "test-option",
        api_key: null,
        llm_id: 9,
        llm_temperature: 0.42,
        diffusion_model_id: null,
        embedding_model_id: null,
        nai_diffusion_model_id: null,
        nai_preset_name: null,
      }),
      usageContext: usageContext,
    });
    const config = spyOn(provider, "createConfig").mockImplementation(async (resolved, apiKey) => {
      expect(resolved.llm).toBe(model);
      expect(resolved.config.llm_temperature).toBe(0.42);
      expect(resolved.config.custom_endpoint_url).toBeNull();
      return { apiKey, model: resolved.llm.llm_codename, temperature: resolved.config.llm_temperature };
    });
    const stream = spyOn(provider, "streamToDiscord").mockImplementation(async () => {
      expect(currentProviderUsageContext()).toBe(usageContext);
      return {
        status: "function_call",
        data: { name: "generate_image", args: {} },
      };
    });
    const execute = spyOn(ToolRegistry, "executeTool").mockResolvedValue({ success: true, endTurn: true });
    const spies: Array<{ mockRestore(): void }> = [
      resolve,
      config,
      stream,
      execute,
      spyOn(llmModelRepo, "loadById").mockResolvedValue(model),
      spyOn(factory, "getProviderForTomori").mockResolvedValue(provider),
      spyOn(prompts, "getCachedChannelPrompt").mockResolvedValue(null),
      spyOn(personas, "getCachedAllPersonas").mockResolvedValue([state]),
      spyOn(context, "buildContext").mockResolvedValue({
        contextItems: [],
        tailDirectives: [],
        lowerPriorityTailDirectives: [],
        messageIdMap: new MessageIdMap(),
      }),
      spyOn(participants, "prepareParticipantContext").mockResolvedValue({
        discoveryPlan: {
          seeds: [],
          evidence: [],
          rejections: [],
          aliasReferenceDiagnostics: {
            evaluatedAliasCount: 0,
            acceptedAliasCount: 0,
            ambiguousAliasCount: 0,
            unmatchedAliasCount: 0,
          },
        },
        matrixUsers: new Map(),
        syntheticUsers: new Map(),
        messageProxyUsers: new Map(),
        publicPersonaProfiles: [],
        referencedUserRows: new Map(),
        referencedUserIds: new Set(),
        diagnostics: {
          discoveryCacheHit: false,
          discoveryDurationMs: 0,
          candidateCount: 0,
          includedCount: 0,
          rejectionCounts: {
            ineligible_state: 0,
            bot: 0,
            non_member: 0,
            ambiguous_alias: 0,
            existing_participant: 0,
            blocked_source: 0,
            missing_guild: 0,
          },
          externalCalls: {
            candidateSourceReads: 0,
            memberCacheHits: 0,
            memberFetches: 0,
            messageProxyIdentityReads: 0,
          },
          sourceContributions: [],
        },
      }),
    ];
    try {
      const params: HiddenImageTurnParams = {
        channel: {
          id: "synthetic-channel",
          messages: { fetch: async () => new Map() },
        } as unknown as HiddenImageTurnParams["channel"],
        client: {} as Client,
        guild: null,
        tomoriState: state,
        locale: "en-US",
        interactingUserId: "synthetic-user",
        internalUserId: 1,
        backend: "current_provider",
        presetLabel: "Portrait",
        presetInstruction: "Portrait",
        aspectRatio: "1:1",
        naiOrientation: "square",
      };
      const result = await runHiddenImageTurn(params);
      expect(result.success).toBe(true);
      expect(resolve).toHaveBeenCalledWith(state.server_id, "text", { userId: 1, textModel: state.llm });
      expect(config.mock.calls[0]?.[1]).toBe("synthetic-member");
      expect(execute.mock.calls[0]?.[2]?.usageContext).toBe(usageContext);
      expect(stream.mock.calls[0]?.[10]?.textCredentialSource).toBe("personal");
      expect(stream.mock.calls[0]?.[10]?.suppressUserErrors).toBe(true);

      const errors = spyOn(log, "error").mockResolvedValue(undefined);
      const warnings = spyOn(log, "warn").mockImplementation(() => {});
      const metrics = spyOn(log, "metric").mockImplementation(() => {});
      spies.push(errors, warnings, metrics);
      for (const [type, code, expected] of [
        ["content_blocked", "PROHIBITED_CONTENT", true],
        ["api_error", "401", true],
        ["api_error", "400", false],
      ] as const) {
        errors.mockClear();
        warnings.mockClear();
        metrics.mockClear();
        execute.mockClear();
        const error: ProviderError = {
          type,
          code,
          retryable: false,
          message: "UPSTREAM_BODY synthetic-member",
          originalError: { providerResponse: "UPSTREAM_DETAIL synthetic-member" },
        };
        stream.mockResolvedValue({ status: "error", data: error });
        const failed = await runHiddenImageTurn(params);
        expect(failed.success).toBe(false);
        expect(failed.error).not.toContain("UPSTREAM_BODY");
        expect(failed.error).not.toContain("synthetic-member");
        if (type === "content_blocked")
          expect(failed.error).toBe(localizedCopy("en-US", "genai.tool_failure.content_blocked"));
        expect(execute).not.toHaveBeenCalled();
        expect(errors.mock.calls.length).toBe(expected ? 0 : 1);
        expect(warnings.mock.calls.length).toBe(expected ? 1 : 0);
        const recorded = expected ? warnings.mock.calls[0] : errors.mock.calls[0];
        expect(recorded?.[2]?.metadata).toMatchObject({
          provider: "openrouter",
          code,
          model: model.llm_codename,
          credentialSource: "personal",
        });
        expect(JSON.stringify(recorded)).toContain("UPSTREAM_BODY");
        expect(JSON.stringify(recorded)).toContain("UPSTREAM_DETAIL");
        expect(JSON.stringify(recorded)).not.toContain("synthetic-member");
        if (expected) expect(metrics).toHaveBeenCalledWith("provider_failure", expect.objectContaining({ code }));
      }
      errors.mockClear();
      stream.mockRejectedValue(new Error("UPSTREAM_THROW synthetic-member"));
      expect((await runHiddenImageTurn(params)).error).not.toContain("UPSTREAM_THROW");
      expect(errors.mock.calls[0]?.[1]).toMatchObject({
        message: expect.stringContaining("UPSTREAM_THROW"),
        stack: expect.stringContaining("hiddenImageTurn.test.ts"),
      });
      expect(JSON.stringify(errors.mock.calls)).not.toContain("synthetic-member");
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
