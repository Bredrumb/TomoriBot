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
      // Fetch application commands (global commands)
      const commands = await client.application?.commands.fetch();

      if (!commands) {
        log.warn("No application commands found during registry initialization");
        return;
      }

      // Cache command IDs with their names
      for (const [id, command] of commands) {
        // Store base command
        this.commandIds.set(command.name, id);

        // If command has subcommands, store them with format "command:subcommand"
        if (command.options && command.options.length > 0) {
          for (const option of command.options) {
            if (option.type === 1) {
              // Type 1 = SUB_COMMAND
              const subcommandKey = `${command.name}:${option.name}`;
              this.commandIds.set(subcommandKey, id);
            } else if (option.type === 2) {
              // Type 2 = SUB_COMMAND_GROUP
              // For subcommand groups, we need to go one level deeper
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
      // Format: "/command group subcommand"
      commandString = `/${commandName} ${subcommandOrGroup} ${subcommand}`;
    } else if (subcommandOrGroup) {
      // Format: "/command subcommand"
      commandString = `/${commandName} ${subcommandOrGroup}`;
    } else {
      // Format: "/command"
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

// Export a singleton instance
export const commandRegistry = new CommandRegistry();
