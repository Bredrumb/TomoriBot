/**
 * Update Long-Term Memory Tool
 *
 * Replaces an existing server or personal memory using its ID.
 * The ID is shown in context as "ID:123".
 */

import { sql } from "@/utils/db/client";
import { log, ColorCode } from "@/utils/misc/logger";
import { BaseTool, type ToolContext, type ToolResult, type ToolParameterSchema } from "../../types/tool/interfaces";
import { PrivacyLevel } from "../../types/db/schema";
import { validateMemoryContent } from "../../utils/db/memoryLimits";
import { invalidateTomoriStateCache } from "../../utils/cache/tomoriStateCache";
import { invalidateUserCache } from "../../utils/cache/userCache";
import { sendStandardEmbed } from "../../utils/discord/embedHelper";
import { convertMentions } from "../../utils/text/contextBuilder";
import { sanitizeUnknownTemplatePlaceholders } from "../../utils/text/stringHelper";
import { isBlacklisted, loadUserRow, getPrivacyLevel, loadPersonalMemoriesForUserLineage } from "@/utils/db/dbRead";
import { resolveUserTarget } from "@/utils/discord/targetResolver";

export class UpdateLongTermMemoryTool extends BaseTool {
  name = "update_long_term_memory";
  description =
    "Replace or delete an existing long-term memory (server or personal) by ID. Use this when an existing memory needs revision, or leave memory_content blank to delete the targeted memory instead. For server memories, provide the memory ID shown in context (e.g., ID:24). For personal memories, also provide the target user's name as shown in the conversation or current server, and use the ID shown next to that user's memory.";
  category = "memory" as const;
  requiresFeatureFlag = "self_teaching";

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      memory_id: {
        type: "number",
        description: "The memory ID to replace. Use the ID shown in context (e.g., ID:24).",
      },
      memory_content: {
        type: "string",
        description:
          "The full replacement memory content. This completely replaces the existing memory. If this is empty or blank, delete the targeted memory instead. Do NOT insert user IDs or any meta information here.",
      },
      target_user: {
        type: "string",
        description:
          "If updating a personal memory, provide the target user's name as seen in the current conversation or server. Use natural names, not IDs.",
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

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
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
    const targetUserArg = args.target_user as string | undefined;
    const legacyTargetUserDiscordIdArg = args.target_user_discord_id as string | undefined;
    const legacyTargetUserNicknameArg = args.target_user_nickname as string | undefined;
    const requestedTargetUser =
      targetUserArg?.trim() || legacyTargetUserNicknameArg?.trim() || legacyTargetUserDiscordIdArg?.trim();

    if (typeof memoryIdArg !== "number" || !Number.isSafeInteger(memoryIdArg) || memoryIdArg <= 0) {
      return {
        success: false,
        error: "The 'memory_id' argument was missing or invalid.",
        data: {
          status: "memory_update_failed_invalid_args",
          reason: "The 'memory_id' argument was missing or invalid.",
        },
      };
    }

    if (typeof memoryContentArg !== "string") {
      return {
        success: false,
        error: "The 'memory_content' argument was missing or not a string.",
        data: {
          status: "memory_update_failed_invalid_args",
          reason: "The 'memory_content' argument was missing or not a string.",
        },
      };
    }

    const memoryId = Math.trunc(memoryIdArg);
    // Sanitize unknown {word} placeholders before saving (e.g. {bredrumb} → bredrumb)
    const newContent = sanitizeUnknownTemplatePlaceholders(memoryContentArg.trim());
    const isDeleteRequested = newContent.length === 0;

    const contentValidation = isDeleteRequested ? { isValid: true } : validateMemoryContent(newContent);
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

    let resolvedTargetUserId: string | undefined;
    let resolvedTargetUserLabel: string | undefined;
    if (requestedTargetUser) {
      const userResolution = await resolveUserTarget(requestedTargetUser, context);
      if (userResolution.status === "ambiguous") {
        return {
          success: false,
          error: `Multiple users match "${requestedTargetUser}". Please clarify which one you mean: ${userResolution.candidates.map((candidate) => candidate.label).join(", ")}.`,
          data: {
            status: "memory_update_failed_ambiguous_user",
            reason: "Multiple users matched the requested target.",
            candidates: userResolution.candidates.map((candidate) => candidate.label),
          },
        };
      }

      if (userResolution.status === "not_found") {
        return {
          success: false,
          error: `Could not find a user matching "${requestedTargetUser}" in this conversation or server.`,
          data: {
            status: "memory_update_failed_user_not_found",
            reason: "The requested user was not found in this conversation or server.",
          },
        };
      }

      if (userResolution.isBridgeUser) {
        return {
          success: false,
          error: "Bridge users only support server-wide memories, so personal memories cannot be updated for them.",
          data: {
            status: "memory_update_failed_invalid_scope",
            reason: "Bridge users do not support personal memory updates.",
          },
        };
      }

      resolvedTargetUserId = userResolution.targetId;
      resolvedTargetUserLabel = userResolution.displayLabel;
    }

    const isPersonalUpdate = Boolean(resolvedTargetUserId);

    const tomoriState = context.tomoriState;
    if (!tomoriState?.server_id || !tomoriState.tomori_id) {
      log.error("Missing server_id or tomori_id in Tomori state for memory update");
      return {
        success: false,
        error: "Internal bot error: Missing server context",
        data: {
          status: "memory_update_failed_internal_error",
          reason: "Internal bot error: Missing server context",
        },
      };
    }

    const serverDiscId = "guild" in context.channel ? context.channel.guild.id : context.userId;
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

    const personaNickname =
      context.personaUsername || tomoriState.tomori_nickname || context.client.user?.username || "TomoriBot";

    try {
      if (!isPersonalUpdate) {
        if (isDeleteRequested) {
          const resolvedTriggererUserId = context.message?.author?.id || context.userId;
          const triggererRow = resolvedTriggererUserId ? await loadUserRow(resolvedTriggererUserId) : null;
          const [deletedServerMemory] = await sql`
						DELETE FROM server_memories
						WHERE server_memory_id = ${memoryId}
						  AND server_id = ${tomoriState.server_id}
						  AND persona_lineage_id = ${tomoriState.persona_lineage_id}
						RETURNING server_memory_id, content, user_id
					`;

          if (deletedServerMemory) {
            const processedMemoryContent = await convertMentions(
              deletedServerMemory.content,
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
                color: ColorCode.ERROR,
                titleKey: "genai.self_teach.server_memory_deleted_title",
                titleVars: {
                  persona_nickname: personaNickname,
                },
                descriptionKey: "genai.self_teach.server_memory_deleted_description",
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
              message: "Server memory deleted successfully",
              data: {
                status: "memory_deleted_successfully",
                scope: "server_wide",
                memory_id: memoryId,
                content_deleted: deletedServerMemory.content,
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

        // 1) Server memory update (server_id + lineage scoped)
        const [updatedServerMemory] = await sql`
					UPDATE server_memories
					SET content = ${newContent}, updated_at = CURRENT_TIMESTAMP
					WHERE server_memory_id = ${memoryId}
					  AND server_id = ${tomoriState.server_id}
					  AND persona_lineage_id = ${tomoriState.persona_lineage_id}
					RETURNING server_memory_id, content, user_id
				`;

        if (updatedServerMemory) {
          const resolvedTriggererUserId = context.message?.author?.id || context.userId;
          const triggererRow = resolvedTriggererUserId ? await loadUserRow(resolvedTriggererUserId) : null;
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
              titleVars: {
                persona_nickname: personaNickname,
              },
              descriptionKey: "genai.self_teach.server_memory_updated_description",
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
      if (resolvedTargetUserId === context.client.user?.id) {
        return {
          success: false,
          error: "Cannot update personal memories about the bot. Use a server memory instead.",
          data: {
            status: "memory_update_failed_invalid_target",
            reason: "Personal memories cannot be updated about the bot itself.",
          },
        };
      }

      const targetUserRow = await loadUserRow(resolvedTargetUserId as string);
      if (!targetUserRow?.user_id) {
        return {
          success: false,
          error: `I don't know ${resolvedTargetUserLabel} yet, so this personal memory cannot be updated.`,
          data: {
            status: "memory_update_failed_user_not_found",
            reason: "I can only update personal memories for users I already know.",
          },
        };
      }

      const guild = "guild" in context.channel ? context.channel.guild : undefined;
      let guildMember = null;
      if (guild) {
        guildMember =
          guild.members.cache.get(resolvedTargetUserId as string) ||
          (await guild.members.fetch(resolvedTargetUserId as string).catch(() => null));
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
        const triggererDiscId = context.message?.author?.id || context.userId;
        if (!triggererDiscId || triggererDiscId !== resolvedTargetUserId) {
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
      const userDisplayName =
        resolvedTargetUserLabel ||
        guildMember?.displayName ||
        guildMember?.user.username ||
        targetUserRow.user_nickname ||
        targetUserRow.user_disc_id;

      if (!isDeleteRequested) {
        const userPrivacyLevel = await getPrivacyLevel(resolvedTargetUserId as string);
        if (userPrivacyLevel === PrivacyLevel.PARTIAL || userPrivacyLevel === PrivacyLevel.FULL) {
          return {
            success: false,
            error: `Cannot update personal memory: ${resolvedTargetUserLabel} has privacy restrictions.`,
            data: {
              status: "memory_update_failed_privacy_restricted",
              reason: `The user ${resolvedTargetUserLabel} has chosen to restrict personal memory storage.`,
            },
          };
        }
      }

      const personaLineageId = tomoriState.persona_lineage_id ?? 0;
      const personalMemories = await loadPersonalMemoriesForUserLineage(targetUserRow.user_id, personaLineageId, true);
      const targetMemory = personalMemories.find((memory) => memory.personal_memory_id === memoryId);
      if (!targetMemory) {
        return {
          success: false,
          error: "Personal memory ID not found",
          data: {
            status: "memory_update_failed_not_found",
            reason: "Personal memory ID not found",
          },
        };
      }

      const isUserBlacklisted = guild ? await isBlacklisted(serverDiscId, resolvedTargetUserId as string) : false;
      const footerKey = !tomoriState.config.personal_memories_enabled
        ? "genai.self_teach.personal_memory_footer_personalization_disabled"
        : isUserBlacklisted
          ? "genai.self_teach.personal_memory_footer_user_blacklisted"
          : "genai.self_teach.personal_memory_footer_manage";

      if (isDeleteRequested) {
        const [deletedMemory] = await sql`
					DELETE FROM personal_memories
					WHERE personal_memory_id = ${memoryId}
					  AND user_id = ${targetUserRow.user_id}
					  AND (
						persona_lineage_id = ${personaLineageId}
						OR persona_lineage_id = 0
					  )
					RETURNING personal_memory_id, content
				`;

        if (!deletedMemory) {
          log.error(`Failed to delete personal memory ${memoryId} for user ${targetUserRow.user_id}`);
          return {
            success: false,
            error: "Failed to delete personal memory",
            data: {
              status: "memory_update_failed_db_error",
              reason: "Failed to delete personal memory",
            },
          };
        }

        invalidateUserCache(resolvedTargetUserId as string);

        const processedMemoryContent = await convertMentions(
          deletedMemory.content,
          context.client,
          serverDiscId,
          userDisplayName,
          tomoriState.tomori_nickname,
          tomoriState?.config.personal_memories_enabled,
        );

        await sendStandardEmbed(
          context.channel,
          context.locale,
          {
            color: ColorCode.ERROR,
            titleKey: "genai.self_teach.personal_memory_deleted_title",
            titleVars: {
              user_nickname: userDisplayName,
              persona_nickname: personaNickname,
            },
            descriptionKey: "genai.self_teach.personal_memory_deleted_description",
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
          message: "Personal memory deleted successfully",
          data: {
            status: "memory_deleted_successfully",
            scope: "target_user",
            memory_id: memoryId,
            content_deleted: deletedMemory.content,
            target_user: userDisplayName,
          },
        };
      }

      const [updatedMemory] = await sql`
				UPDATE personal_memories
				SET content = ${newContent}, updated_at = CURRENT_TIMESTAMP
				WHERE personal_memory_id = ${memoryId}
				  AND user_id = ${targetUserRow.user_id}
				  AND (
					persona_lineage_id = ${personaLineageId}
					OR persona_lineage_id = 0
				  )
				RETURNING personal_memory_id, content
			`;

      if (!updatedMemory) {
        log.error(`Failed to update personal memory ${memoryId} for user ${targetUserRow.user_id}`);
        return {
          success: false,
          error: "Failed to update personal memory",
          data: {
            status: "memory_update_failed_db_error",
            reason: "Failed to update personal memory",
          },
        };
      }

      invalidateUserCache(resolvedTargetUserId as string);

      const processedMemoryContent = await convertMentions(
        newContent,
        context.client,
        serverDiscId,
        userDisplayName,
        tomoriState.tomori_nickname,
        tomoriState?.config.personal_memories_enabled,
      );

      await sendStandardEmbed(
        context.channel,
        context.locale,
        {
          color: ColorCode.MEMORY_UPDATE,
          titleKey: "genai.self_teach.personal_memory_updated_title",
          titleVars: {
            user_nickname: userDisplayName,
            persona_nickname: personaNickname,
          },
          descriptionKey: "genai.self_teach.personal_memory_updated_description",
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
          target_user: userDisplayName,
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
