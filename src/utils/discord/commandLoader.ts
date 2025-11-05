/**
 * Command loader utility for Tomori Bot
 * Loads command modules from the commands directory structure
 * Supports both flat subcommands and subcommand groups via folder structure
 */
import path from "node:path";
import { readdirSync } from "node:fs";
import { log } from "../misc/logger";
import {
	SlashCommandBuilder,
	type ApplicationCommandData,
	type Client,
	type ChatInputCommandInteraction,
	PermissionsBitField,
	InteractionContextType,
	type SlashCommandSubcommandGroupBuilder,
} from "discord.js";
import type { SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow, ErrorContext } from "../../types/db/schema";
import getAllFiles from "../misc/ioHelper";
import { localizer, getSupportedLocales } from "../text/localizer";

/**
 * Type for the command execution function
 */
export type CommandExecuteFunction = (
	client: Client,
	interaction: ChatInputCommandInteraction,
	userData: UserRow,
	locale: string,
) => Promise<void>;

/**
 * Map structure for the command execution functions
 * First level: category name (e.g., 'config')
 * Second level: subcommand path
 *   - For flat subcommands: 'subcommand' (e.g., 'model')
 *   - For grouped subcommands: 'group.subcommand' (e.g., 'apikey.set')
 */
export type CommandExecutionMap = Map<
	string,
	Map<string, CommandExecuteFunction>
>;

/**
 * Map for command cooldowns (category -> duration)
 */
export type CommandCooldownMap = Map<string, number>;
// Categories that are completely restricted to guilds only
const GUILD_ONLY_CATEGORIES: string[] = ["server"];
// Categories that require manage permissions in guild context
const MANAGER_ONLY_CATEGORIES = ["config", "server"];

// Note: Individual subcommand restrictions are no longer needed.
// Guild-only commands are now in the "server" category which is entirely guild-restricted.

/**
 * Helper function to apply localizations to a subcommand and its options/choices
 * @param configuredSubcommand - The configured subcommand builder
 * @param categoryName - The category name
 * @param subcommandPath - The subcommand path (flat: 'name', grouped: 'group.name')
 * @param availableLocales - Array of available locale codes
 */
function applySubcommandLocalizations(
	configuredSubcommand: SlashCommandSubcommandBuilder,
	categoryName: string,
	subcommandPath: string,
	availableLocales: string[],
): void {
	// 1. Apply subcommand description localizations
	const localizationKey = `commands.${categoryName}.${subcommandPath}.description`;
	const subcommandLocalizationsMap: { [key: string]: string } = {};

	for (const locale of availableLocales) {
		const localizedDesc = localizer(locale, localizationKey);
		if (localizedDesc && localizedDesc !== localizationKey) {
			subcommandLocalizationsMap[locale] = localizedDesc;
		}
	}

	if (Object.keys(subcommandLocalizationsMap).length > 0) {
		configuredSubcommand.setDescriptionLocalizations(
			subcommandLocalizationsMap,
		);
	}

	// 2. Apply option description localizations
	if (configuredSubcommand.options) {
		for (const option of configuredSubcommand.options) {
			if (option.name) {
				// Build localization key for option description
				const optionLocalizationKey = `commands.${categoryName}.${subcommandPath}.${option.name}_description`;
				const optionLocalizationsMap: { [key: string]: string } = {};

				for (const locale of availableLocales) {
					let localizedDesc = localizer(locale, optionLocalizationKey);
					const fallbackKey = `commands.${categoryName}.${subcommandPath}.option_description`;

					// Fallback to generic 'option_description' for backwards compatibility
					if (!localizedDesc || localizedDesc === optionLocalizationKey) {
						localizedDesc = localizer(locale, fallbackKey);
					}

					// Apply if valid translation found (not the key itself)
					if (
						localizedDesc &&
						localizedDesc !== optionLocalizationKey &&
						localizedDesc !== fallbackKey
					) {
						optionLocalizationsMap[locale] = localizedDesc;
					}
				}

				// Apply option description localizations if we have any
				if (Object.keys(optionLocalizationsMap).length > 0) {
					option.setDescriptionLocalizations(optionLocalizationsMap);
				}

				// 3. Apply choice name localizations
				if (
					"choices" in option &&
					Array.isArray(option.choices) &&
					option.choices.length > 0
				) {
					for (const choice of option.choices) {
						if (choice.value) {
							// Build localization key for choice name
							const choiceLocalizationKey = `commands.${categoryName}.${subcommandPath}.${option.name}_choice_${choice.value}`;
							const choiceLocalizationsMap: { [key: string]: string } = {};

							for (const locale of availableLocales) {
								let localizedChoice = localizer(locale, choiceLocalizationKey);
								const commonChoiceKey = `commands.choices.${choice.value}`;

								// Fallback to common choice localization for reusable choices
								if (
									!localizedChoice ||
									localizedChoice === choiceLocalizationKey
								) {
									localizedChoice = localizer(locale, commonChoiceKey);
								}

								// Apply if valid translation found (not the key itself)
								if (
									localizedChoice &&
									localizedChoice !== choiceLocalizationKey &&
									localizedChoice !== commonChoiceKey
								) {
									choiceLocalizationsMap[locale] = localizedChoice;
								}
							}

							// Apply choice name localizations if we have any
							if (Object.keys(choiceLocalizationsMap).length > 0) {
								choice.name_localizations = choiceLocalizationsMap;
							}
						}
					}
				}
			}
		}
	}
}

/**
 * Loads all command modules, builds registration data and command maps
 * @returns Object containing command data for registration and execution maps
 */
export async function loadCommandData(): Promise<{
	registrationData: ApplicationCommandData[];
	executionMap: CommandExecutionMap;
	cooldownMap: CommandCooldownMap;
}> {
	// Initialize our maps
	const executionMap: CommandExecutionMap = new Map();
	const cooldownMap: CommandCooldownMap = new Map();
	// This will store our category builders (one per directory)
	const builders = new Map<string, SlashCommandBuilder>();
	let commandCount = 0;

	try {
		// Get available locales for auto-localization (exclude en-US as it's the base locale)
		const availableLocales = getSupportedLocales().filter(
			(locale) => locale !== "en-US",
		);
		// 1. Get all command category directories
		const commandsPath = path.join(process.cwd(), "src", "commands");
		const categoryDirs = getAllFiles(commandsPath, true);

		// 2. Process each category directory
		for (const categoryDir of categoryDirs) {
			const categoryName = path.basename(categoryDir);
			log.info(`Processing category: ${categoryName}`);

			// 3. Create or get the SlashCommandBuilder for this category
			let categoryBuilder = builders.get(categoryName);
			if (!categoryBuilder) {
				// Initialize a new builder for this category
				// Get category description from localizations (try to find 'commands.<category>.description')
				const categoryDescription =
					localizer("en-US", `commands.${categoryName}.description`) ||
					`${categoryName} commands`; // Fallback if no localization exists

				const categoryLocalizationsMap: { [key: string]: string } = {};
				// Check all available locales for category description
				for (const locale of availableLocales) {
					const localizedDesc = localizer(
						locale,
						`commands.${categoryName}.description`,
					);
					if (
						localizedDesc &&
						localizedDesc !== `commands.${categoryName}.description`
					) {
						categoryLocalizationsMap[locale] = localizedDesc;
					}
				}

				categoryBuilder = new SlashCommandBuilder()
					.setName(categoryName)
					.setDescription(categoryDescription);

				// Apply specific settings for guild-only categories
				if (GUILD_ONLY_CATEGORIES.includes(categoryName)) {
					categoryBuilder.setContexts(InteractionContextType.Guild); // Disallow use in DMs
					log.info(`Applied Guild Only Restriction to /${categoryName}`);
				}
				if (MANAGER_ONLY_CATEGORIES.includes(categoryName)) {
					categoryBuilder.setDefaultMemberPermissions(
						PermissionsBitField.Flags.ManageGuild,
					); // Require Manage Guild permission
					log.info(
						`Applied ManageGuild permission requirement to /${categoryName}`,
					);
				}

				// Add localizations if we have any
				if (Object.keys(categoryLocalizationsMap).length > 0) {
					categoryBuilder.setDescriptionLocalizations(categoryLocalizationsMap);
				}

				builders.set(categoryName, categoryBuilder);
				executionMap.set(categoryName, new Map()); // Initialize subcommand map
			}

			// 4. Get all items (files and directories) in this category
			const items = readdirSync(categoryDir, { withFileTypes: true });

			// 5. Process each item (file or directory)
			for (const item of items) {
				// Skip hidden files/directories
				if (item.name.startsWith(".")) continue;

				const itemPath = path.join(categoryDir, item.name);

				// 6. Handle subcommand groups (directories)
				if (item.isDirectory()) {
					const groupName = item.name;
					log.info(`Processing subcommand group: ${categoryName}/${groupName}`);

					try {
						// Add subcommand group to category
						categoryBuilder.addSubcommandGroup(
							(group: SlashCommandSubcommandGroupBuilder) => {
								// Get group description from localizations
								const groupLocalizationKey = `commands.${categoryName}.${groupName}.description`;
								const groupDescription =
									localizer("en-US", groupLocalizationKey) ||
									`${groupName} commands`;

								group.setName(groupName).setDescription(groupDescription);

								// Apply group description localizations
								const groupLocalizationsMap: { [key: string]: string } = {};
								for (const locale of availableLocales) {
									const localizedDesc = localizer(locale, groupLocalizationKey);
									if (localizedDesc && localizedDesc !== groupLocalizationKey) {
										groupLocalizationsMap[locale] = localizedDesc;
									}
								}
								if (Object.keys(groupLocalizationsMap).length > 0) {
									group.setDescriptionLocalizations(groupLocalizationsMap);
								}

								// Get all command files in this group
								const groupCommandFiles = getAllFiles(itemPath);

								// Process each command in the group
								for (const commandFile of groupCommandFiles) {
									try {
										// Import the command module (needs to be sync for builder pattern)
										// We'll use dynamic import but handle it carefully
										const commandModule = require(commandFile);

										// Validate exports
										if (
											!commandModule.configureSubcommand ||
											!commandModule.execute
										) {
											log.warn(
												`Command at ${commandFile} is missing required exports`,
											);
											continue;
										}

										let subcommandName = "";

										// Add subcommand to group
										group.addSubcommand(
											(subcommand: SlashCommandSubcommandBuilder) => {
												const configuredSubcommand =
													commandModule.configureSubcommand(subcommand);
												subcommandName = configuredSubcommand.name;

												// Apply subcommand localizations
												if (subcommandName) {
													applySubcommandLocalizations(
														configuredSubcommand,
														categoryName,
														`${groupName}.${subcommandName}`,
														availableLocales,
													);
												}

												return configuredSubcommand;
											},
										);

										if (!subcommandName) {
											log.warn(
												`Subcommand in ${commandFile} did not set a name`,
											);
											continue;
										}

										// Store execute function with group.subcommand format
										const executionKey = `${groupName}.${subcommandName}`;
										executionMap
											.get(categoryName)
											?.set(executionKey, commandModule.execute);

										// Store cooldown if defined
										if (
											commandModule.cooldown &&
											typeof commandModule.cooldown === "number"
										) {
											cooldownMap.set(categoryName, commandModule.cooldown);
										}

										commandCount++;
										log.info(
											`Loaded grouped subcommand: ${categoryName} ${executionKey}`,
										);
									} catch (error) {
										const context: ErrorContext = {
											errorType: "CommandLoadingError",
											metadata: {
												commandFile,
												categoryName,
												groupName,
											},
										};
										log.error(
											`Failed to load grouped command from ${commandFile}:`,
											error,
											context,
										);
									}
								}

								return group;
							},
						);
					} catch (error) {
						const context: ErrorContext = {
							errorType: "CommandGroupLoadingError",
							metadata: {
								categoryName,
								groupName,
							},
						};
						await log.error(
							`Failed to load command group ${groupName}:`,
							error,
							context,
						);
					}
				}
				// 7. Handle flat subcommands (direct .ts files)
				else if (item.isFile() && itemPath.endsWith(".ts")) {
					const commandFile = itemPath;

					try {
						// Import the command module
						const commandModule = await import(commandFile);

						// Validate exports: must have configureSubcommand and execute
						if (!commandModule.configureSubcommand || !commandModule.execute) {
							log.warn(
								`Command at ${commandFile} is missing required exports (configureSubcommand or execute)`,
							);
							continue;
						}

						// Use a temporary variable to store the subcommand name
						let subcommandName = "";

						// Add the subcommand to the category builder
						categoryBuilder.addSubcommand(
							(subcommand: SlashCommandSubcommandBuilder) => {
								// Call the module's configureSubcommand function and capture its result
								const configuredSubcommand =
									commandModule.configureSubcommand(subcommand);
								// Get the name that was set
								subcommandName = configuredSubcommand.name;

								// Apply subcommand localizations
								if (subcommandName) {
									applySubcommandLocalizations(
										configuredSubcommand,
										categoryName,
										subcommandName,
										availableLocales,
									);
								}

								return configuredSubcommand;
							},
						);

						if (!subcommandName) {
							log.warn(`Subcommand in ${commandFile} did not set a name`);
							continue;
						}

						// Store the execute function in the map
						executionMap
							.get(categoryName)
							?.set(subcommandName, commandModule.execute);

						// Store cooldown if defined (optional feature)
						if (
							commandModule.cooldown &&
							typeof commandModule.cooldown === "number"
						) {
							cooldownMap.set(categoryName, commandModule.cooldown);
						}

						commandCount++;
						log.info(`Loaded subcommand: ${categoryName} ${subcommandName}`);
					} catch (error) {
						const context: ErrorContext = {
							errorType: "CommandLoadingError",
							metadata: {
								commandFile,
								categoryName,
							},
						};
						await log.error(
							`Failed to load command from ${commandFile}:`,
							error,
							context,
						);
					}
				}
			}
		}

		// Convert builders to the registration data array
		const registrationData = Array.from(builders.values()).map(
			(builder) => builder.toJSON() as ApplicationCommandData,
		);

		log.success(
			`Successfully loaded ${commandCount} subcommands in ${builders.size} categories`,
		);
		return { registrationData, executionMap, cooldownMap };
	} catch (error) {
		const context: ErrorContext = {
			errorType: "CommandLoaderError",
			metadata: { stage: "initializing" },
		};
		await log.error("Error loading command data:", error, context);
		// Return empty data in case of errors to prevent crashes
		return {
			registrationData: [],
			executionMap: new Map(),
			cooldownMap: new Map(),
		};
	}
}
