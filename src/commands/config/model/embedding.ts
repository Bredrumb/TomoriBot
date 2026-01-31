import type {
	ChatInputCommandInteraction,
	Client,
	SlashCommandSubcommandBuilder,
} from "discord.js";
import { MessageFlags } from "discord.js";
import { sql } from "@/utils/db/client";
import {
	getCachedTomoriState,
	invalidateTomoriStateCache,
} from "../../../utils/cache/tomoriStateCache";
import { localizer } from "../../../utils/text/localizer";
import { log, ColorCode } from "../../../utils/misc/logger";
import {
	replyInfoEmbed,
	promptWithRawModal,
	safeSelectOptionText,
} from "../../../utils/discord/interactionHelper";
import type {
	ErrorContext,
	UserRow,
	EmbeddingModelRow,
} from "../../../types/db/schema";
import type { SelectOption } from "../../../types/discord/modal";
import { decryptApiKey } from "../../../utils/security/crypto";
import { getMemoryLimits } from "../../../utils/db/memoryLimits";
import {
	loadEmbeddingModelById,
	loadAvailableEmbeddingModelsForProvider,
} from "../../../utils/db/dbRead";
import { reembedServerDocuments } from "../../../utils/documents/documentService";

const MODAL_CUSTOM_ID = "config_model_embedding_modal";
const MODEL_SELECT_ID = "model_select";

function getLocalizedDescription(
	model: EmbeddingModelRow,
	locale: string,
): string {
	const normalizedLocale = locale.toLowerCase().split("-")[0];
	const description =
		normalizedLocale === "ja" ? model.ja_description : model.model_description;
	const baseDescription =
		description || model.model_description || `${model.provider} model`;

	const flags: string[] = [];
	if (model.is_default) flags.push("DEFAULT");
	const flagPrefix = flags.length > 0 ? `(${flags.join("+")}) ` : "";
	return `${flagPrefix}${baseDescription}`;
}

export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("embedding")
		.setDescription(
			localizer("en-US", "commands.config.model.embedding.description"),
		);

export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	userData: UserRow,
	locale: string,
): Promise<void> {
	if (!interaction.channel) {
		await replyInfoEmbed(interaction, userData.language_pref, {
			titleKey: "general.errors.channel_only_title",
			descriptionKey: "general.errors.channel_only_description",
			color: ColorCode.ERROR,
		});
		return;
	}

	const tomoriState = await getCachedTomoriState(
		interaction.guild?.id ?? interaction.user.id,
	);
	if (!tomoriState) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.tomori_not_setup_title",
			descriptionKey: "general.errors.tomori_not_setup_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	if (!tomoriState.config.api_key) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.config.model.embedding.no_api_key_title",
			descriptionKey: "commands.config.model.embedding.no_api_key_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const currentProvider = tomoriState.llm.llm_provider;
	const availableModels = await loadAvailableEmbeddingModelsForProvider(
		currentProvider,
		false,
	);

	if (!availableModels || availableModels.length === 0) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "commands.config.model.embedding.no_models_title",
			descriptionKey: "commands.config.model.embedding.no_models_description",
			descriptionVars: { provider: currentProvider },
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	let modalSubmitInteraction:
		| import("discord.js").ModalSubmitInteraction
		| undefined;
	let selectedModel: EmbeddingModelRow | null = null;

	try {
		const modelSelectOptions: SelectOption[] = [];
		for (const model of availableModels) {
			if (model.embedding_model_id === null || model.embedding_model_id === undefined) {
				continue;
			}
			modelSelectOptions.push({
				label: safeSelectOptionText(model.codename),
				value: safeSelectOptionText(model.embedding_model_id.toString()),
				description: safeSelectOptionText(
					getLocalizedDescription(model, userData.language_pref),
				),
			});
		}

		if (modelSelectOptions.length === 0) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.config.model.embedding.no_models_title",
				descriptionKey: "commands.config.model.embedding.no_models_description",
				descriptionVars: { provider: currentProvider },
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const modalResult = await promptWithRawModal(
			interaction,
			locale,
			{
				modalCustomId: MODAL_CUSTOM_ID,
				modalTitleKey: "commands.config.model.embedding.modal_title",
				components: [
					{
						customId: MODEL_SELECT_ID,
						labelKey: "commands.config.model.embedding.select_label",
						descriptionKey: "commands.config.model.embedding.select_description",
						placeholder: "commands.config.model.embedding.select_placeholder",
						required: true,
						options: modelSelectOptions,
					},
				],
			},
			MessageFlags.Ephemeral,
		);

		if (modalResult.outcome !== "submit") {
			log.info(
				`Embedding model selection modal ${modalResult.outcome} for user ${userData.user_id}`,
			);
			return;
		}

		if (!modalResult.interaction || !modalResult.values) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "general.errors.unknown_error_title",
				descriptionKey: "general.errors.unknown_error_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		modalSubmitInteraction = modalResult.interaction;
		const selectedModelIdStr = modalResult.values[MODEL_SELECT_ID];
		if (!selectedModelIdStr) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "commands.config.model.embedding.invalid_model_title",
				descriptionKey:
					"commands.config.model.embedding.invalid_model_description",
				color: ColorCode.ERROR,
			});
			return;
		}
		const selectedModelId = Number.parseInt(selectedModelIdStr, 10);
		selectedModel =
			availableModels.find(
				(model) => model.embedding_model_id === selectedModelId,
			) ?? null;

		if (!selectedModel?.embedding_model_id) {
			const context: ErrorContext = {
				tomoriId: tomoriState.tomori_id,
				serverId: tomoriState.server_id,
				userId: userData.user_id,
				errorType: "CommandExecutionError",
				metadata: {
					command: "config model embedding",
					guildId: interaction.guild?.id ?? interaction.user.id,
					requestedModelId: selectedModelIdStr,
				},
			};
			await log.error(
				"Selected embedding model ID not found in available models from DB",
				new Error("Invalid model selection despite modal choices"),
				context,
			);

			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "commands.config.model.embedding.invalid_model_title",
				descriptionKey:
					"commands.config.model.embedding.invalid_model_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		if (
			selectedModel.embedding_model_id ===
			tomoriState.config.embedding_model_id
		) {
			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "commands.config.model.embedding.already_selected_title",
				descriptionKey:
					"commands.config.model.embedding.already_selected_description",
				descriptionVars: {
					model_name: selectedModel.codename,
				},
				color: ColorCode.WARN,
			});
			return;
		}

		const currentEmbeddingModel =
			tomoriState.config.embedding_model_id !== null &&
			tomoriState.config.embedding_model_id !== undefined
				? await loadEmbeddingModelById(tomoriState.config.embedding_model_id)
				: null;
		const shouldReembed =
			currentEmbeddingModel?.model_family &&
			currentEmbeddingModel.model_family !== selectedModel.model_family;

		if (shouldReembed) {
			const [docCountRow] = await sql`
				SELECT COUNT(*) as doc_count
				FROM documents
				WHERE server_id = ${tomoriState.server_id}
			`;
			const docCount = Number(docCountRow?.doc_count || 0);
			if (docCount > 0) {
				await replyInfoEmbed(modalSubmitInteraction, locale, {
					titleKey:
						"commands.config.model.embedding.reembed_started_title",
					descriptionKey:
						"commands.config.model.embedding.reembed_started_description",
					color: ColorCode.INFO,
				});

				const apiKey = tomoriState.config.api_key;
				if (!apiKey) {
					await replyInfoEmbed(modalSubmitInteraction, locale, {
						titleKey: "commands.config.model.embedding.no_api_key_title",
						descriptionKey:
							"commands.config.model.embedding.no_api_key_description",
						color: ColorCode.ERROR,
					});
					return;
				}
				const decryptedKey = await decryptApiKey(
					apiKey,
					tomoriState.config.key_version || 1,
				);
				const limits = getMemoryLimits();
				await reembedServerDocuments({
					serverId: tomoriState.server_id,
					embeddingModel: selectedModel,
					apiKey: decryptedKey,
					chunkSize: limits.documentChunkSize,
					chunkOverlap: limits.documentChunkOverlap,
				});
			}
		}

		const [updatedRow] = await sql`
			UPDATE tomori_configs
			SET embedding_model_id = ${selectedModel.embedding_model_id}
			WHERE server_id = ${tomoriState.server_id}
			RETURNING *
		`;

		if (!updatedRow) {
			const context: ErrorContext = {
				tomoriId: tomoriState.tomori_id,
				serverId: tomoriState.server_id,
				userId: userData.user_id,
				errorType: "DatabaseUpdateError",
				metadata: {
					command: "config model embedding",
					guildId: interaction.guild?.id ?? interaction.user.id,
					selectedModelCodename: selectedModel.codename,
					targetEmbeddingModelId: selectedModel.embedding_model_id,
				},
			};
			await log.error(
				"Failed to update embedding model config after DB update",
				new Error("Database update returned no rows"),
				context,
			);

			await replyInfoEmbed(modalSubmitInteraction, locale, {
				titleKey: "general.errors.update_failed_title",
				descriptionKey: "general.errors.update_failed_description",
				color: ColorCode.ERROR,
			});
			return;
		}

		invalidateTomoriStateCache(interaction.guild?.id ?? interaction.user.id);

		const previousModel = currentEmbeddingModel?.codename
			? currentEmbeddingModel.codename
			: localizer(locale, "commands.config.model.embedding.current_none");

		await replyInfoEmbed(modalSubmitInteraction, locale, {
			titleKey: "commands.config.model.embedding.success_title",
			descriptionKey: "commands.config.model.embedding.success_description",
			descriptionVars: {
				model_name: selectedModel.codename,
				previous_model: previousModel,
			},
			color: ColorCode.SUCCESS,
		});
	} catch (error) {
		const context: ErrorContext = {
			userId: userData.user_id,
			serverId: tomoriState.server_id,
			tomoriId: tomoriState.tomori_id,
			errorType: "CommandExecutionError",
			metadata: {
				command: "config model embedding",
				guildId: interaction.guild?.id ?? interaction.user.id,
				executorDiscordId: interaction.user.id,
				targetEmbeddingModelIdAttempted: selectedModel?.embedding_model_id,
			},
		};
		await log.error(
			`Error executing /config model embedding for user ${userData.user_disc_id}`,
			error as Error,
			context,
		);

		const replyTarget = modalSubmitInteraction ?? interaction;
		await replyInfoEmbed(replyTarget, locale, {
			titleKey: "general.errors.unknown_error_title",
			descriptionKey: "general.errors.unknown_error_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
	}
}
