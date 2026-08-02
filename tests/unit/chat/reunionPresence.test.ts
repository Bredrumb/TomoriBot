import { describe, expect, it, spyOn } from "bun:test";
import type { TomoriState } from "@/types/db/schema";
import type { ChatTurn, GenerationTurnResult } from "@/utils/chat/types";
import { recordReunionPresence, ReunionClaimRegistry, resolveReunionNote } from "@/utils/chat/reunionPresence";
import { statRepository } from "@/utils/db/repositories";

const completedResult: GenerationTurnResult = {
  status: "completed",
  streamResults: [],
  personaResponses: [{ text: "Welcome back!", personaName: "Tomori" }],
};

const emptyResult: GenerationTurnResult = {
  status: "empty_response",
  streamResults: [],
  personaResponses: [],
};

function makeResolveArgs(userId: number) {
  return {
    turn: {
      userRow: { user_id: userId, timezone_offset: 0 },
      triggererName: "Alice",
    } as ChatTurn,
    effectivePersona: {
      server_id: 5,
      persona_lineage_id: 10,
      config: { time_awareness_enabled: true, timezone_offset: 0 },
    } as TomoriState,
    isUserImpersonation: false,
  };
}

describe("ReunionClaimRegistry", () => {
  it("allows only one active claim for a persona lineage and user", () => {
    const registry = new ReunionClaimRegistry();
    const first = registry.tryClaim(10, 20);
    const otherUser = registry.tryClaim(10, 21);
    const otherLineage = registry.tryClaim(11, 20);

    expect(first).not.toBeNull();
    expect(registry.tryClaim(10, 20)).toBeNull();
    expect(otherUser).not.toBeNull();
    expect(otherLineage).not.toBeNull();

    if (first) registry.release(first);
    if (otherUser) registry.release(otherUser);
    if (otherLineage) registry.release(otherLineage);
  });

  it("makes the reunion claimable again after release", () => {
    const registry = new ReunionClaimRegistry();
    const first = registry.tryClaim(10, 20);
    if (!first) throw new Error("Expected the first reunion claim to succeed");

    expect(registry.owns(first)).toBe(true);
    registry.release(first);
    expect(registry.owns(first)).toBe(false);
    const next = registry.tryClaim(10, 20);
    expect(next).not.toBeNull();
    if (next) registry.release(next);
  });

  it("suppresses a concurrent channel until one successful delivery consumes the reunion", async () => {
    let seenToday = false;
    const read = spyOn(statRepository, "getUserPersonaReunionInfo").mockImplementation(async () => ({
      lastPreviousDayAt: new Date("2026-07-01T00:00:00Z"),
      seenToday,
    }));
    const write = spyOn(statRepository, "recordPresenceSeen").mockImplementation(async () => {
      seenToday = true;
      return true;
    });

    try {
      const first = await resolveReunionNote(makeResolveArgs(30));
      const concurrent = await resolveReunionNote(makeResolveArgs(30));

      expect(first.note).toContain("Alice is talking to you again");
      expect(first.presence?.mode).toBe("claimed");
      expect(concurrent.note).toBeNull();
      expect(concurrent.presence?.mode).toBe("deferred");

      await recordReunionPresence(concurrent.presence, completedResult);
      expect(write).not.toHaveBeenCalled();

      await recordReunionPresence(first.presence, completedResult);
      expect(write).toHaveBeenCalledTimes(1);

      const afterDelivery = await resolveReunionNote(makeResolveArgs(30));
      expect(afterDelivery.note).toBeNull();
      expect(afterDelivery.presence?.mode).toBe("record");
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });

  it("claims before the database read so a concurrent context cannot use a stale snapshot", async () => {
    let finishRead: ((value: { lastPreviousDayAt: Date; seenToday: boolean }) => void) | undefined;
    const read = spyOn(statRepository, "getUserPersonaReunionInfo").mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );

    try {
      const firstPromise = resolveReunionNote(makeResolveArgs(32));
      const concurrent = await resolveReunionNote(makeResolveArgs(32));

      expect(concurrent.note).toBeNull();
      expect(concurrent.presence?.mode).toBe("deferred");
      expect(read).toHaveBeenCalledTimes(1);

      finishRead?.({ lastPreviousDayAt: new Date("2026-07-01T00:00:00Z"), seenToday: false });
      const first = await firstPromise;
      expect(first.presence?.mode).toBe("claimed");
      await recordReunionPresence(first.presence, emptyResult);
    } finally {
      read.mockRestore();
    }
  });

  it("releases a failed claim without letting a suppressed turn consume it", async () => {
    const read = spyOn(statRepository, "getUserPersonaReunionInfo").mockResolvedValue({
      lastPreviousDayAt: new Date("2026-07-01T00:00:00Z"),
      seenToday: false,
    });
    const write = spyOn(statRepository, "recordPresenceSeen").mockResolvedValue(true);

    try {
      const first = await resolveReunionNote(makeResolveArgs(31));
      const concurrent = await resolveReunionNote(makeResolveArgs(31));

      await recordReunionPresence(concurrent.presence, completedResult);
      await recordReunionPresence(first.presence, emptyResult);
      expect(write).not.toHaveBeenCalled();

      const retry = await resolveReunionNote(makeResolveArgs(31));
      expect(retry.note).toContain("Alice is talking to you again");
      expect(retry.presence?.mode).toBe("claimed");
      await recordReunionPresence(retry.presence, emptyResult);
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });
});
