import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { QuotaReservation } from "@/utils/db/repositories/QuotaRepository";
import type { TextQuotaClaim } from "@/utils/quota/textQuotaManager";
import type { TextQuotaTriggerState } from "@/utils/chat/textQuotaState";
import * as embedHelper from "@/utils/discord/embedHelper";
import * as textDisplayModal from "@/utils/discord/textDisplayModal";
import { registerProviderOption } from "@/utils/provider/providerOptionRegistry";
import { QuotaUnavailableError } from "@/utils/quota/quotaErrors";
import * as realTextQuotaManager from "@/utils/quota/textQuotaManager";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";
import { createScopedModuleMocker } from "../../helpers/mockSurface";

const RESERVATION: QuotaReservation = {
  quotaDate: "2026-10-28",
  userCounted: true,
  serverwidePeriodStart: null,
};

const reserveCalls: Array<{ serverId: number; userDiscId: string }> = [];
let reserveResult: TextQuotaClaim = { allowed: true, reservation: RESERVATION };
let reserveError: Error | null = null;

const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/quota/textQuotaManager": realTextQuotaManager,
});

scopedMock.module("@/utils/quota/textQuotaManager", () => ({
  ...realTextQuotaManager,
  reserveTextQuota: async (serverId: number, userDiscId: string) => {
    reserveCalls.push({ serverId, userDiscId });
    if (reserveError) throw reserveError;
    return reserveResult;
  },
  releaseTextQuota: async () => {},
}));

let checkTextQuotaForAdmission: typeof import("@/utils/chat/admissionGuards").checkTextQuotaForAdmission;
let textQuotaTriggerStates: Map<string, TextQuotaTriggerState>;
let restoreSendEmbed: () => void = () => {};
const embeds: unknown[] = [];

beforeAll(async () => {
  await initializeLocalizer();
  ({ checkTextQuotaForAdmission } = await import("@/utils/chat/admissionGuards"));
  ({ textQuotaTriggerStates } = await import("@/utils/chat/textQuotaState"));
});

beforeEach(() => {
  reserveCalls.length = 0;
  embeds.length = 0;
  reserveError = null;
  reserveResult = { allowed: true, reservation: RESERVATION };
  textQuotaTriggerStates.clear();
  const sendSpy = spyOn(embedHelper, "sendStandardEmbed").mockImplementation(async (_channel, _locale, options) => {
    embeds.push(options);
  });
  restoreSendEmbed = () => sendSpy.mockRestore();
});

afterEach(() => mock.restore());

function admissionParams(overrides: Partial<Parameters<typeof checkTextQuotaForAdmission>[0]> = {}) {
  return {
    shouldApplyTextQuota: true,
    isPersonaJob: false,
    triggerKey: `trigger_${Math.random().toString(36).slice(2)}`,
    serverId: 7,
    userDiscId: "user_1",
    channel: { id: "channel_1" } as unknown as Parameters<typeof checkTextQuotaForAdmission>[0]["channel"],
    locale: "en-US",
    notifyUser: true,
    ...overrides,
  };
}

describe("text quota admission", () => {
  it("holds the reserved unit on the trigger state", async () => {
    const params = admissionParams();

    const result = await checkTextQuotaForAdmission(params);

    expect(result.allowed).toBe(true);
    expect(result.state?.reservation).toEqual(RESERVATION);
    expect(textQuotaTriggerStates.get(params.triggerKey)?.reservation).toEqual(RESERVATION);
    expect(reserveCalls).toEqual([{ serverId: 7, userDiscId: "user_1" }]);
  });

  it("refuses the turn with quota-unavailable copy when the counters cannot be read", async () => {
    reserveError = new QuotaUnavailableError();

    const result = await checkTextQuotaForAdmission(admissionParams());

    expect(result).toEqual({ allowed: false, state: null });
    expect(embeds).toContainEqual(
      expect.objectContaining({
        titleKey: "genai.text_quota_unavailable_title",
        descriptionKey: "genai.text_quota_unavailable_description",
      }),
    );
  });

  it("claims a new unit for a turn whose earlier reservation was released", async () => {
    const params = admissionParams();
    await checkTextQuotaForAdmission(params);
    const releasedState = textQuotaTriggerStates.get(params.triggerKey);
    if (!releasedState) throw new Error("Missing quota state");
    releasedState.reservation = null;
    releasedState.reservationReleased = true;
    textQuotaTriggerStates.set(params.triggerKey, releasedState);

    const result = await checkTextQuotaForAdmission(params);

    expect(result.allowed).toBe(true);
    expect(result.state?.reservation).toEqual(RESERVATION);
    expect(reserveCalls).toHaveLength(2);
  });

  it("reuses a persona job's group admission without claiming another unit", async () => {
    const params = admissionParams();
    await checkTextQuotaForAdmission(params);
    reserveCalls.length = 0;

    const result = await checkTextQuotaForAdmission({ ...params, isPersonaJob: true });

    expect(result.allowed).toBe(true);
    expect(result.state?.reservation).toEqual(RESERVATION);
    expect(reserveCalls).toEqual([]);
  });

  it("allows a persona job with no group admission and claims nothing", async () => {
    const result = await checkTextQuotaForAdmission(admissionParams({ isPersonaJob: true }));

    expect(result).toEqual({ allowed: true, state: null });
    expect(reserveCalls).toEqual([]);
  });

  it("does not claim another unit for a trigger that already consumed one", async () => {
    const params = admissionParams();
    const first = await checkTextQuotaForAdmission(params);
    if (!first.state) throw new Error("Missing quota state");
    first.state.consumed = true;
    first.state.reservation = null;
    reserveCalls.length = 0;

    const result = await checkTextQuotaForAdmission(params);

    expect(result.allowed).toBe(true);
    expect(reserveCalls).toEqual([]);
  });

  it("attaches the personal-providers tip key on text quota refusals", async () => {
    const resetTime = new Date(Date.now() + 60_000);
    for (const reason of ["user_quota_exceeded", "serverwide_quota_exceeded"] as const) {
      embeds.length = 0;
      reserveResult = { allowed: false, reason, userRemaining: 0, resetTime, reservation: null };

      const result = await checkTextQuotaForAdmission(admissionParams());

      expect(result).toEqual({ allowed: false, state: null });
      expect(embeds).toContainEqual(
        expect.objectContaining({
          titleKey: "genai.text_quota_exceeded_title",
          tipKeys: ["genai.tips.use_personal_providers"],
        }),
      );
    }
  });

  it("renders a What You Can Do button pointing to /personal providers after registered option copy", async () => {
    restoreSendEmbed();
    const sentPayloads: Array<{ components?: Array<{ toJSON(): { components?: Array<{ label?: string }> } }> }> = [];
    let renderedModal: { title: string; content: string } | undefined;
    spyOn(textDisplayModal, "attachTextDisplayModalCollector").mockImplementation((options) => {
      renderedModal = options.render("en-US");
    });
    const dispose = registerProviderOption({
      value: "quota-copy-option",
      catalogProvider: "openrouter",
      capabilities: ["text"],
      copy: {
        labelKey: "general.errors.api_key_missing_title",
        entryDescriptionKeys: {
          server: "general.errors.api_key_missing_description",
          personal: "general.errors.api_key_missing_description",
        },
        addActionLabelKey: "general.errors.api_key_missing_title",
        addActionDescriptionKeys: {
          server: "general.errors.api_key_missing_description",
          personal: "general.errors.api_key_missing_description",
        },
        removeImpactKey: "general.errors.api_key_missing_description",
      },
      contributeCopy: async () => "genai.tips.wait_and_retry",
      availability: () => ({ eligible: true }),
      selection: {
        load: async () => null,
        ensure: async () => true,
        claim: async () => true,
        remove: async () => "removed",
        owns: () => false,
        resolveCredentials: async () => null,
      },
    });
    reserveResult = {
      allowed: false,
      reason: "user_quota_exceeded",
      userRemaining: 0,
      resetTime: new Date(Date.now() + 60_000),
      reservation: null,
    };
    const channel = {
      id: "channel_1",
      send: async (payload: unknown) => {
        sentPayloads.push(payload as (typeof sentPayloads)[number]);
        return { id: "sent_message" };
      },
    } as unknown as Parameters<typeof checkTextQuotaForAdmission>[0]["channel"];

    try {
      await checkTextQuotaForAdmission(admissionParams({ channel }));
    } finally {
      dispose();
    }

    expect(sentPayloads[0]?.components?.[0]?.toJSON().components?.[0]?.label).toBe(
      localizedCopy("en-US", "genai.tips.button"),
    );
    expect(renderedModal?.title).toBe(localizedCopy("en-US", "genai.tips.title"));
    const lines = renderedModal?.content.split("\n") ?? [];
    expect(lines[0]).toContain(localizedCopy("en-US", "genai.tips.wait_and_retry"));
    expect(lines[1]).toContain(localizedCopy("en-US", "genai.tips.use_personal_providers"));
    expect(lines[1]).toContain("/personal providers");
    expect(lines.at(-1)).toContain(localizedCopy("en-US", "genai.tips.support_server"));
  });
});
