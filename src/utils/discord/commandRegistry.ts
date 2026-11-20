import type { Client } from "discord.js";
import { log } from "@/utils/misc/logger";

export class CommandRegistry {
  private commandIds: Map<string, string> = new Map();

  private initialized = false;

  async initialize(client: Client): Promise<void> {
    if (this.initialized) {
      log.warn("CommandRegistry already initialized, skipping");
      return;
    }

    try {
      const commands = await client.application?.commands.fetch();

      if (!commands) {
        log.warn("No application commands found during registry initialization");
        return;
      }

      for (const [id, command] of commands) {
        this.commandIds.set(command.name, id);

        if (command.options && command.options.length > 0) {
          for (const option of command.options) {
            if (option.type === 1) {
              // Type 1 = SUB_COMMAND
              const subcommandKey = `${command.name}:${option.name}`;
              this.commandIds.set(subcommandKey, id);
            } else if (option.type === 2) {
              // Type 2 = SUB_COMMAND_GROUP
              if ("options" in option && option.options) {
                for (const subOption of option.options) {
                  if (subOption.type === 1) {
                    const groupSubcommandKey = `${command.name}:${option.name}:${subOption.name}`;
                    this.commandIds.set(groupSubcommandKey, id);
                  }
                }
              }
            }
          }
        }
      }

      this.initialized = true;
      log.info(`CommandRegistry initialized with ${this.commandIds.size} command entries`);
    } catch (error) {
      log.error("Failed to initialize CommandRegistry", error as Error);
    }
  }

  getCommandMention(commandName: string, subcommandOrGroup?: string, subcommand?: string, clickable = false): string {
    let commandString: string;

    if (subcommandOrGroup && subcommand) {
      commandString = `/${commandName} ${subcommandOrGroup} ${subcommand}`;
    } else if (subcommandOrGroup) {
      commandString = `/${commandName} ${subcommandOrGroup}`;
    } else {
      commandString = `/${commandName}`;
    }

    const commandKey = subcommand
      ? `${commandName}:${subcommandOrGroup}:${subcommand}`
      : subcommandOrGroup
        ? `${commandName}:${subcommandOrGroup}`
        : commandName;
    const commandId = this.commandIds.get(commandKey);

    return clickable && commandId ? `</${commandString.slice(1)}:${commandId}>` : `\`${commandString}\``;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getRegisteredCommands(): string[] {
    return Array.from(this.commandIds.keys());
  }
}

export const commandRegistry = new CommandRegistry();
