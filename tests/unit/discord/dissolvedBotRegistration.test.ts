/**
 * Proves the /bot dissolution landed: /generate scene is reachable at its new path and the root is gone.
 * This file owns the /bot absence assertion; the per-command registration files do not restate it.
 *
 * The relocated `/generate scene` description is asserted by commandDescriptionRegistration.test.ts,
 * which rejects any registered root, group, or subcommand description that is still a locale key path.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { loadCommandData } from "@/utils/discord/commandLoader";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

describe("Dissolved /bot subcommand registration", () => {
  it("registers /generate scene as a subcommand under /generate", async () => {
    const { executionMap } = await loadCommandData();
    const generateCommands = executionMap.get("generate");

    expect(generateCommands).toBeDefined();
    expect(generateCommands?.has("scene")).toBe(true);
    expect(generateCommands?.has("image")).toBe(true);
    expect(generateCommands?.has("video")).toBe(true);
  }, 30000);

  it("removes the /bot root from both the registration payload and the execution map", async () => {
    const { registrationData, executionMap } = await loadCommandData();

    expect(registrationData.find((command) => command.name === "bot")).toBeUndefined();
    expect(executionMap.get("bot")).toBeUndefined();
  }, 30000);
});
