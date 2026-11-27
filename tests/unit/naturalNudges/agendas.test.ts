import { describe, expect, it, spyOn } from "bun:test";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import { loadLatestPersonaAgenda } from "@/modules/natural-nudges/runtime/agendas";

describe("latest persona agenda", () => {
  it("keeps only the newest opener's agenda by snowflake order rather than string order", async () => {
    const agendas = new Map([
      ["1300000000000000002", "Older goal"],
      ["999999999999999999", "Oldest goal"],
      ["1300000000000000010", "Newest goal"],
    ]);
    const load = spyOn(naturalNudgeRepository, "loadAgendas").mockResolvedValue(agendas);
    try {
      expect(await loadLatestPersonaAgenda(5, [...agendas.keys()])).toEqual({
        messageId: "1300000000000000010",
        agenda: "Newest goal",
      });
    } finally {
      load.mockRestore();
    }
  });
});
