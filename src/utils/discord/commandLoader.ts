/**
 * Command loader utility for Tomori Bot
 * Loads command modules from the commands directory structure
 * Supports root commands, flat subcommands, and subcommand groups via folder structure
 */
import path from "node:path";
import { log } from "../misc/logger";
import {
  SlashCommandBuilder,
  type ApplicationCommandData,
  type Client,
  type ChatInputCommandInteraction,
  PermissionsBitField,
  InteractionContextType,
  type SlashCommandSubcommandGroupBuilder,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import type { SlashCommandSubcommandBuilder } from "discord.js";
import type { UserRow, ErrorContext } from "../../types/db/schema";
import { localizer, getSupportedLocales } from "../text/localizer";

export const ROOT_COMMAND_EXECUTION_KEY = "__root__";
type RootCommandBuilder = SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;

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
 *   - For root commands: ROOT_COMMAND_EXECUTION_KEY
 *   - For flat subcommands: 'subcommand' (e.g., 'model')
 *   - For grouped subcommands: 'group.subcommand' (e.g., 'apikey.set')
 */
export type CommandExecutionMap = Map<string, Map<string, CommandExecuteFunction>>;

/**
 * Map for command cooldowns (category -> duration)
 */
export type CommandCooldownMap = Map<string, number>;

export type LoadedCommandModule = {
  configureSubcommand?: (subcommand: SlashCommandSubcommandBuilder) => SlashCommandSubcommandBuilder;
  configureCommand?: (command: SlashCommandBuilder) => RootCommandBuilder;
  isCommandEnabled?: (context: CommandAvailabilityContext) => boolean | Promise<boolean>;
  execute?: CommandExecuteFunction;
  cooldown?: number;
  guildOnly?: boolean;
  managerOnly?: boolean;
  nsfw?: boolean;
};

type LoadedCommandFile = {
  file: string;
  module: LoadedCommandModule;
};

export type CommandAvailabilityContext = {
  commandFile: string;
  commandKind: "root" | "flat" | "grouped";
  categoryName?: string;
  groupName?: string;
};

type DirectoryItem = {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
};

// Categories that are completely restricted to guilds only
const GUILD_ONLY_CATEGORIES: string[] = ["server", "conditioning"];
// Categories that require manage permissions in guild context
const MANAGER_ONLY_CATEGORIES = [
  "config",
  "model",
  "provider",
  "mcp",
  "capabilities",
  "nsfw",
  "optional-key",
  "server",
];

const COMMAND_LOCALIZATION_ALIASES: Record<string, string> = {
  "commands.memory.description": "commands.teach.memory.description",
  "commands.conditioning.reward.description": "commands.reward.description",
  "commands.conditioning.punish.description": "commands.punish.description",
  "commands.persona.attribute.description": "commands.teach.attribute.description",
  "commands.persona.sample-dialogue.description": "commands.teach.sampledialogue.description",
  "commands.persona.prompt.description": "commands.teach.personaprompt.description",
  "commands.memory.document.description": "commands.teach.document.description",
  "commands.memory.personal.description": "commands.teach.memory.personal.description",
  "commands.memory.server.description": "commands.teach.memory.server.description",
  "commands.persona.attribute.add.description": "commands.teach.attribute.description",
  "commands.persona.attribute.remove.description": "commands.forget.attribute.description",
  "commands.persona.sample-dialogue.add.description": "commands.teach.sampledialogue.description",
  "commands.persona.sample-dialogue.remove.description": "commands.forget.sampledialogue.description",
  "commands.persona.prompt.set.description": "commands.teach.personaprompt.description",
  "commands.persona.prompt.remove.description": "commands.forget.personaprompt.description",
  "commands.memory.document.add.description": "commands.teach.document.description",
  "commands.memory.document.remove.description": "commands.forget.document.description",
  "commands.memory.personal.add.description": "commands.teach.memory.personal.description",
  "commands.memory.personal.remove.description": "commands.forget.memory.personal.description",
  "commands.memory.server.add.description": "commands.teach.memory.server.description",
  "commands.memory.server.remove.description": "commands.forget.memory.server.description",
};

function getCommandLocalizationAliases(key: string): string[] {
  const aliases: string[] = [];
  const staticAlias = COMMAND_LOCALIZATION_ALIASES[key];

  if (staticAlias) {
    aliases.push(staticAlias);
  }

  if (key.includes(".deliberate-tool-mode.")) {
    aliases.push(key.replace(".deliberate-tool-mode.", ".deliberatetoolmode."));
  }

  const systemPromptMatch = key.match(/^commands\.config\.system-prompt\.(set|remove|preset)\.description$/);
  if (systemPromptMatch) {
    const aliasByAction: Record<string, string> = {
      set: "commands.config.prompt.change.command_description",
      remove: "commands.config.prompt.clear.command_description",
      preset: "commands.config.prompt.preset.command_description",
    };
    aliases.push(aliasByAction[systemPromptMatch[1]]);
  }

  const configDescriptionAliases: Record<string, string> = {
    "commands.capabilities.manage.description": "commands.capabilities.manage.description",
    "commands.config.send-limit.description": "commands.config.sendlimit.description",
    "commands.server.always-reply.description": "commands.server.alwaysreply.description",
    "commands.server.deliberate-trigger-mode.description": "commands.server.deliberatetriggermode.description",
    "commands.server.deliberate-tool-mode.description": "commands.server.deliberatetoolmode.description",
    "commands.personal.deliberate-trigger-mode.description": "commands.personal.deliberatetriggermode.description",
    "commands.personal.deliberate-tool-mode.description": "commands.personal.deliberatetoolmode.description",
    "commands.server.quota.image-generation.description": "commands.server.quota.imagegen.description",
    "commands.server.quota.text-generation.description": "commands.server.quota.textgen.description",
    "commands.server.quota.video-generation.description": "commands.server.quota.videogen.description",
    "commands.model.override.remove.description": "commands.config.remove.modeloverride.description",
  };
  const configAlias = configDescriptionAliases[key];
  if (configAlias) {
    aliases.push(configAlias);
  }

  const conditioningMatch = key.match(
    /^commands\.conditioning\.(reward|punish)\.([a-z0-9-]+)\.([a-z][a-z0-9]*(?:_[a-z0-9]+)*_description|description)$/,
  );
  if (conditioningMatch) {
    const [, type, actionKey, suffix] = conditioningMatch;
    aliases.push(`commands.${type}.${actionKey}.${suffix}`);
  }

  return aliases;
}

function localizeWithAliases(locale: string, key: string): string {
  const candidateKeys = [key, ...getCommandLocalizationAliases(key)];

  for (const candidateKey of candidateKeys) {
    const localizedValue = localizer(locale, candidateKey);
    if (localizedValue && localizedValue !== candidateKey) {
      return localizedValue;
    }
  }

  return localizer(locale, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getOptionName(option: unknown): string | null {
  if (!isRecord(option) || typeof option.name !== "string") return null;
  return option.name;
}

function applyOptionDescriptionLocalizations(option: unknown, localizations: Record<string, string>): void {
  if (!isRecord(option) || typeof option.setDescriptionLocalizations !== "function") return;
  option.setDescriptionLocalizations(localizations);
}

function getOptionChoices(option: unknown): Record<string, unknown>[] {
  if (!isRecord(option) || !Array.isArray(option.choices)) return [];
  return option.choices.filter(isRecord);
}

async function readVisibleDirectory(directory: string): Promise<DirectoryItem[]> {
  const glob = new Bun.Glob("*");
  const items: DirectoryItem[] = [];

  for await (const name of glob.scan({ cwd: directory, onlyFiles: false })) {
    if (name.startsWith(".")) continue;

    const itemPath = path.join(directory, name);
    const stat = await Bun.file(itemPath).stat();
    items.push({
      name,
      path: itemPath,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
    });
  }

  return items;
}

async function getCommandDirectories(directory: string): Promise<string[]> {
  const items = await readVisibleDirectory(directory);
  return items.filter((item) => item.isDirectory).map((item) => item.path);
}

async function getCommandFiles(directory: string): Promise<string[]> {
  const items = await readVisibleDirectory(directory);
  return items
    .filter((item) => item.isFile && (item.name.endsWith(".ts") || item.name.endsWith(".js")))
    .map((item) => item.path);
}

// Note: Individual subcommand restrictions are no longer needed.
// Guild-only commands are now in the "server" category which is entirely guild-restricted.

/**
 * Helper function to apply localizations to a command/subcommand and its options/choices
 * @param configuredCommand - The configured command/subcommand builder
 * @param categoryName - The category name
 * @param subcommandPath - Optional subcommand path (flat: 'name', grouped: 'group.name')
 * @param availableLocales - Array of available locale codes
 */
function applyCommandLocalizations(
  configuredCommand: RootCommandBuilder | SlashCommandSubcommandBuilder,
  categoryName: string,
  subcommandPath: string | null,
  availableLocales: string[],
): void {
  // 1. Apply command/subcommand description localizations
  const localizationKey = subcommandPath
    ? `commands.${categoryName}.${subcommandPath}.description`
    : `commands.${categoryName}.description`;
  const subcommandLocalizationsMap: { [key: string]: string } = {};

  for (const locale of availableLocales) {
    const localizedDesc = localizeWithAliases(locale, localizationKey);
    if (localizedDesc && localizedDesc !== localizationKey) {
      subcommandLocalizationsMap[locale] = localizedDesc;
    }
  }

  if (Object.keys(subcommandLocalizationsMap).length > 0) {
    configuredCommand.setDescriptionLocalizations(subcommandLocalizationsMap);
  }

  // 2. Apply option description localizations
  if (configuredCommand.options) {
    for (const option of configuredCommand.options) {
      const optionName = getOptionName(option);
      if (optionName) {
        // Build localization key for option description
        const commandPath = subcommandPath ? `${categoryName}.${subcommandPath}` : categoryName;
        const optionLocalizationKey = `commands.${commandPath}.${optionName}_description`;
        const optionLocalizationsMap: { [key: string]: string } = {};

        for (const locale of availableLocales) {
          let localizedDesc = localizeWithAliases(locale, optionLocalizationKey);
          const fallbackKey = `commands.${commandPath}.option_description`;

          // Fallback to generic 'option_description' for backwards compatibility
          if (!localizedDesc || localizedDesc === optionLocalizationKey) {
            localizedDesc = localizeWithAliases(locale, fallbackKey);
          }

          // Apply if valid translation found (not the key itself)
          if (localizedDesc && localizedDesc !== optionLocalizationKey && localizedDesc !== fallbackKey) {
            optionLocalizationsMap[locale] = localizedDesc;
          }
        }

        // Apply option description localizations if we have any
        if (Object.keys(optionLocalizationsMap).length > 0) {
          applyOptionDescriptionLocalizations(option, optionLocalizationsMap);
        }

        // 3. Apply choice name localizations
        const optionChoices = getOptionChoices(option);
        if (optionChoices.length > 0) {
          for (const choice of optionChoices) {
            if (choice.value === undefined || choice.value === null) continue;

            const choiceValue = String(choice.value);
            const commandPath = subcommandPath ? `${categoryName}.${subcommandPath}` : categoryName;
            const choiceLocalizationKeys = [
              `commands.${commandPath}.${optionName}_choice_${choiceValue}`,
              `commands.${commandPath}.${choiceValue}_option`,
              `commands.${commandPath}.${optionName}_${choiceValue}`,
              `commands.choices.${choiceValue}`,
            ];
            const choiceLocalizationsMap: { [key: string]: string } = {};

            for (const locale of availableLocales) {
              let localizedChoice: string | null = null;

              for (const localizationKey of choiceLocalizationKeys) {
                const candidate = localizer(locale, localizationKey);
                if (candidate && candidate !== localizationKey) {
                  localizedChoice = candidate;
                  break;
                }

                const aliasedCandidate = localizeWithAliases(locale, localizationKey);
                if (aliasedCandidate && aliasedCandidate !== localizationKey) {
                  localizedChoice = aliasedCandidate;
                  break;
                }
              }

              if (localizedChoice) {
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

function applyRootCommandRestrictions(command: RootCommandBuilder, commandModule: LoadedCommandModule): void {
  if (commandModule.guildOnly || GUILD_ONLY_CATEGORIES.includes(command.name)) {
    command.setContexts(InteractionContextType.Guild);
  }
  if (commandModule.managerOnly || MANAGER_ONLY_CATEGORIES.includes(command.name)) {
    command.setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild);
  }
  if (commandModule.nsfw || command.name === "nsfw") {
    command.setNSFW(true);
  }
}

export async function isCommandModuleEnabledForRegistration(
  commandModule: LoadedCommandModule,
  context: CommandAvailabilityContext,
): Promise<boolean> {
  if (!commandModule.isCommandEnabled) return true;

  try {
    return await commandModule.isCommandEnabled(context);
  } catch (error) {
    const errorContext: ErrorContext = {
      errorType: "CommandAvailabilityError",
      metadata: context,
    };
    await log.error(`Command availability gate failed for ${context.commandFile}:`, error, errorContext);
    return false;
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
  const builders = new Map<string, RootCommandBuilder>();
  let commandCount = 0;

  try {
    // Get available locales for auto-localization (exclude en-US as it's the base locale)
    const availableLocales = getSupportedLocales().filter((locale) => locale !== "en-US");
    // 1. Get all command category directories
    const commandsPath = path.join(process.cwd(), "src", "commands");
    const categoryDirs = await getCommandDirectories(commandsPath);

    // 2. Process each category directory
    for (const categoryDir of categoryDirs) {
      const categoryName = path.basename(categoryDir);
      log.info(`Processing category: ${categoryName}`);

      // 3. Create or get the SlashCommandBuilder for this category
      let categoryBuilder = builders.get(categoryName) as SlashCommandBuilder | undefined;
      if (!categoryBuilder) {
        // Initialize a new builder for this category
        // Get category description from localizations (try to find 'commands.<category>.description')
        const categoryDescription =
          localizeWithAliases("en-US", `commands.${categoryName}.description`) || `${categoryName} commands`; // Fallback if no localization exists

        const categoryLocalizationsMap: { [key: string]: string } = {};
        // Check all available locales for category description
        for (const locale of availableLocales) {
          const localizedDesc = localizeWithAliases(locale, `commands.${categoryName}.description`);
          if (localizedDesc && localizedDesc !== `commands.${categoryName}.description`) {
            categoryLocalizationsMap[locale] = localizedDesc;
          }
        }

        categoryBuilder = new SlashCommandBuilder().setName(categoryName).setDescription(categoryDescription);

        // Apply specific settings for guild-only categories
        if (GUILD_ONLY_CATEGORIES.includes(categoryName)) {
          categoryBuilder.setContexts(InteractionContextType.Guild); // Disallow use in DMs
          log.info(`Applied Guild Only Restriction to /${categoryName}`);
        }
        if (MANAGER_ONLY_CATEGORIES.includes(categoryName)) {
          categoryBuilder.setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild); // Require Manage Guild permission
          log.info(`Applied ManageGuild permission requirement to /${categoryName}`);
        }
        if (categoryName === "nsfw") {
          categoryBuilder.setNSFW(true);
          log.info("Applied age restriction to /nsfw");
        }

        // Add localizations if we have any
        if (Object.keys(categoryLocalizationsMap).length > 0) {
          categoryBuilder.setDescriptionLocalizations(categoryLocalizationsMap);
        }

        builders.set(categoryName, categoryBuilder);
        executionMap.set(categoryName, new Map()); // Initialize subcommand map
      }

      // 4. Get all items (files and directories) in this category
      const items = await readVisibleDirectory(categoryDir);

      // 5. Process each item (file or directory)
      for (const item of items) {
        const itemPath = path.join(categoryDir, item.name);

        // 6. Handle subcommand groups (directories)
        if (item.isDirectory) {
          const groupName = item.name;
          log.info(`Processing subcommand group: ${categoryName}/${groupName}`);

          try {
            // Get all command files in this group
            const groupCommandFiles = await getCommandFiles(itemPath);

            // Pre-load all command modules asynchronously to support top-level await
            const loadedModules: LoadedCommandFile[] = [];
            for (const commandFile of groupCommandFiles) {
              try {
                const commandModule = (await import(commandFile)) as LoadedCommandModule;
                const commandEnabled = await isCommandModuleEnabledForRegistration(commandModule, {
                  commandFile,
                  commandKind: "grouped",
                  categoryName,
                  groupName,
                });
                if (!commandEnabled) {
                  log.info(`Skipping disabled grouped command module: ${commandFile}`);
                  continue;
                }
                loadedModules.push({ file: commandFile, module: commandModule });
              } catch (error) {
                const context: ErrorContext = {
                  errorType: "CommandLoadingError",
                  metadata: {
                    commandFile,
                    categoryName,
                    groupName,
                  },
                };
                log.error(`Failed to load grouped command from ${commandFile}:`, error, context);
              }
            }

            if (loadedModules.length === 0) {
              log.info(`Skipping empty subcommand group: ${categoryName}/${groupName}`);
              continue;
            }

            // Add subcommand group to category
            categoryBuilder.addSubcommandGroup((group: SlashCommandSubcommandGroupBuilder) => {
              // Get group description from localizations
              const groupLocalizationKey = `commands.${categoryName}.${groupName}.description`;
              const groupDescription = localizeWithAliases("en-US", groupLocalizationKey) || `${groupName} commands`;

              group.setName(groupName).setDescription(groupDescription);

              // Apply group description localizations
              const groupLocalizationsMap: { [key: string]: string } = {};
              for (const locale of availableLocales) {
                const localizedDesc = localizeWithAliases(locale, groupLocalizationKey);
                if (localizedDesc && localizedDesc !== groupLocalizationKey) {
                  groupLocalizationsMap[locale] = localizedDesc;
                }
              }
              if (Object.keys(groupLocalizationsMap).length > 0) {
                group.setDescriptionLocalizations(groupLocalizationsMap);
              }

              // Process each loaded command in the group
              for (const { file: commandFile, module: commandModule } of loadedModules) {
                try {
                  // Validate exports
                  if (!commandModule.configureSubcommand || !commandModule.execute) {
                    log.warn(`Command at ${commandFile} is missing required exports`);
                    continue;
                  }

                  const configureSubcommand = commandModule.configureSubcommand;
                  const execute = commandModule.execute;
                  let subcommandName = "";

                  // Add subcommand to group
                  group.addSubcommand((subcommand: SlashCommandSubcommandBuilder) => {
                    const configuredSubcommand = configureSubcommand(subcommand);
                    subcommandName = configuredSubcommand.name;

                    // Apply subcommand localizations
                    if (subcommandName) {
                      applyCommandLocalizations(
                        configuredSubcommand,
                        categoryName,
                        `${groupName}.${subcommandName}`,
                        availableLocales,
                      );
                    }

                    return configuredSubcommand;
                  });

                  if (!subcommandName) {
                    log.warn(`Subcommand in ${commandFile} did not set a name`);
                    continue;
                  }

                  // Store execute function with group.subcommand format
                  const executionKey = `${groupName}.${subcommandName}`;
                  executionMap.get(categoryName)?.set(executionKey, execute);

                  // Store cooldown if defined
                  if (commandModule.cooldown && typeof commandModule.cooldown === "number") {
                    cooldownMap.set(categoryName, commandModule.cooldown);
                  }

                  commandCount++;
                  log.info(`Loaded grouped subcommand: ${categoryName} ${executionKey}`);
                } catch (error) {
                  const context: ErrorContext = {
                    errorType: "CommandLoadingError",
                    metadata: {
                      commandFile,
                      categoryName,
                      groupName,
                    },
                  };
                  log.error(`Failed to load grouped command from ${commandFile}:`, error, context);
                }
              }

              return group;
            });
          } catch (error) {
            const context: ErrorContext = {
              errorType: "CommandGroupLoadingError",
              metadata: {
                categoryName,
                groupName,
              },
            };
            await log.error(`Failed to load command group ${groupName}:`, error, context);
          }
        }
        // 7. Handle flat subcommands (direct .ts files)
        else if (item.isFile && itemPath.endsWith(".ts")) {
          const commandFile = itemPath;

          try {
            // Import the command module
            const commandModule = (await import(commandFile)) as LoadedCommandModule;
            const commandEnabled = await isCommandModuleEnabledForRegistration(commandModule, {
              commandFile,
              commandKind: "flat",
              categoryName,
            });
            if (!commandEnabled) {
              log.info(`Skipping disabled command module: ${commandFile}`);
              continue;
            }

            // Validate exports: must have configureSubcommand and execute
            if (!commandModule.configureSubcommand || !commandModule.execute) {
              log.warn(`Command at ${commandFile} is missing required exports (configureSubcommand or execute)`);
              continue;
            }

            const configureSubcommand = commandModule.configureSubcommand;
            const execute = commandModule.execute;
            // Use a temporary variable to store the subcommand name
            let subcommandName = "";

            // Add the subcommand to the category builder
            categoryBuilder.addSubcommand((subcommand: SlashCommandSubcommandBuilder) => {
              // Call the module's configureSubcommand function and capture its result
              const configuredSubcommand = configureSubcommand(subcommand);
              // Get the name that was set
              subcommandName = configuredSubcommand.name;

              // Apply subcommand localizations
              if (subcommandName) {
                applyCommandLocalizations(configuredSubcommand, categoryName, subcommandName, availableLocales);
              }

              return configuredSubcommand;
            });

            if (!subcommandName) {
              log.warn(`Subcommand in ${commandFile} did not set a name`);
              continue;
            }

            // Store the execute function in the map
            executionMap.get(categoryName)?.set(subcommandName, execute);

            // Store cooldown if defined (optional feature)
            if (commandModule.cooldown && typeof commandModule.cooldown === "number") {
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
            await log.error(`Failed to load command from ${commandFile}:`, error, context);
          }
        }
      }

      const categoryExecutionMap = executionMap.get(categoryName);
      if (categoryExecutionMap && categoryExecutionMap.size === 0) {
        builders.delete(categoryName);
        executionMap.delete(categoryName);
        log.info(`Skipped top-level command /${categoryName} because it has no enabled subcommands`);
      }
    }

    const rootCommandFiles = await getCommandFiles(commandsPath);
    for (const commandFile of rootCommandFiles) {
      try {
        const commandModule = (await import(commandFile)) as LoadedCommandModule;
        const commandEnabled = await isCommandModuleEnabledForRegistration(commandModule, {
          commandFile,
          commandKind: "root",
        });
        if (!commandEnabled) {
          log.info(`Skipping disabled root command module: ${commandFile}`);
          continue;
        }

        if (!commandModule.configureCommand || !commandModule.execute) {
          log.warn(`Root command at ${commandFile} is missing required exports (configureCommand or execute)`);
          continue;
        }

        const commandBuilder = commandModule.configureCommand(new SlashCommandBuilder());
        const commandName = commandBuilder.name;

        if (!commandName) {
          log.warn(`Root command in ${commandFile} did not set a name`);
          continue;
        }

        if (builders.has(commandName)) {
          log.warn(
            `Skipping root command ${commandName} from ${commandFile}: a command category with that name already exists`,
          );
          continue;
        }

        applyRootCommandRestrictions(commandBuilder, commandModule);
        applyCommandLocalizations(commandBuilder, commandName, null, availableLocales);

        builders.set(commandName, commandBuilder);
        executionMap.set(commandName, new Map([[ROOT_COMMAND_EXECUTION_KEY, commandModule.execute]]));

        if (commandModule.cooldown && typeof commandModule.cooldown === "number") {
          cooldownMap.set(commandName, commandModule.cooldown);
        }

        commandCount++;
        log.info(`Loaded root command: ${commandName}`);
      } catch (error) {
        const context: ErrorContext = {
          errorType: "CommandLoadingError",
          metadata: {
            commandFile,
            commandKind: "root",
          },
        };
        await log.error(`Failed to load root command from ${commandFile}:`, error, context);
      }
    }

    // Convert builders to the registration data array
    const registrationData = Array.from(builders.values()).map((builder) => builder.toJSON() as ApplicationCommandData);

    log.success(`Successfully loaded ${commandCount} commands in ${builders.size} top-level command definitions`);
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
