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
export type CommandExecutionMap = Map<string, Map<string, CommandExecuteFunction>>;

/**
 * Map for command cooldowns (category -> duration)
 */
export type CommandCooldownMap = Map<string, number>;
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

  const novelAiImageTagsMatch = key.match(/^commands\.novelai\.image-tags\.([a-z0-9-]+)\.description$/);
  if (novelAiImageTagsMatch) {
    aliases.push(`commands.novelai.tags.${novelAiImageTagsMatch[1]}.description`);
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
    const localizedDesc = localizeWithAliases(locale, localizationKey);
    if (localizedDesc && localizedDesc !== localizationKey) {
      subcommandLocalizationsMap[locale] = localizedDesc;
    }
  }

  if (Object.keys(subcommandLocalizationsMap).length > 0) {
    configuredSubcommand.setDescriptionLocalizations(subcommandLocalizationsMap);
  }

  // 2. Apply option description localizations
  if (configuredSubcommand.options) {
    for (const option of configuredSubcommand.options) {
      if (option.name) {
        // Build localization key for option description
        const optionLocalizationKey = `commands.${categoryName}.${subcommandPath}.${option.name}_description`;
        const optionLocalizationsMap: { [key: string]: string } = {};

        for (const locale of availableLocales) {
          let localizedDesc = localizeWithAliases(locale, optionLocalizationKey);
          const fallbackKey = `commands.${categoryName}.${subcommandPath}.option_description`;

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
          option.setDescriptionLocalizations(optionLocalizationsMap);
        }

        // 3. Apply choice name localizations
        if ("choices" in option && Array.isArray(option.choices) && option.choices.length > 0) {
          for (const choice of option.choices) {
            if (choice.value === undefined || choice.value === null) continue;

            const choiceValue = String(choice.value);
            const choiceLocalizationKeys = [
              `commands.${categoryName}.${subcommandPath}.${option.name}_choice_${choiceValue}`,
              `commands.${categoryName}.${subcommandPath}.${choiceValue}_option`,
              `commands.${categoryName}.${subcommandPath}.${option.name}_${choiceValue}`,
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
    const availableLocales = getSupportedLocales().filter((locale) => locale !== "en-US");
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

              // Get all command files in this group
              const groupCommandFiles = getAllFiles(itemPath);

              // Process each command in the group
              for (const commandFile of groupCommandFiles) {
                try {
                  // Import the command module (needs to be sync for builder pattern)
                  // We'll use dynamic import but handle it carefully
                  const commandModule = require(commandFile);

                  // Validate exports
                  if (!commandModule.configureSubcommand || !commandModule.execute) {
                    log.warn(`Command at ${commandFile} is missing required exports`);
                    continue;
                  }

                  let subcommandName = "";

                  // Add subcommand to group
                  group.addSubcommand((subcommand: SlashCommandSubcommandBuilder) => {
                    const configuredSubcommand = commandModule.configureSubcommand(subcommand);
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
                  });

                  if (!subcommandName) {
                    log.warn(`Subcommand in ${commandFile} did not set a name`);
                    continue;
                  }

                  // Store execute function with group.subcommand format
                  const executionKey = `${groupName}.${subcommandName}`;
                  executionMap.get(categoryName)?.set(executionKey, commandModule.execute);

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
        else if (item.isFile() && itemPath.endsWith(".ts")) {
          const commandFile = itemPath;

          try {
            // Import the command module
            const commandModule = await import(commandFile);

            // Validate exports: must have configureSubcommand and execute
            if (!commandModule.configureSubcommand || !commandModule.execute) {
              log.warn(`Command at ${commandFile} is missing required exports (configureSubcommand or execute)`);
              continue;
            }

            // Use a temporary variable to store the subcommand name
            let subcommandName = "";

            // Add the subcommand to the category builder
            categoryBuilder.addSubcommand((subcommand: SlashCommandSubcommandBuilder) => {
              // Call the module's configureSubcommand function and capture its result
              const configuredSubcommand = commandModule.configureSubcommand(subcommand);
              // Get the name that was set
              subcommandName = configuredSubcommand.name;

              // Apply subcommand localizations
              if (subcommandName) {
                applySubcommandLocalizations(configuredSubcommand, categoryName, subcommandName, availableLocales);
              }

              return configuredSubcommand;
            });

            if (!subcommandName) {
              log.warn(`Subcommand in ${commandFile} did not set a name`);
              continue;
            }

            // Store the execute function in the map
            executionMap.get(categoryName)?.set(subcommandName, commandModule.execute);

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
    }

    // Convert builders to the registration data array
    const registrationData = Array.from(builders.values()).map((builder) => builder.toJSON() as ApplicationCommandData);

    log.success(`Successfully loaded ${commandCount} subcommands in ${builders.size} categories`);
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
