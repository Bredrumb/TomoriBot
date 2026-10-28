import { describe, expect, it, spyOn } from "bun:test";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import {
  LOREBOOK_DEFAULT_INSERTION_ORDER,
  LOREBOOK_DEFAULT_SCAN_DEPTH,
  LOREBOOK_PLACEMENT,
  LOREBOOK_SELECTIVE_LOGIC,
  type LorebookEntryRow,
} from "@/modules/lorebooks/db/types";
import { lorebookOperations } from "@/modules/lorebooks/discord/operations";

function makeRow(overrides: Partial<LorebookEntryRow> = {}): LorebookEntryRow {
  return {
    entry_id: 42,
    server_id: 1,
    persona_lineage_id: 1770,
    title: "Hollow Manor",
    content: "The manor overlooks the sea.",
    keys: ["manor", "estate"],
    secondary_keys: ["storm"],
    selective_logic: LOREBOOK_SELECTIVE_LOGIC.NOT_ALL,
    scan_depth: 8,
    trigger_chance: 75,
    insertion_order: 12,
    placement: LOREBOOK_PLACEMENT.AFTER,
    constant: false,
    enabled: true,
    channel_disc_ids: ["111111111111111111"],
    legacy_channel_tags: ["old-hall"],
    ...overrides,
  };
}

const freshScope = (entries: LorebookEntryRow[]) => ({ status: "fresh" as const, entries });

describe("lorebook write operations", () => {
  it("refuses every write without manage permission", async () => {
    const insertSpy = spyOn(lorebookRepository, "insert").mockResolvedValue(1);
    const updateSpy = spyOn(lorebookRepository, "update").mockResolvedValue("updated");
    const flagsSpy = spyOn(lorebookRepository, "setFlags").mockResolvedValue("updated");
    const deleteSpy = spyOn(lorebookRepository, "delete").mockResolvedValue("deleted");
    try {
      const scope = { serverId: 1, lineageId: 1770, canManage: false };
      expect(
        (
          await lorebookOperations.add({
            ...scope,
            title: "Title",
            content: "Content",
            keys: ["key"],
            placement: 0,
            channelDiscIds: [],
          })
        ).status,
      ).toBe("forbidden");
      expect(
        (
          await lorebookOperations.editEntry({
            ...scope,
            entryId: 42,
            title: "Title",
            content: "Content",
            keys: ["key"],
            placement: 0,
            channelDiscIds: [],
          })
        ).status,
      ).toBe("forbidden");
      expect(
        (
          await lorebookOperations.editActivation({
            ...scope,
            entryId: 42,
            secondaryKeys: [],
            selectiveLogic: 0,
            scanDepth: 5,
            triggerChance: 100,
            insertionOrder: 100,
          })
        ).status,
      ).toBe("forbidden");
      expect((await lorebookOperations.setFlags({ ...scope, entryId: 42, flags: { enabled: false } })).status).toBe(
        "forbidden",
      );
      expect((await lorebookOperations.remove({ ...scope, entryId: 42 })).status).toBe("forbidden");
      expect(insertSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(flagsSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
    } finally {
      insertSpy.mockRestore();
      updateSpy.mockRestore();
      flagsSpy.mockRestore();
      deleteSpy.mockRestore();
    }
  });

  it("validates an added entry before writing and applies the documented defaults", async () => {
    const insertSpy = spyOn(lorebookRepository, "insert").mockResolvedValue(7);
    try {
      const scope = { serverId: 1, lineageId: null, canManage: true };
      expect(
        (
          await lorebookOperations.add({
            ...scope,
            title: "   ",
            content: "Content",
            keys: ["key"],
            placement: 0,
            channelDiscIds: [],
          })
        ).status,
      ).toBe("title-required");
      expect(
        (
          await lorebookOperations.add({
            ...scope,
            title: "Title",
            content: "   ",
            keys: ["key"],
            placement: 0,
            channelDiscIds: [],
          })
        ).status,
      ).toBe("content-required");
      expect(
        (
          await lorebookOperations.add({
            ...scope,
            title: "Title",
            content: "Content",
            keys: [],
            placement: 0,
            channelDiscIds: [],
          })
        ).status,
      ).toBe("keys-required");
      expect(insertSpy).not.toHaveBeenCalled();

      const result = await lorebookOperations.add({
        ...scope,
        title: "  New Entry  ",
        content: "Body",
        keys: ["key"],
        placement: 1,
        channelDiscIds: ["111111111111111111"],
      });
      expect(result).toEqual({ status: "success", entryId: 7, title: "New Entry" });
      expect(insertSpy).toHaveBeenCalledWith(1, null, {
        title: "New Entry",
        content: "Body",
        keys: ["key"],
        secondary_keys: [],
        selective_logic: LOREBOOK_SELECTIVE_LOGIC.AND_ANY,
        scan_depth: LOREBOOK_DEFAULT_SCAN_DEPTH,
        trigger_chance: 100,
        insertion_order: LOREBOOK_DEFAULT_INSERTION_ORDER,
        placement: 1,
        constant: false,
        enabled: true,
        channel_disc_ids: ["111111111111111111"],
      });
    } finally {
      insertSpy.mockRestore();
    }
  });

  it("maps insert limit, invalid, and failure results", async () => {
    const insertSpy = spyOn(lorebookRepository, "insert");
    try {
      insertSpy.mockResolvedValueOnce("limit").mockResolvedValueOnce("invalid").mockResolvedValueOnce("failed");
      const input = {
        serverId: 1,
        lineageId: 1770,
        canManage: true,
        title: "Title",
        content: "Content",
        keys: ["key"],
        placement: 0 as const,
        channelDiscIds: [],
      };
      expect((await lorebookOperations.add(input)).status).toBe("limit");
      expect((await lorebookOperations.add(input)).status).toBe("invalid");
      expect((await lorebookOperations.add(input)).status).toBe("failed");
    } finally {
      insertSpy.mockRestore();
    }
  });

  it("keeps activation, flags, and pending channel names when an edit leaves the channel set unchanged", async () => {
    const listSpy = spyOn(lorebookRepository, "listScope").mockResolvedValue(freshScope([makeRow()]));
    const updateSpy = spyOn(lorebookRepository, "update").mockResolvedValue("updated");
    try {
      const result = await lorebookOperations.editEntry({
        serverId: 1,
        lineageId: 1770,
        canManage: true,
        entryId: 42,
        title: "Renamed Manor",
        content: "New body",
        keys: ["renamed"],
        placement: 0,
        channelDiscIds: ["111111111111111111"],
      });
      expect(result).toEqual({ status: "success", title: "Renamed Manor" });
      expect(listSpy).toHaveBeenCalledWith(1, 1770);
      expect(updateSpy).toHaveBeenCalledWith(
        1,
        1770,
        42,
        expect.objectContaining({
          title: "Renamed Manor",
          content: "New body",
          keys: ["renamed"],
          placement: 0,
          secondary_keys: ["storm"],
          selective_logic: LOREBOOK_SELECTIVE_LOGIC.NOT_ALL,
          scan_depth: 8,
          trigger_chance: 75,
          insertion_order: 12,
          constant: false,
          enabled: true,
          channel_disc_ids: ["111111111111111111"],
          legacy_channel_tags: ["old-hall"],
        }),
      );
    } finally {
      listSpy.mockRestore();
      updateSpy.mockRestore();
    }
  });

  it("clears pending channel names when the member submits a different channel set, including an empty one", async () => {
    const listSpy = spyOn(lorebookRepository, "listScope").mockResolvedValue(freshScope([makeRow()]));
    const updateSpy = spyOn(lorebookRepository, "update").mockResolvedValue("updated");
    try {
      await lorebookOperations.editEntry({
        serverId: 1,
        lineageId: 1770,
        canManage: true,
        entryId: 42,
        title: "Hollow Manor",
        content: "The manor overlooks the sea.",
        keys: ["manor", "estate"],
        placement: LOREBOOK_PLACEMENT.AFTER,
        channelDiscIds: [],
      });
      expect(updateSpy).toHaveBeenCalledWith(
        1,
        1770,
        42,
        expect.objectContaining({ channel_disc_ids: [], legacy_channel_tags: [] }),
      );
    } finally {
      listSpy.mockRestore();
      updateSpy.mockRestore();
    }
  });

  it("refuses to strip the last key from a keyword entry and reports stale ids", async () => {
    const listSpy = spyOn(lorebookRepository, "listScope");
    const updateSpy = spyOn(lorebookRepository, "update").mockResolvedValue("updated");
    try {
      listSpy.mockResolvedValue(freshScope([makeRow()]));
      expect(
        (
          await lorebookOperations.editEntry({
            serverId: 1,
            lineageId: 1770,
            canManage: true,
            entryId: 42,
            title: "Hollow Manor",
            content: "Body",
            keys: [],
            placement: 0,
            channelDiscIds: [],
          })
        ).status,
      ).toBe("keys-required");
      expect(updateSpy).not.toHaveBeenCalled();

      listSpy.mockResolvedValue(freshScope([]));
      expect(
        (
          await lorebookOperations.editEntry({
            serverId: 1,
            lineageId: 1770,
            canManage: true,
            entryId: 42,
            title: "Hollow Manor",
            content: "Body",
            keys: ["manor"],
            placement: 0,
            channelDiscIds: [],
          })
        ).status,
      ).toBe("missing");
    } finally {
      listSpy.mockRestore();
      updateSpy.mockRestore();
    }
  });

  it("updates activation while preserving content, keywords, placement, channels, and pending names", async () => {
    const listSpy = spyOn(lorebookRepository, "listScope").mockResolvedValue(freshScope([makeRow()]));
    const updateSpy = spyOn(lorebookRepository, "update").mockResolvedValue("updated");
    try {
      const result = await lorebookOperations.editActivation({
        serverId: 1,
        lineageId: 1770,
        canManage: true,
        entryId: 42,
        secondaryKeys: ["fog"],
        selectiveLogic: LOREBOOK_SELECTIVE_LOGIC.AND_ALL,
        scanDepth: 12,
        triggerChance: 40,
        insertionOrder: -5,
      });
      expect(result).toEqual({ status: "success", title: "Hollow Manor" });
      expect(updateSpy).toHaveBeenCalledWith(
        1,
        1770,
        42,
        expect.objectContaining({
          content: "The manor overlooks the sea.",
          keys: ["manor", "estate"],
          placement: LOREBOOK_PLACEMENT.AFTER,
          secondary_keys: ["fog"],
          selective_logic: LOREBOOK_SELECTIVE_LOGIC.AND_ALL,
          scan_depth: 12,
          trigger_chance: 40,
          insertion_order: -5,
          channel_disc_ids: ["111111111111111111"],
          legacy_channel_tags: ["old-hall"],
        }),
      );
    } finally {
      listSpy.mockRestore();
      updateSpy.mockRestore();
    }
  });

  it("maps flag and delete results without inventing a title", async () => {
    const flagsSpy = spyOn(lorebookRepository, "setFlags");
    const listSpy = spyOn(lorebookRepository, "listScope").mockResolvedValue(freshScope([makeRow()]));
    const deleteSpy = spyOn(lorebookRepository, "delete");
    try {
      flagsSpy.mockResolvedValueOnce("updated").mockResolvedValueOnce("missing");
      expect(
        (
          await lorebookOperations.setFlags({
            serverId: 1,
            lineageId: 1770,
            canManage: true,
            entryId: 42,
            flags: { enabled: false },
          })
        ).status,
      ).toBe("success");
      expect(
        (
          await lorebookOperations.setFlags({
            serverId: 1,
            lineageId: 1770,
            canManage: true,
            entryId: 42,
            flags: { constant: true },
          })
        ).status,
      ).toBe("missing");

      deleteSpy.mockResolvedValueOnce("deleted").mockResolvedValueOnce("failed");
      expect(await lorebookOperations.remove({ serverId: 1, lineageId: 1770, canManage: true, entryId: 42 })).toEqual({
        status: "success",
        title: "Hollow Manor",
      });
      expect(
        (await lorebookOperations.remove({ serverId: 1, lineageId: 1770, canManage: true, entryId: 42 })).status,
      ).toBe("failed");
    } finally {
      flagsSpy.mockRestore();
      listSpy.mockRestore();
      deleteSpy.mockRestore();
    }
  });
});
