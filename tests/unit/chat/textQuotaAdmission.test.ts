import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { QuotaReservation } from "@/utils/db/repositories/QuotaRepository";
import type { TextQuotaClaim } from "@/utils/quota/textQuotaManager";
import type { TextQuotaTriggerState } from "@/utils/chat/textQuotaState";
import * as embedHelper from "@/utils/discord/embedHelper";
import { QuotaUnavailableError } from "@/utils/quota/quotaErrors";
import * as realTextQuotaManager from "@/utils/quota/textQuotaManager";
import { initializeLocalizer } from "@/utils/text/localizer";
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
  spyOn(embedHelper, "sendStandardEmbed").mockImplementation(async (_channel, _locale, options) => {
    embeds.push(options);
  });
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
});
