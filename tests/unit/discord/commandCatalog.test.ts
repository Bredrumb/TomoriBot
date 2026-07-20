import { describe, expect, it } from "bun:test";
import {
  getCommandCatalogEntries,
  ROOT_COMMAND_EXECUTION_KEY,
  type CommandExecuteFunction,
  type CommandExecutionMap,
} from "@/utils/discord/commandLoader";

/** No-op execute stub — getCommandCatalogEntries only reads the map keys, never calls these. */
const noopExecute: CommandExecuteFunction = async () => {};

describe("getCommandCatalogEntries", () => {
  it("maps root / flat / grouped commands to the space-joined stat_counters.metric_key format", () => {
    // 1. Build an execution map covering all three command shapes the loader produces.
    const executionMap: CommandExecutionMap = new Map([
      // Root command: single sentinel key → path is just the command name.
      ["update", new Map([[ROOT_COMMAND_EXECUTION_KEY, noopExecute]])],
      // Flat subcommand: key is the subcommand name.
      ["config", new Map([["humanizer", noopExecute]])],
      // Grouped subcommand: key is "group.subcommand" (exactly one dot).
      ["server", new Map([["welcome-channel.set", noopExecute]])],
    ]);

    const entries = getCommandCatalogEntries(executionMap);

    // 2. Each shape must match exactly what handleCommands.ts records as metric_key.
    expect(entries).toEqual([
      { commandName: "update", category: "update" },
      { commandName: "config humanizer", category: "config" },
      { commandName: "server welcome-channel set", category: "server" },
    ]);
  });

  it("emits one entry per subcommand and preserves the top-level category", () => {
    const executionMap: CommandExecutionMap = new Map([
      [
        "memory",
        new Map([
          ["personal.add", noopExecute],
          ["personal.remove", noopExecute],
        ]),
      ],
    ]);

    const entries = getCommandCatalogEntries(executionMap);

    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.category === "memory")).toBe(true);
    expect(entries.map((e) => e.commandName)).toEqual(["memory personal add", "memory personal remove"]);
  });

  it("returns an empty list for an empty execution map", () => {
    expect(getCommandCatalogEntries(new Map())).toEqual([]);
  });
});
