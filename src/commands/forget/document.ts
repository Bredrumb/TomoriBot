import {
	MessageFlags,
	type ChatInputCommandInteraction,
	type ButtonInteraction,
	type ModalSubmitInteraction,
	type Client,
	type SlashCommandSubcommandBuilder,
} from "discord.js";
import { sql } from "@/utils/db/client";
import { localizer } from "../../utils/text/localizer";
import { log, ColorCode } from "../../utils/misc/logger";
import {
	replyInfoEmbed,
	promptWithPaginatedModal,
	safeSelectOptionText,
} from "../../utils/discord/interactionHelper";
import {
	getCachedTomoriState,
	invalidateTomoriStateCache,
} from "../../utils/cache/tomoriStateCache";
import type { SelectOption } from "../../types/discord/modal";
import type { ErrorContext, TomoriState, UserRow } from "../../types/db/schema";

const MODAL_CUSTOM_ID = "forget_document_modal";
const DOCUMENT_SELECT_ID = "document_select";

async function performDocumentRemoval(
	tomoriState: TomoriState,
	documentId: number,
	userData: UserRow,
	replyInteraction:
		| ChatInputCommandInteraction
		| ButtonInteraction
		| ModalSubmitInteraction,
	locale: string,
): Promise<void> {
	const [deletedRow] = await sql`
		DELETE FROM documents
		WHERE document_id = ${documentId}
		RETURNING document_name
	`;

	if (!deletedRow?.document_name) {
		const context: ErrorContext = {
			tomoriId: tomoriState.tomori_id,
			serverId: tomoriState.server_id,
			userId: userData.user_id,
			errorType: "DatabaseUpdateError",
			metadata: {
				command: "forget document",
				documentId,
			},
		};
		await log.error(
			"Failed to delete document row",
			new Error("Document deletion returned no rows"),
			context,
		);
		await replyInfoEmbed(replyInteraction, locale, {
			titleKey: "general.errors.update_failed_title",
			descriptionKey: "general.errors.update_failed_description",
			color: ColorCode.ERROR,
		});
		return;
	}

	if (replyInteraction.guildId) {
		invalidateTomoriStateCache(replyInteraction.guildId);
	}

	await replyInfoEmbed(replyInteraction, locale, {
		titleKey: "commands.forget.document.success_title",
		descriptionKey: "commands.forget.document.success_description",
		descriptionVars: {
			name: deletedRow.document_name,
		},
		color: ColorCode.SUCCESS,
	});
}

export const configureSubcommand = (
	subcommand: SlashCommandSubcommandBuilder,
) =>
	subcommand
		.setName("document")
		.setDescription(localizer("en-US", "commands.forget.document.description"));

export async function execute(
	_client: Client,
	interaction: ChatInputCommandInteraction,
	userData: UserRow,
	locale: string,
): Promise<void> {
	if (!interaction.channel) {
		await replyInfoEmbed(interaction, locale, {
			titleKey: "general.errors.channel_only_title",
			descriptionKey: "general.errors.channel_only_description",
			color: ColorCode.ERROR,
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	let tomoriState: TomoriState | null = null;

	try {
		tomoriState = await getCachedTomoriState(
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

		const hasManagePermission =
			interaction.memberPermissions?.has("ManageGuild") ?? false;
		if (!tomoriState.config.server_memteaching_enabled && !hasManagePermission) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.teach.document.teaching_disabled_title",
				descriptionKey: "commands.teach.document.teaching_disabled_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const documents = await sql<
			Array<{ document_id: number; document_name: string }>
		>`
			SELECT document_id, document_name
			FROM documents
			WHERE server_id = ${tomoriState.server_id}
			ORDER BY created_at DESC
		`;

		if (!documents || documents.length === 0) {
			await replyInfoEmbed(interaction, locale, {
				titleKey: "commands.forget.document.none_title",
				descriptionKey: "commands.forget.document.none_description",
				color: ColorCode.WARN,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const documentOptions: SelectOption[] = documents.map((doc) => ({
			label: safeSelectOptionText(doc.document_name),
			value: doc.document_id.toString(),
		}));

		const modalResult = await promptWithPaginatedModal(interaction, locale, {
			modalCustomId: MODAL_CUSTOM_ID,
			modalTitleKey: "commands.forget.document.modal_title",
			components: [
				{
					customId: DOCUMENT_SELECT_ID,
					labelKey: "commands.forget.document.select_label",
					descriptionKey: "commands.forget.document.select_description",
					placeholder: "commands.forget.document.select_placeholder",
					required: true,
					options: documentOptions,
				},
			],
		});

		if (modalResult.outcome !== "submit") {
			log.info(
				`Document removal modal ${modalResult.outcome} for user ${userData.user_id}`,
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

		const selectedIdStr = modalResult.values[DOCUMENT_SELECT_ID];
		if (!selectedIdStr) {
			await replyInfoEmbed(modalResult.interaction, locale, {
				titleKey: "commands.forget.document.none_title",
				descriptionKey: "commands.forget.document.none_description",
				color: ColorCode.ERROR,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const modalSubmitInteraction = modalResult.interaction;
		const selectedId = Number.parseInt(selectedIdStr, 10);

		await performDocumentRemoval(
			tomoriState,
			selectedId,
			userData,
			modalSubmitInteraction,
			locale,
		);
	} catch (error) {
		const context: ErrorContext = {
			userId: userData.user_id,
			serverId: tomoriState?.server_id,
			tomoriId: tomoriState?.tomori_id,
			errorType: "CommandExecutionError",
			metadata: {
				command: "forget document",
				guildId: interaction.guild?.id,
				executorDiscordId: interaction.user.id,
			},
		};
		await log.error(
			`Unexpected error in /forget document for user ${userData.user_disc_id}`,
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
