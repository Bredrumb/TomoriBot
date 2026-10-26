import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Client, ModalBuilder, TextChannel } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { ProviderError, StreamContext, StreamProvider } from "@/types/stream/interfaces";
import { StreamErrorUi } from "@/utils/discord/stream/errorUi";
import { ProviderRequestDeniedError } from "@/utils/provider/providerUsage";
import { findProviderOption } from "@/utils/provider/providerOptionRegistry";
import { getSupporterUsageContext } from "@/modules/supporter-billing/runtime/types";
import { createServerFunding, createPersonalFunding } from "./guards/utils-fundingFixtures";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy, collectCaseFailures, RUNTIME_LOCALES } from "../../helpers/localeCases";
import { useEnvSandbox } from "../../helpers/env";
import { supporterIdentityRepository, supporterSponsorshipRepository } from "@/modules/supporter-billing/db";

type SendMock = ReturnType<typeof mock>;

function makeContext(
  send: SendMock,
  textCredentialSource: StreamContext["textCredentialSource"],
  fallbackChain: unknown[] = [],
  inGuild = true,
): StreamContext {
  return {
    channel: { id: "channel_1", send, ...(inGuild ? { guild: { id: "guild_1" } } : {}) } as unknown as TextChannel,
    client: {} as Client,
    tomoriState: {
      server_id: 1,
      llm: { llm_provider: "openrouter" },
      persona_nickname: "Tomori",
      trigger_words: [],
      config: {},
      fallback_chain: fallbackChain,
      fallback_llms: [],
    } as unknown as TomoriState,
    contextItems: [],
    currentTurnModelParts: [],
    provider: "openrouter",
    locale: "en-US",
    textCredentialSource,
  };
}

function makeProvider(name = "openrouter"): StreamProvider {
  return {
    async *startStream() {},
    processChunk() {
      return { type: "text", content: "" };
    },
    handleProviderError(error: unknown) {
      return {
        type: "api_error",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      };
    },
    createErrorDescription() {
      return "The provider rejected this request.";
    },
    getProviderInfo() {
      return { name, version: "test", supportsStreaming: true, supportsFunctionCalling: true };
    },
  } as unknown as StreamProvider;
}

async function renderTips(
  error: unknown,
  textCredentialSource: StreamContext["textCredentialSource"],
  options: {
    providerName?: string;
    fallbackChain?: unknown[];
    userDiscId?: string;
    locale?: string;
    usageContext?: StreamContext["usageContext"];
  } = {},
): Promise<string> {
  let modal: ReturnType<ModalBuilder["toJSON"]> | undefined;
  const tipClick = {
    customId: "error_tip_details",
    user: { bot: false },
    showModal: async (builtModal: ModalBuilder) => {
      modal = builtModal.toJSON();
    },
  };
  const makeCollector = (filter: (interaction: typeof tipClick) => boolean) => {
    const collector = {
      on(event: string, listener: (interaction: unknown) => Promise<void>) {
        if (event === "collect" && filter(tipClick)) void listener(tipClick);
        return collector;
      },
    };
    return collector;
  };
  const send = mock(async (_payload: unknown) => ({
    createMessageComponentCollector: (options: { filter: (interaction: typeof tipClick) => boolean }) =>
      makeCollector(options.filter),
  }));
  await new StreamErrorUi().handleProviderError(error, makeProvider(options.providerName), {
    ...makeContext(send, textCredentialSource, options.fallbackChain ?? []),
    triggererDiscId: options.userDiscId,
    locale: options.locale ?? "en-US",
    usageContext: options.usageContext,
  });
  await Promise.resolve();
  return (
    modal?.components
      ?.map((component) => ("content" in component ? component.content : ""))
      .filter(Boolean)
      .join("") ?? ""
  );
}

const RATE_LIMIT_ERROR: ProviderError = {
  type: "rate_limit",
  message: "HTTP 429: rate limit exceeded",
  code: "429",
  retryable: true,
};

describe("provider error subscription guidance", () => {
  useEnvSandbox(["RUN_ENV", "TOMORI_SUPPORTER_BILLING_ENABLED"]);
  const spies: Array<{ mockRestore(): void }> = [];
  beforeAll(initializeLocalizer);
  beforeEach(() => {
    process.env.RUN_ENV = "production";
    process.env.TOMORI_SUPPORTER_BILLING_ENABLED = "true";
    spies.push(
      spyOn(supporterIdentityRepository, "loadByDiscordUserId").mockResolvedValue(null),
      spyOn(supporterSponsorshipRepository, "loadActiveSponsorshipForServer").mockResolvedValue(null),
    );
  });
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  it("adds localized guidance to BYOK reliability tips while retaining existing recovery actions", async () => {
    const failures = collectCaseFailures();
    for (const locale of RUNTIME_LOCALES) {
      for (const credentialSource of ["personal", "server"] as const) {
        const tips = await renderTips(RATE_LIMIT_ERROR, credentialSource, {
          userDiscId: "123456789012345678",
          locale,
        });
        failures.check(`${locale}/${credentialSource}`, () => {
          expect(tips).toContain(localizedCopy(locale, "commands.subscribe.conversion_nudge"));
          expect(tips).toContain(
            localizedCopy(
              locale,
              credentialSource === "personal" ? "genai.tips.model_fallback_personal" : "genai.tips.model_fallback",
            ),
          );
        });
      }
    }
    failures.expectNoFailures();
  });

  it("adds guidance to BYOK failures beyond capacity and quota errors", async () => {
    const errors: ProviderError[] = [
      { type: "api_error", code: "401", message: "Invalid key", retryable: false },
      { type: "model_error", message: "Unknown model", retryable: false },
      { type: "content_blocked", message: "Blocked", retryable: false },
      { type: "timeout", message: "Timed out", retryable: true },
    ];
    for (const error of errors) {
      const tips = await renderTips(error, "server", { userDiscId: "123456789012345678" });
      expect(tips).toContain(localizedCopy("en-US", "commands.subscribe.conversion_nudge"));
    }
  });

  it("does not promote subscriptions for the same OpenRouter transport when the member key paid", async () => {
    const tips = await renderTips(RATE_LIMIT_ERROR, "supporter", { userDiscId: "123456789012345678" });
    expect(tips).not.toContain(localizedCopy("en-US", "commands.subscribe.conversion_nudge"));
  });

  it("passes the managed provider and its exact credential scope to the registered contribution", async () => {
    const option = findProviderOption("supporter");
    if (!option?.contributeCopy) throw new Error("Missing registered Subscription copy contribution");
    const copy = spyOn(option, "contributeCopy").mockResolvedValue(null);
    try {
      for (const funding of [createServerFunding(), createPersonalFunding()]) {
        const usageContext = getSupporterUsageContext(funding);
        copy.mockClear();
        const tips = await renderTips(RATE_LIMIT_ERROR, "supporter", {
          userDiscId: "123456789012345678",
          usageContext,
        });
        expect(copy.mock.calls[0]?.[0]).toMatchObject({
          surface: "recovery",
          managedProvider: "supporter",
          credentialScope: funding.fundingScope,
        });
        expect(tips).not.toContain(localizedCopy("en-US", "commands.subscribe.conversion_nudge"));
      }
    } finally {
      copy.mockRestore();
    }
  });

  it("keeps billing denials free of conversion copy and eligibility reads", async () => {
    const denied = new ProviderRequestDeniedError(undefined, () => ({
      titleKey: "general.errors.api_key_error_title",
      description: localizedCopy("en-US", "general.errors.personal_provider_required_description"),
    }));
    const tips = await renderTips(denied, "server", { userDiscId: "123456789012345678" });
    expect(tips).not.toContain(localizedCopy("en-US", "commands.subscribe.conversion_nudge"));
    expect(supporterIdentityRepository.loadByDiscordUserId).not.toHaveBeenCalled();
    expect(supporterSponsorshipRepository.loadActiveSponsorshipForServer).not.toHaveBeenCalled();
  });

  it("retains ordinary recovery actions when eligibility storage fails", async () => {
    spyOn(supporterIdentityRepository, "loadByDiscordUserId").mockRejectedValue(new Error("Storage unavailable"));
    const tips = await renderTips(RATE_LIMIT_ERROR, "personal", { userDiscId: "123456789012345678" });
    expect(tips).toContain(localizedCopy("en-US", "genai.tips.model_fallback_personal"));
    expect(tips).not.toContain(localizedCopy("en-US", "commands.subscribe.conversion_nudge"));
  });

  it("keeps subscription guidance and recovery actions in repeated error modals", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const tips = await renderTips(RATE_LIMIT_ERROR, "server", { userDiscId: "123456789012345678" });
      expect(tips).toContain(localizedCopy("en-US", "commands.subscribe.conversion_nudge"));
      expect(tips).toContain(localizedCopy("en-US", "genai.tips.model_fallback"));
    }
  });
});
