import {
	MessageFlags,
	type ChatInputCommandInteraction,
	type Client,
	type SlashCommandSubcommandBuilder,
} from "discord.js";
import { getCachedTomoriState, invalidateTomoriStateCache } from "../../../utils/cache/tomoriStateCache";
import { localizer } from "../../../utils/text/localizer";
import { log, ColorCode } from "../../../utils/misc/logger";
import { replyInfoEmbed } from "../../../utils/discord/interactionHelper";
import type { UserRow, ErrorContext } from "../../../types/db/schema";
import { ProviderFactory } from "../../../utils/provider/providerFactory";
import {
	addRotationKey,
	purgeRotationKeys,
	getRotationKeyCount,
} from "../../../utils/security/keyRotation";
import { isCustomProvider } from "../../../utils/discord/customProviderModal";

/** Action choices for the rotation command */
const ACTION_ADD = "add";
const ACTION_PURGE = "purge";

/**
 * Configure the subcommand for API key rotation management
 * @param subcommand - Discord slash command subcommand builder
 * @returns Configured subcommand builder
 */
export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("rotation")
		.setDescription(
			localizer("en-US", "commands.config.apikey.rotation.description"),
		)
		.addStringOption((option) =>
			option
				.setName("action")
				.setDescription(
					localizer("en-US", "commands.config.apikey.rotation.action_description"),
				)
				.setRequired(true)
				.addChoices(
					{
						name: localizer("en-US", "commands.config.apikey.rotation.action_add"),
						value: ACTION_ADD,
					},
					{
						name: localizer("en-US", "commands.config.apikey.rotation.action_purge"),
						value: ACTION_PURGE,
					},
				),
		)
		.addStringOption((option) =>
			option
				.setName("key")
				.setDescription(
					localizer("en-US", "commands.config.apikey.rotation.key_description"),
				)
				.setRequired(false),
		);

/**
 * Manages API key rotation pool for load balancing and failover.
 * Supports adding keys to the rotation pool and purging all rotation keys.
 *
 * @param _client - Discord client instance
 * @param interaction - Command interaction
 * @param userData - User data from database
 * @param locale - Locale of the interaction
 */
export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	userData: UserRow,
	locale: string,
): Promise<void> {
	// 1. Ensure command is run in a channel context
	if (!interaction.channel) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.channel_only_title",
			descriptionKey: "general.errors.channel_only_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 2. Get command options
	const action = interaction.options.getString("action", true);
	const apiKey = interaction.options.getString("key", false);

	// 3. Load Tomori state
	const serverId = interaction.guild?.id ?? interaction.user.id;
	const tomoriState = await getCachedTomoriState(serverId);

	if (!tomoriState) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.tomori_not_setup_title",
			descriptionKey: "general.errors.tomori_not_setup_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 4. Ensure a main API key is configured first
	if (!tomoriState.config.api_key) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.config.apikey.rotation.no_main_key_title",
			descriptionKey: "commands.config.apikey.rotation.no_main_key_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 5. Check if custom provider (rotation not supported)
	const currentProvider = tomoriState.llm.llm_provider.toLowerCase();
	if (isCustomProvider(currentProvider)) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.config.apikey.rotation.custom_provider_title",
			descriptionKey: "commands.config.apikey.rotation.custom_provider_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	try {
		// 6. Handle action: add or purge
		if (action === ACTION_ADD) {
			await handleAddAction(interaction, tomoriState, apiKey, locale, userData);
		} else if (action === ACTION_PURGE) {
			await handlePurgeAction(interaction, tomoriState, locale);
		} else {
			// Unknown action (shouldn't happen with choices)
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.unknown_error_title",
				descriptionKey: "general.errors.unknown_error_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
		}
	} catch (error) {
		// Error handling
		const context: ErrorContext = {
			userId: userData.user_id,
			serverId: tomoriState.server_id,
			tomoriId: tomoriState.tomori_id,
			errorType: "CommandExecutionError",
			metadata: {
				command: "config apikey rotation",
				action,
				guildId: interaction.guild?.id,
				executorDiscordId: interaction.user.id,
			},
		};
		await log.error(
			`Error executing /config apikey rotation for user ${userData.user_disc_id}`,
			error as Error,
			context,
		);

		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
	}
}

/**
 * Handles the "add" action - validates and adds a new API key to the rotation pool
 */
async function handleAddAction(
	interaction: ChatInputCommandInteraction,
	tomoriState: NonNullable<Awaited<ReturnType<typeof getCachedTomoriState>>>,
	apiKey: string | null,
	locale: string,
	userData: UserRow,
): Promise<void> {
	// 1. Validate API key is provided
	if (!apiKey) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.config.apikey.rotation.key_required_title",
			descriptionKey: "commands.config.apikey.rotation.key_required_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 2. Basic key length validation
	if (apiKey.length < 10) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.config.apikey.set.invalid_key_title",
			descriptionKey: "commands.config.apikey.set.invalid_key_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const currentProvider = tomoriState.llm.llm_provider.toLowerCase();

	// 3. Validate the API key with the provider
	try {
		const provider = await ProviderFactory.getProvider({
			llm: { llm_provider: currentProvider, llm_codename: "" },
			server_id: tomoriState.server_id,
			tomori_id: tomoriState.tomori_id,
			config: tomoriState.config,
			// biome-ignore lint/suspicious/noExplicitAny: Minimal object structure for factory pattern
		} as any);

		const validationResult = await provider.validateApiKey(apiKey);

		if (!validationResult.valid) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.config.apikey.set.key_validation_failed_title",
				description: validationResult.error?.message || localizer(locale, "commands.config.apikey.set.key_validation_failed_description"),
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
	} catch (error) {
		log.error(`Error validating rotation API key for provider ${currentProvider}`, error as Error);
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.config.apikey.set.validation_error_title",
			descriptionKey: "commands.config.apikey.set.validation_error_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 4. Add the key to the rotation pool
	const success = await addRotationKey(
		tomoriState.server_id,
		currentProvider,
		apiKey,
	);

	if (!success) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.update_failed_title",
			descriptionKey: "general.errors.update_failed_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 5. Invalidate cache
	const serverId = interaction.guild?.id ?? interaction.user.id;
	invalidateTomoriStateCache(serverId);

	// 6. Get updated count for success message
	const keyCount = await getRotationKeyCount(tomoriState.server_id);

	// 7. Success message
	await replyInfoEmbed(interaction, locale, {
		titleKey: "commands.config.apikey.rotation.add_success_title",
		descriptionKey: "commands.config.apikey.rotation.add_success_description",
		descriptionVars: {
			count: String(keyCount),
			provider: currentProvider.charAt(0).toUpperCase() + currentProvider.slice(1),
		},
		color: ColorCode.SUCCESS,
		flags: MessageFlags.Ephemeral,
	});

	log.success(
		`User ${userData.user_disc_id} added rotation key for server ${tomoriState.server_id} (total: ${keyCount})`,
	);
}

/**
 * Handles the "purge" action - removes all rotation keys from the pool
 */
async function handlePurgeAction(
	interaction: ChatInputCommandInteraction,
	tomoriState: NonNullable<Awaited<ReturnType<typeof getCachedTomoriState>>>,
	locale: string,
): Promise<void> {
	// 1. Check if there are any rotation keys to purge
	const currentCount = await getRotationKeyCount(tomoriState.server_id);

	if (currentCount === 0) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.config.apikey.rotation.no_keys_title",
			descriptionKey: "commands.config.apikey.rotation.no_keys_description",
			color: ColorCode.WARN,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// 2. Purge all rotation keys
	const deletedCount = await purgeRotationKeys(tomoriState.server_id);

	// 3. Invalidate cache
	const serverId = interaction.guild?.id ?? interaction.user.id;
	invalidateTomoriStateCache(serverId);

	// 4. Success message
	await replyInfoEmbed(interaction, locale, {
		titleKey: "commands.config.apikey.rotation.purge_success_title",
		descriptionKey: "commands.config.apikey.rotation.purge_success_description",
		descriptionVars: {
			count: String(deletedCount),
		},
		color: ColorCode.SUCCESS,
		flags: MessageFlags.Ephemeral,
	});

	log.success(
		`Purged ${deletedCount} rotation key(s) for server ${tomoriState.server_id}`,
	);
}
