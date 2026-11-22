import { z } from "zod";
import { BaseTool, type ToolContext, type ToolParameterSchema, type ToolResult } from "@/types/tool/interfaces";
import {
  PERSONA_NAMING_VALUE_MAX_LENGTH,
  USER_IDENTITY_FIELD_MAX_LENGTH,
  USER_NICKNAME_MAX_LENGTH,
} from "@/types/personaNaming";
import { PrivacyLevel, type UserRow, utcOffsetSchema } from "@/types/db/schema";
import { invalidateUserCache } from "@/utils/cache/userCache";
import { resolveUserTarget } from "@/utils/discord/targetResolver";
import { sendToolNoticeContainer } from "@/utils/discord/expandableEmbedNotice";
import { userNamingRepository, userRepository } from "@/utils/db/repositories";
import {
  type UserInfoWriteBatch,
  type UserPersonaNamingPreferencePatch,
  userPersonaNamingPairKey,
} from "@/utils/db/repositories/UserNamingRepository";
import { ColorCode, log } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { formatUTCOffset } from "@/utils/text/timezoneHelper";
import { type EffectiveUserNaming, resolveEffectiveUserNaming } from "@/utils/text/userNaming";

const NAMING_FIELDS = ["nickname", "prefix", "suffix"] as const;
const GLOBAL_FIELDS = ["gender_identity", "pronouns", "addressing_style", "timezone_offset"] as const;
const ALL_FIELDS = [...NAMING_FIELDS, ...GLOBAL_FIELDS] as const;

type UserInfoField = (typeof ALL_FIELDS)[number];

const STYLE_LABEL_KEYS: Record<NonNullable<UserRow["addressing_style"]>, string> = {
  masculine: "commands.personal.profile.about.style_masculine",
  feminine: "commands.personal.profile.about.style_feminine",
  neutral: "commands.personal.profile.about.style_neutral",
};

const FIELD_LABEL_KEYS: Record<UserInfoField, string> = {
  nickname: "tools.user_info_update.field_nickname",
  prefix: "tools.user_info_update.field_prefix",
  suffix: "tools.user_info_update.field_suffix",
  gender_identity: "tools.user_info_update.field_gender_identity",
  pronouns: "tools.user_info_update.field_pronouns",
  addressing_style: "tools.user_info_update.field_addressing_style",
  timezone_offset: "tools.user_info_update.field_timezone_offset",
};

const SUBJECT_LABEL_KEYS: Record<"nickname" | (typeof GLOBAL_FIELDS)[number], string> = {
  nickname: "tools.user_info_update.subject_nickname",
  gender_identity: "tools.user_info_update.subject_gender_identity",
  pronouns: "tools.user_info_update.subject_pronouns",
  addressing_style: "tools.user_info_update.subject_addressing_style",
  timezone_offset: "tools.user_info_update.subject_timezone_offset",
};

const updateUserInfoInputSchema = z
  .object({
    target_user: z.string().min(1).optional(),
    nickname: z.string().max(USER_NICKNAME_MAX_LENGTH).optional(),
    prefix: z.string().max(PERSONA_NAMING_VALUE_MAX_LENGTH).optional(),
    suffix: z.string().max(PERSONA_NAMING_VALUE_MAX_LENGTH).optional(),
    gender_identity: z.string().max(USER_IDENTITY_FIELD_MAX_LENGTH).optional(),
    pronouns: z.string().max(USER_IDENTITY_FIELD_MAX_LENGTH).optional(),
    addressing_style: z.enum(["masculine", "feminine", "neutral"]).optional(),
    timezone_offset: utcOffsetSchema.optional(),
    clear: z.array(z.enum(ALL_FIELDS)).max(ALL_FIELDS.length).optional(),
  })
  .strict();

type UpdateUserInfoInput = z.infer<typeof updateUserInfoInputSchema>;

export type FieldPlan =
  | { field: UserInfoField; cleared: true }
  | { field: UserInfoField; cleared: false; value: string | number };

function failure(
  context: ToolContext,
  status: string,
  messageKey: string,
  data: Record<string, unknown> = {},
): ToolResult {
  const reason = localizer(context.locale, messageKey);
  return { success: false, error: reason, message: reason, data: { status, ...data } };
}

function buildFieldPlans(input: UpdateUserInfoInput): { plans: FieldPlan[]; conflict: boolean } {
  const cleared = new Set<UserInfoField>(input.clear ?? []);
  const plans: FieldPlan[] = [];
  let conflict = false;

  for (const field of ALL_FIELDS) {
    const raw = input[field];
    const trimmed = typeof raw === "string" ? raw.trim() : raw;
    const hasValue = trimmed !== undefined && trimmed !== "";

    if (hasValue && cleared.has(field)) {
      conflict = true;
      continue;
    }
    if (hasValue) {
      plans.push({ field, cleared: false, value: trimmed as string | number });
      continue;
    }
    if (cleared.has(field) || (typeof raw === "string" && trimmed === "")) {
      plans.push({ field, cleared: true });
    }
  }

  return { plans, conflict };
}

// Models only see the joined formatted name and sometimes retype active affixes into nickname, so only resolved
// affixes are stripped without splitting on spaces.
export function stripRedundantAffixes(nickname: string, prefix: string, suffix: string): string {
  let value = nickname.trim();
  if (prefix && value.toLowerCase().startsWith(prefix.toLowerCase())) {
    const remainder = value.slice(prefix.length).trimStart();
    if (remainder) value = remainder;
  }
  if (suffix && value.toLowerCase().endsWith(suffix.toLowerCase())) {
    const remainder = value.slice(0, value.length - suffix.length).trimEnd();
    if (remainder) value = remainder;
  }
  return value;
}

function pendingAffix(plans: FieldPlan[], field: "prefix" | "suffix", current: string): string {
  const plan = plans.find((candidate) => candidate.field === field);
  if (!plan) return current;
  return plan.cleared ? "" : String(plan.value);
}

async function resolveLiveDisplayName(context: ToolContext, targetDiscordId: string): Promise<string> {
  if (context.guildId) {
    const guild = context.client?.guilds.cache.get(context.guildId);
    const member =
      guild?.members.cache.get(targetDiscordId) ?? (await guild?.members.fetch(targetDiscordId).catch(() => null));
    if (member) return member.displayName;
  }
  const user =
    context.client?.users.cache.get(targetDiscordId) ??
    (await context.client?.users.fetch(targetDiscordId).catch(() => null));
  return user?.globalName ?? user?.username ?? targetDiscordId;
}

async function resolveNaming(
  context: ToolContext,
  userRow: UserRow,
  liveDisplayName: string,
): Promise<EffectiveUserNaming> {
  const lineageId = context.tomoriState.persona_lineage_id;
  const preference =
    lineageId != null && userRow.user_id
      ? (
          await userNamingRepository
            .loadPreferences([{ userId: userRow.user_id, personaLineageId: lineageId }])
            .catch(() => null)
        )?.get(userPersonaNamingPairKey(userRow.user_id, lineageId))
      : undefined;
  return resolveEffectiveUserNaming({
    global: {
      userNickname: userRow.user_nickname ?? null,
      prefixOverride: userRow.prefix_override ?? null,
      suffixOverride: userRow.suffix_override ?? null,
      addressingStyle: userRow.addressing_style ?? null,
    },
    liveDisplayName,
    persona: context.tomoriState.naming_config,
    preference,
  });
}

// Cleared affixes are stored as "" rather than null, because null inherits from lower layers whereas "" explicitly
// suppresses them.
function buildBatch(plans: FieldPlan[], lineageId: number | null): UserInfoWriteBatch {
  const namingPatch: UserPersonaNamingPreferencePatch = {};
  const batch: UserInfoWriteBatch = { global: {} };

  for (const plan of plans) {
    switch (plan.field) {
      case "nickname": {
        const value = plan.cleared ? null : String(plan.value);
        if (lineageId != null) namingPatch.nickname_override = value;
        else batch.global.user_nickname = value;
        break;
      }
      case "prefix":
      case "suffix": {
        const key = `${plan.field}_override` as const;
        const value = plan.cleared ? "" : String(plan.value);
        if (lineageId != null) namingPatch[key] = value;
        else batch.global[key] = value;
        break;
      }
      case "timezone_offset":
        batch.global.timezone_offset = plan.cleared ? null : Number(plan.value);
        break;
      case "addressing_style":
        batch.global.addressing_style = plan.cleared
          ? null
          : (String(plan.value) as "masculine" | "feminine" | "neutral");
        break;
      default:
        batch.global[plan.field] = plan.cleared ? null : String(plan.value);
        break;
    }
  }

  if (Object.keys(namingPatch).length > 0 && lineageId != null) {
    batch.persona = { personaLineageId: lineageId, patch: namingPatch };
  }
  return batch;
}

function styleLabel(locale: string, style: UserRow["addressing_style"]): string | null {
  return style ? localizer(locale, STYLE_LABEL_KEYS[style]) : null;
}

function previousValueLabel(
  locale: string,
  field: UserInfoField,
  before: UserRow,
  naming: EffectiveUserNaming,
): string {
  const none = localizer(locale, "tools.user_info_update.value_none");
  switch (field) {
    // Naming fields report the value the target actually experienced, not the raw
    // override slot, so the notice reads the way the change felt.
    case "nickname":
      return naming.nickname || none;
    case "prefix":
      return naming.prefix || none;
    case "suffix":
      return naming.suffix || none;
    case "gender_identity":
      return before.gender_identity || none;
    case "pronouns":
      return before.pronouns || none;
    case "addressing_style":
      return (
        styleLabel(locale, before.addressing_style) ?? localizer(locale, "tools.user_info_update.value_unspecified")
      );
    default:
      return before.timezone_offset != null ? formatUTCOffset(before.timezone_offset) : none;
  }
}

function nextValueLabel(locale: string, plan: FieldPlan): string {
  if (plan.cleared) return localizer(locale, "tools.user_info_update.value_cleared");
  if (plan.field === "timezone_offset") return formatUTCOffset(Number(plan.value));
  if (plan.field === "addressing_style")
    return styleLabel(locale, plan.value as NonNullable<UserRow["addressing_style"]>) ?? String(plan.value);
  return String(plan.value);
}

// Channel notice quotes change lines for contrast while model-facing copy stays plain, so Discord syntax never leaks
// into functionResponse.
function buildSuccessBody(
  context: ToolContext,
  plans: FieldPlan[],
  before: UserRow,
  namingBefore: EffectiveUserNaming,
  namingAfter: EffectiveUserNaming,
  targetLabel: string,
  personaScoped: boolean,
): { notice: string; message: string } {
  const locale = context.locale;
  const personaName = context.personaUsername ?? context.tomoriState.persona_nickname;
  const lines = plans.map((plan, index) => {
    const isNaming = personaScoped && (NAMING_FIELDS as readonly string[]).includes(plan.field);
    const fieldLabel = localizer(locale, FIELD_LABEL_KEYS[plan.field]);
    return localizer(locale, "tools.user_info_update.change_line", {
      index: index + 1,
      field: isNaming
        ? localizer(locale, "tools.user_info_update.field_persona_scoped", {
            field: fieldLabel,
            persona_name: personaName,
          })
        : fieldLabel,
      previous: previousValueLabel(locale, plan.field, before, namingBefore),
      next: nextValueLabel(locale, plan),
    });
  });

  // Keyed on the rendered name rather than changed fields because addressing-style switches move affixes without
  // touching naming fields.
  const nameChanged = namingBefore.formattedName !== namingAfter.formattedName;
  const summary = nameChanged
    ? `\n${localizer(locale, "tools.user_info_update.success_summary", {
        persona_name: personaName,
        target_user: targetLabel,
        formatted_name: namingAfter.formattedName,
      })}`
    : "";

  const intro = localizer(locale, "tools.user_info_update.success_intro");
  // Quote each line rather than using `>>>` because a block quote would swallow the trailing summary.
  const quoted = lines.map((line) => `> ${line}`).join("\n");
  return {
    notice: `${intro}\n${quoted}${summary}`,
    message: `${intro}\n${lines.join("\n")}${summary}`,
  };
}

// Past two distinct subjects the specific notice title stops scanning well, so the generic profile title is used
// instead.
const MAX_TITLE_SUBJECTS = 2;

// Prefix and suffix fold into nickname in the title, so affix-only clears return false here to avoid falsely claiming
// the nickname was cleared.
function isPureClear(plans: FieldPlan[]): boolean {
  if (!plans.every((plan) => plan.cleared)) return false;
  const touchesAffix = plans.some((plan) => plan.field === "prefix" || plan.field === "suffix");
  return !touchesAffix || plans.some((plan) => plan.field === "nickname");
}

// Pure removals use ColorCode.ERROR to match memory-deletion notices because Minimal notice mode renders only the
// title and border color.
export function buildSuccessHeading(
  locale: string,
  plans: FieldPlan[],
  targetLabel: string,
): { titleKey: string; titleVars: Record<string, string>; color: ColorCode } {
  const subjects: (keyof typeof SUBJECT_LABEL_KEYS)[] = [
    ...new Set(plans.map((plan) => (plan.field === "prefix" || plan.field === "suffix" ? "nickname" : plan.field))),
  ];
  if (subjects.length > MAX_TITLE_SUBJECTS) {
    return {
      titleKey: "tools.user_info_update.success_title",
      titleVars: { target_user: targetLabel },
      color: ColorCode.SUCCESS,
    };
  }
  const fields = new Intl.ListFormat(locale, { type: "conjunction", style: "long" }).format(
    subjects.map((subject) => localizer(locale, SUBJECT_LABEL_KEYS[subject])),
  );
  const titleVars = { target_user: targetLabel, fields };
  return isPureClear(plans)
    ? { titleKey: "tools.user_info_update.success_title_cleared_fields", titleVars, color: ColorCode.ERROR }
    : { titleKey: "tools.user_info_update.success_title_fields", titleVars, color: ColorCode.SUCCESS };
}

async function sendSuccessNotice(
  context: ToolContext,
  plans: FieldPlan[],
  targetLabel: string,
  body: string,
): Promise<void> {
  if (!context.channel) return;
  try {
    await sendToolNoticeContainer(context, "user_info_update", {
      ...buildSuccessHeading(context.locale, plans, targetLabel),
      description: body,
      footerKey: "tools.user_info_update.success_footer",
      footerVars: { target_user: targetLabel },
    });
  } catch (error) {
    log.warn("Failed to send the user info update notice", error as Error);
  }
}

export class UpdateUserInfoTool extends BaseTool {
  name = "update_user_info";
  description =
    "Update a registered Discord user's profile for requests like 'call me X' or a pronoun change. Nickname, prefix, and suffix are persona-specific. Other fields are shared. Pass only changes.";
  category = "utility" as const;
  requiresFeatureFlag = "user_info_updates";

  parameters: ToolParameterSchema = {
    type: "object",
    properties: {
      target_user: {
        type: "string",
        description: "User name, alias, mention, or Discord ID. Defaults to the invoking user.",
      },
      nickname: {
        type: "string",
        description: "Name you call the user. Put titles in prefix or suffix.",
      },
      prefix: {
        type: "string",
        description: "Title before the nickname (e.g. Master or Dad).",
      },
      suffix: {
        type: "string",
        description: "Title after the nickname (e.g. -san or Jr.).",
      },
      gender_identity: {
        type: "string",
        description: "How they describe their own gender, in their words.",
      },
      pronouns: {
        type: "string",
        description: "Pronouns to use for them, such as she/her, they/them, or any.",
      },
      addressing_style: {
        type: "string",
        enum: ["masculine", "feminine", "neutral"],
        description: "Gendered form of your titles (e.g. Master or Mistress). Set only when requested explicitly.",
      },
      timezone_offset: {
        type: "number",
        description: "UTC offset in hours, -12 through +14, in quarter-hour steps (e.g. 5.75 for UTC+5:45).",
      },
      clear: {
        type: "array",
        items: { type: "string", enum: [...ALL_FIELDS] },
        description:
          "Fields to remove, including prefix or suffix to drop a title. Supply values only for fields outside this list.",
      },
    },
    required: [],
  };

  isAvailableFor(): boolean {
    return true;
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    if (!(context.tomoriState.config.user_info_updates_enabled ?? true)) {
      return failure(context, "user_info_updates_disabled", "tools.user_info_update.error_disabled");
    }
    const parsed = updateUserInfoInputSchema.safeParse(args);
    if (!parsed.success)
      return failure(context, "user_info_update_invalid_args", "tools.user_info_update.error_invalid_changes");

    const requestedTarget = parsed.data.target_user?.trim();
    if (requestedTarget && ["all", "everyone", "everybody"].includes(requestedTarget.toLowerCase())) {
      return failure(context, "user_info_update_invalid_target", "tools.user_info_update.error_specific_target");
    }

    const { plans, conflict } = buildFieldPlans(parsed.data);
    if (conflict)
      return failure(context, "user_info_update_duplicate_change", "tools.user_info_update.error_duplicate_change");
    if (plans.length === 0)
      return failure(context, "user_info_update_invalid_change", "tools.user_info_update.error_invalid_changes");

    let targetDiscordId = context.userId;
    let targetLabel = "the triggering user";
    if (requestedTarget) {
      const resolution = await resolveUserTarget(requestedTarget, context);
      if (resolution.status === "ambiguous") {
        return failure(context, "user_info_update_ambiguous_target", "tools.user_info_update.error_ambiguous_target", {
          candidates: resolution.candidates.map((candidate) => candidate.label),
        });
      }
      if (resolution.status === "not_found" || resolution.isBridgeUser) {
        return failure(context, "user_info_update_target_not_found", "tools.user_info_update.error_target_not_found");
      }
      targetDiscordId = resolution.targetId;
      targetLabel = resolution.displayLabel;
    }
    if (!targetDiscordId)
      return failure(context, "user_info_update_invalid_target", "tools.user_info_update.error_target_not_found");
    if (!context.guildId && targetDiscordId !== context.userId) {
      return failure(context, "user_info_update_dm_target_restricted", "tools.user_info_update.error_dm_target");
    }

    const targetUser = await userRepository.loadByDiscordId(targetDiscordId);
    if (!targetUser?.user_id) {
      return failure(context, "user_info_update_unregistered_target", "tools.user_info_update.error_unregistered");
    }

    const hasRestrictedSet = plans.some((plan) => !plan.cleared);
    if (targetUser.privacy_level !== PrivacyLevel.MINIMAL && hasRestrictedSet) {
      return failure(context, "user_info_update_privacy_restricted", "tools.user_info_update.error_privacy_restricted");
    }

    const liveDisplayName = await resolveLiveDisplayName(context, targetDiscordId);
    const namingBefore = await resolveNaming(context, targetUser, liveDisplayName);
    if (!requestedTarget) targetLabel = namingBefore.nickname;

    const nicknamePlan = plans.find((plan) => plan.field === "nickname" && !plan.cleared);
    if (nicknamePlan && !nicknamePlan.cleared) {
      nicknamePlan.value = stripRedundantAffixes(
        String(nicknamePlan.value),
        pendingAffix(plans, "prefix", namingBefore.prefix),
        pendingAffix(plans, "suffix", namingBefore.suffix),
      );
    }

    const lineageId = context.tomoriState.persona_lineage_id ?? null;
    const batch = buildBatch(plans, lineageId);

    try {
      await userNamingRepository.applyUserInfoBatch(targetUser.user_id, batch);
    } catch {
      return failure(context, "user_info_update_failed", "tools.user_info_update.error_save_failed");
    }
    invalidateUserCache(targetDiscordId);

    const refreshed = (await userRepository.loadByDiscordId(targetDiscordId).catch(() => null)) ?? targetUser;
    const namingAfter = await resolveNaming(context, refreshed, liveDisplayName);
    const body = buildSuccessBody(
      context,
      plans,
      targetUser,
      namingBefore,
      namingAfter,
      targetLabel,
      lineageId != null,
    );

    await sendSuccessNotice(context, plans, targetLabel, body.notice);
    return {
      success: true,
      message: body.message,
      data: {
        status: "user_info_updated",
        target_user: targetLabel,
        formatted_name: namingAfter.formattedName,
        changed_fields: plans.map((plan) => plan.field),
      },
    };
  }
}
