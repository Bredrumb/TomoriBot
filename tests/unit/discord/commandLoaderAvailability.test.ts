import { describe, expect, it } from "bun:test";
import {
  isCommandModuleEnabledForRegistration,
  type CommandAvailabilityContext,
  type LoadedCommandModule,
} from "@/utils/discord/commandLoader";

const context: CommandAvailabilityContext = {
  commandFile: "src/commands/subscribe.ts",
  commandKind: "root",
};

describe("command loader availability gates", () => {
  it("enables command modules by default", async () => {
    const commandModule: LoadedCommandModule = {};

    await expect(isCommandModuleEnabledForRegistration(commandModule, context)).resolves.toBe(true);
  });

  it("skips command modules when their gate returns false", async () => {
    const commandModule: LoadedCommandModule = {
      isCommandEnabled: () => false,
    };

    await expect(isCommandModuleEnabledForRegistration(commandModule, context)).resolves.toBe(false);
  });

  it("passes command context to async gates", async () => {
    let receivedContext: CommandAvailabilityContext | null = null;
    const commandModule: LoadedCommandModule = {
      isCommandEnabled: async (gateContext) => {
        receivedContext = gateContext;
        return gateContext.commandKind === "root";
      },
    };

    await expect(isCommandModuleEnabledForRegistration(commandModule, context)).resolves.toBe(true);
    expect(receivedContext).toEqual(context);
  });
});
