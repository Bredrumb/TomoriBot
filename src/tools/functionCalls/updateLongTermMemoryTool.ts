/**
 * Update Long-Term Memory Tool
 *
 * Replaces an existing server or personal memory using its ID.
 * The ID is shown in context as "ID:123".
 */

import { sql } from "@/utils/db/client";
import { log, ColorCode } from "@/utils/misc/logger";
import {
	BaseTool,
	type ToolContext,
	type ToolResult,
	type ToolParameterSchema,
} from "../../types/tool/interfaces";
import { userSchema, PrivacyLevel } from "../../types/db/schema";
import { validateMemoryContent } from "../../utils/db/memoryLimits";
import { invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import { invalidateUserCache } from "../../utils/cache/userCache";
import { sendStandardEmbed } from "../../utils/discord/embedHelper";
import { convertMentions } from "../../utils/text/contextBuilder";
import { isBlacklisted, loadUserRow, getPrivacyLevel } from "@/utils/db/dbRead";

export class UpdateLongTermMemoryTool extends BaseTool {
	name = "update_long_term_memory";
	description =
		"Replace an existing long-term memory (server or personal) by ID. Use this when an existing memory needs revision. For server memories, provide the memory ID shown in context (e.g., ID:24). For personal memories, also provide the target user's Discord ID and nickname, and use the ID shown next to that user's memory.";
	category = "memory" as const;
	requiresFeatureFlag = "self_teaching";

	parameters: ToolParameterSchema = {
		type: "object",
		properties: {
			memory_id: {
				type: "number",
				description:
					"The memory ID to replace. Use the ID shown in context (e.g., ID:24).",
			},
			memory_content: {
				type: "string",
				description:
					"The full replacement memory content. This completely replaces the existing memory. Do NOT insert user IDs or any meta information here.",
			},
			target_user_discord_id: {
				type: "string",
				description:
					"If updating a personal memory, provide the target user's Discord ID (e.g., '123456789012345678'). This ID should be obtained from the user's information visible in the context.",
			},
			target_user_nickname: {
				type: "string",
				description:
					"If updating a personal memory, also provide the target user's nickname as seen in the current conversation or profile. This is used to confirm the target user.",
			},
		},
		required: ["memory_id", "memory_content"],
	};

	isAvailableFor(_provider: string): boolean {
		return true;
	}

	protected isEnabled(context: ToolContext): boolean {
		return context.tomoriState.config.self_teaching_enabled;
	}

	async execute(
		args: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		// Validate parameters
		const validation = this.validateParameters(args);
		if (!validation.isValid) {
			return {
				success: false,
				error: `Invalid parameters: ${validation.errors?.join(", ") || `Missing required parameters: ${validation.missingParams?.join(", ")}`}`,
				data: {
					status: "memory_update_failed_invalid_args",
					reason: `Invalid parameters: ${validation.errors?.join(", ") || `Missing required parameters: ${validation.missingParams?.join(", ")}`}`,
				},
			};
		}

		if (!this.isEnabled(context)) {
			return {
				success: false,
				error: "Self-teaching is disabled for this server",
				data: {
					status: "memory_update_failed_disabled",
					reason: "Self-teaching functionality is disabled for this server",
				},
			};
		}

		const memoryIdArg = args.memory_id;
		const memoryContentArg = args.memory_content;
		const targetUserDiscordIdArg = args.target_user_discord_id as
			| string
			| undefined;
		const targetUserNicknameArg = args.target_user_nickname as
			| string
			| undefined;

		if (
			typeof memoryIdArg !== "number" ||
			!Number.isSafeInteger(memoryIdArg) ||
			memoryIdArg <= 0
		) {
			return {
				success: false,
				error: "The 'memory_id' argument was missing or invalid.",
				data: {
					status: "memory_update_failed_invalid_args",
					reason: "The 'memory_id' argument was missing or invalid.",
				},
			};
		}

		if (typeof memoryContentArg !== "string" || !memoryContentArg.trim()) {
			return {
				success: false,
				error:
					"The 'memory_content' argument was missing, empty, or not a string.",
				data: {
					status: "memory_update_failed_invalid_args",
					reason:
						"The 'memory_content' argument was missing, empty, or not a string.",
				},
			};
		}

		const memoryId = Math.trunc(memoryIdArg);
		const newContent = memoryContentArg.trim();

		const contentValidation = validateMemoryContent(newContent);
		if (!contentValidation.isValid) {
			return {
				success: false,
				error:
					contentValidation.error === "CONTENT_EMPTY"
						? "Memory content cannot be empty"
						: `Memory content is too long. Maximum length is ${contentValidation.maxAllowed} characters.`,
				data: {
					status: "memory_update_failed_invalid_content",
					reason:
						contentValidation.error === "CONTENT_EMPTY"
							? "Memory content cannot be empty"
							: `Memory content exceeds maximum length of ${contentValidation.maxAllowed} characters`,
				},
			};
		}

		const targetUserDiscordId =
			typeof targetUserDiscordIdArg === "string"
				? targetUserDiscordIdArg.trim()
				: "";
		const targetUserNickname =
			typeof targetUserNicknameArg === "string"
				? targetUserNicknameArg.trim()
				: "";
		const hasTargetUserId = targetUserDiscordId.length > 0;
		const hasTargetUserNickname = targetUserNickname.length > 0;

		if (hasTargetUserId !== hasTargetUserNickname) {
			return {
				success: false,
				error:
					"The 'target_user_discord_id' and 'target_user_nickname' arguments must be provided together when updating a personal memory.",
				data: {
					status: "memory_update_failed_invalid_args",
					reason:
						"The 'target_user_discord_id' and 'target_user_nickname' arguments must be provided together when updating a personal memory.",
				},
			};
		}

		const isPersonalUpdate = hasTargetUserId && hasTargetUserNickname;

		const tomoriState = context.tomoriState;
		if (!tomoriState?.server_id) {
			log.error("Missing server_id in Tomori state for memory update");
			return {
				success: false,
				error: "Internal bot error: Missing server context",
				data: {
					status: "memory_update_failed_internal_error",
					reason: "Internal bot error: Missing server context",
				},
			};
		}

		const serverDiscId =
			"guild" in context.channel ? context.channel.guild.id : context.userId;
		if (!serverDiscId) {
			log.error("Missing server Discord ID for memory update");
			return {
				success: false,
				error: "Internal bot error: Missing server context",
				data: {
					status: "memory_update_failed_internal_error",
					reason: "Internal bot error: Missing server context",
				},
			};
		}

		try {
			if (!isPersonalUpdate) {
				// 1) Server memory update (server_id scoped)
				const [updatedServerMemory] = await sql`
					UPDATE server_memories
					SET content = ${newContent}, updated_at = CURRENT_TIMESTAMP
					WHERE server_memory_id = ${memoryId}
					  AND server_id = ${tomoriState.server_id}
					RETURNING server_memory_id, content, user_id
				`;

				if (updatedServerMemory) {
					const triggererRow = await loadUserRow(
						context.message?.author?.id || context.userId || "",
					);
					const processedMemoryContent = await convertMentions(
						newContent,
						context.client,
						serverDiscId,
						triggererRow?.user_nickname,
						tomoriState.tomori_nickname,
						tomoriState?.config.personal_memories_enabled,
					);

					await sendStandardEmbed(
						context.channel,
						context.locale,
						{
							color: ColorCode.MEMORY_UPDATE,
							titleKey: "genai.self_teach.server_memory_updated_title",
							descriptionKey:
								"genai.self_teach.server_memory_updated_description",
							descriptionVars: {
								memory_id: memoryId.toString(),
								memory_content:
									processedMemoryContent.length > 200
										? `${processedMemoryContent.substring(0, 197)}...`
										: processedMemoryContent,
							},
							footerKey: "genai.self_teach.server_memory_footer",
						},
						{
							webhook: context.webhook,
							personaUsername: context.personaUsername,
							personaAvatarUrl: context.personaAvatarUrl,
						},
					);

					invalidateTomoriStateCache(serverDiscId);

					return {
						success: true,
						message: "Server memory updated successfully",
						data: {
							status: "memory_updated_successfully",
							scope: "server_wide",
							memory_id: memoryId,
							content_saved: newContent,
						},
					};
				}

				return {
					success: false,
					error: "Memory ID not found in this server",
					data: {
						status: "memory_update_failed_not_found",
						reason: "Memory ID not found in this server",
					},
				};
			}

			// 2) Personal memory update (index-based, requires target user)
			if (targetUserDiscordId === context.client.user?.id) {
				return {
					success: false,
					error:
						"Cannot update personal memories about the bot. Use a server memory instead.",
					data: {
						status: "memory_update_failed_invalid_target",
						reason: "Personal memories cannot be updated about the bot itself.",
					},
				};
			}

			const targetUserRow = await loadUserRow(targetUserDiscordId);
			if (!targetUserRow || !targetUserRow.user_id) {
				return {
					success: false,
					error: `The user with Discord ID '${targetUserDiscordId}' was not found in Tomori's records`,
					data: {
						status: "memory_update_failed_user_not_found",
						reason: `The user with Discord ID '${targetUserDiscordId}' was not found in Tomori's records.`,
					},
				};
			}

			const guild =
				"guild" in context.channel ? context.channel.guild : undefined;
			let guildMember = null;
			if (guild) {
				guildMember =
					guild.members.cache.get(targetUserDiscordId) ||
					(await guild.members.fetch(targetUserDiscordId).catch(() => null));
				if (!guildMember) {
					return {
						success: false,
						error: "Personal memory owner is not in this server",
						data: {
							status: "memory_update_failed_invalid_scope",
							reason: "Personal memory owner is not in this server",
						},
					};
				}
			} else {
				const triggererDiscId =
					context.message?.author?.id || context.userId || "";
				if (triggererDiscId !== targetUserDiscordId) {
					return {
						success: false,
						error: "Personal memory owner is not in this conversation",
						data: {
							status: "memory_update_failed_invalid_scope",
							reason: "Personal memory owner is not in this conversation",
						},
					};
				}
			}

			// Two-factor nickname validation (same logic as remember_this_fact)
			const actualNicknameInDB = targetUserRow.user_nickname;
			const guildDisplayName = guildMember?.displayName?.toLowerCase();
			const discordUsername = guildMember?.user?.username?.toLowerCase();
			const providedNicknameLower = targetUserNickname.toLowerCase();
			const dbNicknameLower = actualNicknameInDB.toLowerCase();
			const nicknameValid =
				dbNicknameLower === providedNicknameLower ||
				providedNicknameLower === guildDisplayName ||
				dbNicknameLower === guildDisplayName ||
				providedNicknameLower === discordUsername;

			if (!nicknameValid) {
				return {
					success: false,
					error: `The provided nickname '${targetUserNickname}' does not match the records for user ID '${targetUserDiscordId}'`,
					data: {
						status: "memory_update_failed_nickname_mismatch",
						reason: `The provided nickname '${targetUserNickname}' does not match the records for user ID '${targetUserDiscordId}'.`,
					},
				};
			}

			const userPrivacyLevel = await getPrivacyLevel(targetUserDiscordId);
			if (
				userPrivacyLevel === PrivacyLevel.PARTIAL ||
				userPrivacyLevel === PrivacyLevel.FULL
			) {
				return {
					success: false,
					error: `Cannot update personal memory: User ${targetUserNickname} has privacy restrictions.`,
					data: {
						status: "memory_update_failed_privacy_restricted",
						reason: `The user ${targetUserNickname} has chosen to restrict personal memory storage.`,
					},
				};
			}

			const personalMemories = targetUserRow.personal_memories ?? [];
			if (memoryId < 1 || memoryId > personalMemories.length) {
				return {
					success: false,
					error: "Personal memory ID not found",
					data: {
						status: "memory_update_failed_not_found",
						reason: "Personal memory ID not found",
					},
				};
			}

			const [updatedUser] = await sql`
				UPDATE users
				SET personal_memories[${memoryId}] = ${newContent}
				WHERE user_id = ${targetUserRow.user_id}
				RETURNING *
			`;

			const validatedUpdatedUser = userSchema.safeParse(updatedUser);
			if (!validatedUpdatedUser.success || !updatedUser) {
				log.error("Failed to validate user row after personal memory update");
				return {
					success: false,
					error: "Failed to update personal memory",
					data: {
						status: "memory_update_failed_db_error",
						reason: "Failed to update personal memory",
					},
				};
			}

			invalidateUserCache(targetUserDiscordId);
			const userDisplayName =
				guildMember?.displayName ||
				guildMember?.user.username ||
				targetUserRow.user_nickname ||
				targetUserRow.user_disc_id;

			const processedMemoryContent = await convertMentions(
				newContent,
				context.client,
				serverDiscId,
				userDisplayName,
				tomoriState.tomori_nickname,
				tomoriState?.config.personal_memories_enabled,
			);

			const isUserBlacklisted = guild
				? await isBlacklisted(serverDiscId, targetUserDiscordId)
				: false;
			const footerKey = !tomoriState.config.personal_memories_enabled
				? "genai.self_teach.personal_memory_footer_personalization_disabled"
				: isUserBlacklisted
					? "genai.self_teach.personal_memory_footer_user_blacklisted"
					: "genai.self_teach.personal_memory_footer_manage";

			await sendStandardEmbed(
				context.channel,
				context.locale,
				{
					color: ColorCode.MEMORY_UPDATE,
					titleKey: "genai.self_teach.personal_memory_updated_title",
					descriptionKey:
						"genai.self_teach.personal_memory_updated_description",
					descriptionVars: {
						user_nickname: userDisplayName,
						memory_id: memoryId.toString(),
						memory_content:
							processedMemoryContent.length > 200
								? `${processedMemoryContent.substring(0, 197)}...`
								: processedMemoryContent,
					},
					footerKey,
				},
				{
					webhook: context.webhook,
					personaUsername: context.personaUsername,
					personaAvatarUrl: context.personaAvatarUrl,
				},
			);

			return {
				success: true,
				message: "Personal memory updated successfully",
				data: {
					status: "memory_updated_successfully",
					scope: "target_user",
					memory_id: memoryId,
					content_saved: newContent,
					target_user_discord_id: targetUserDiscordId,
				},
			};
		} catch (error) {
			await log.error("Error during long-term memory update", error, {
				errorType: "MEMORY_UPDATE_ERROR",
				metadata: { memoryId },
			});
			return {
				success: false,
				error: "Error occurred while updating memory",
				data: {
					status: "memory_update_failed_error",
					reason: "Error occurred while updating memory",
				},
			};
		}
	}
}
