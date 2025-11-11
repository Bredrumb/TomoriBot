import type { Client } from "discord.js";
import { chatInputApplicationCommandMention } from "discord.js";
import { log } from "@/utils/misc/logger";

/**
 * Registry for caching Discord command IDs and generating command mentions.
 * This allows us to create clickable command references like </help setup:123456>
 * without hardcoding command IDs.
 */
class CommandRegistry {
	/** Map of command names to their IDs (format: "commandName" or "commandName:subcommand") */
	private commandIds: Map<string, string> = new Map();

	/** Whether the registry has been initialized */
	private initialized = false;

	/**
	 * Initialize the command registry by fetching all registered commands from Discord.
	 * This should be called once during bot startup after commands are registered.
	 * @param client - The Discord client instance
	 */
	async initialize(client: Client): Promise<void> {
		if (this.initialized) {
			log.warn("CommandRegistry already initialized, skipping");
			return;
		}

		try {
			// 1. Fetch application commands (global commands)
			const commands = await client.application?.commands.fetch();

			if (!commands) {
				log.warn("No application commands found during registry initialization");
				return;
			}

			// 2. Cache command IDs with their names
			for (const [id, command] of commands) {
				// Store base command
				this.commandIds.set(command.name, id);

				// 3. If command has subcommands, store them with format "command:subcommand"
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
			log.info(
				`CommandRegistry initialized with ${this.commandIds.size} command entries`,
			);
		} catch (error) {
			log.error("Failed to initialize CommandRegistry", error as Error);
		}
	}

	/**
	 * Get a Discord command mention string that renders as a clickable command reference.
	 * @param commandName - The base command name (e.g., "help")
	 * @param subcommand - Optional subcommand name (e.g., "setup")
	 * @param subcommandGroup - Optional subcommand group name (e.g., "memory" for "/teach memory personal")
	 * @returns A command mention string like "</help setup:123456>" or plain text if ID not found
	 * @example
	 * // Returns: "</help setup:123456>"
	 * getCommandMention("help", "setup");
	 *
	 * // Returns: "</teach memory:789012>"
	 * getCommandMention("teach", "memory", "personal");
	 */
	getCommandMention(
		commandName: string,
		subcommand?: string,
		subcommandGroup?: string,
	): string {
		// Build the lookup key based on parameters
		let lookupKey: string;
		let mentionName: string;

		if (subcommandGroup && subcommand) {
			// Format: "command:group:subcommand"
			lookupKey = `${commandName}:${subcommandGroup}:${subcommand}`;
			mentionName = `${commandName} ${subcommandGroup} ${subcommand}`;
		} else if (subcommand) {
			// Format: "command:subcommand"
			lookupKey = `${commandName}:${subcommand}`;
			mentionName = `${commandName} ${subcommand}`;
		} else {
			// Format: "command"
			lookupKey = commandName;
			mentionName = commandName;
		}

		// Get command ID from registry
		const commandId = this.commandIds.get(lookupKey);

		if (!commandId) {
			// Fallback to plain text if command not found
			log.warn(`Command ID not found in registry: ${lookupKey}`);
			return `\`/${mentionName}\``;
		}

		// Use Discord.js helper to create the mention
		return chatInputApplicationCommandMention(mentionName, commandId);
	}

	/**
	 * Check if the registry has been initialized.
	 * @returns True if initialized, false otherwise
	 */
	isInitialized(): boolean {
		return this.initialized;
	}

	/**
	 * Get all registered command names (for debugging).
	 * @returns Array of all command keys in the registry
	 */
	getRegisteredCommands(): string[] {
		return Array.from(this.commandIds.keys());
	}
}

// Export a singleton instance
export const commandRegistry = new CommandRegistry();
