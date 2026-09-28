import { describe, expect, it } from "bun:test";
import { ApplicationCommandOptionType, type ApplicationCommandData } from "discord.js";
import { loadCommandData } from "@/utils/discord/commandLoader";

const UNRESOLVED_LOCALE_KEY_PATTERN = /^commands\.[a-zA-Z0-9_.-]+$/;

/**
 * Known unresolved descriptions scheduled for dissolution in the current wave.
 */
const DISSOLUTION_ALLOWLIST = new Set<string>();

type OffendingDescription = {
  path: string;
  description: string;
};

type CommandOption = {
  name?: string;
  description?: string;
  type?: number;
  options?: CommandOption[];
};

function collectUnresolvedDescriptions(
  commands: ApplicationCommandData[],
  allowlist: Set<string> = DISSOLUTION_ALLOWLIST,
): OffendingDescription[] {
  const offending: OffendingDescription[] = [];

  for (const command of commands) {
    const rootPath = command.name;
    const rootDescription = "description" in command ? command.description : undefined;
    if (rootDescription && UNRESOLVED_LOCALE_KEY_PATTERN.test(rootDescription) && !allowlist.has(rootPath)) {
      offending.push({ path: rootPath, description: rootDescription });
    }

    // The loader hands back the builders' raw JSON, so the option tree carries the fields the
    // registration payload really has rather than the narrower builder-facing union.
    const rootOptions = "options" in command ? command.options : undefined;
    const options = Array.isArray(rootOptions) ? (rootOptions as unknown as CommandOption[]) : [];
    for (const option of options) {
      if (!option.name) continue;

      if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
        const groupPath = `${rootPath} ${option.name}`;
        if (option.description && UNRESOLVED_LOCALE_KEY_PATTERN.test(option.description) && !allowlist.has(groupPath)) {
          offending.push({ path: groupPath, description: option.description });
        }

        for (const subOption of option.options ?? []) {
          if (!subOption.name) continue;
          if (subOption.type === ApplicationCommandOptionType.Subcommand) {
            const subPath = `${groupPath} ${subOption.name}`;
            if (
              subOption.description &&
              UNRESOLVED_LOCALE_KEY_PATTERN.test(subOption.description) &&
              !allowlist.has(subPath)
            ) {
              offending.push({ path: subPath, description: subOption.description });
            }
          }
        }
      } else if (option.type === ApplicationCommandOptionType.Subcommand) {
        const subPath = `${rootPath} ${option.name}`;
        if (option.description && UNRESOLVED_LOCALE_KEY_PATTERN.test(option.description) && !allowlist.has(subPath)) {
          offending.push({ path: subPath, description: option.description });
        }
      }
    }
  }

  return offending;
}

describe("Command description resolution gate", () => {
  it("registers no unresolved locale keys as command descriptions across roots, groups, and subcommands", async () => {
    const { registrationData } = await loadCommandData();
    const offending = collectUnresolvedDescriptions(registrationData);

    expect(offending).toEqual([]);
  }, 20_000);
});
