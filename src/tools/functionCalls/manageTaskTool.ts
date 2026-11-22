import { createToolVariant } from "@/tools/assembly";
import { createScheduledTask } from "@/tools/functionCalls/reminderTool";
import { changeScheduledTask } from "@/tools/functionCalls/updateTaskTool";
import { BaseTool, type ToolContext, type ToolParameterSchema, type ToolResult } from "@/types/tool/interfaces";
import { invalidToolActionArguments, unavailableToolAction } from "@/utils/tools/toolActions";

function buildTaskDefinition(actions: string[]) {
  const canCreate = actions.includes("create");
  const canUpdate = actions.includes("update");
  const canDelete = actions.includes("delete");
  const canSchedule = canCreate || canUpdate;
  const description = [
    canCreate && canUpdate && canDelete
      ? "Create, update, or delete a scheduled user reminder or self-task."
      : canCreate
        ? "Schedule a user reminder or self-task."
        : canUpdate && canDelete
          ? "Update or delete a scheduled task."
          : canUpdate
            ? "Update a scheduled task."
            : "Delete a scheduled task.",
    canCreate && "Use cross_channel_message for immediate work in another channel.",
    canSchedule && "Set at most one positive repeat interval.",
    canCreate &&
      "On create, omit both intervals for a one-time task. Without a start time, minute repeats start after one interval and other tasks after 1 minute.",
    canUpdate &&
      "On update, omit time fields to keep the trigger. Omit intervals to keep recurrence or pass 0 to clear it.",
  ]
    .filter(Boolean)
    .join(" ");
  const parameters: ToolParameterSchema = {
    type: "object",
    required: [
      "action",
      ...(!canCreate ? ["reminder_id"] : []),
      ...(canSchedule && !canDelete ? ["reminder_purpose"] : []),
    ],
    properties: {
      action: {
        type: "string",
        enum: actions,
        ...(canDelete && canSchedule ? { description: "Delete takes only reminder_id." } : {}),
      },
    },
  };
  if (canUpdate || canDelete) {
    parameters.properties.reminder_id = {
      type: "number",
      description: canCreate
        ? "Required for update or delete. Use the positive integer shown in context (42 from ID:42)."
        : "Positive integer shown in context (42 from ID:42).",
    };
  }
  if (canSchedule) {
    const purposeRequirement = canDelete
      ? canCreate
        ? "Required for create or update. "
        : "Required for update. "
      : "";
    Object.assign(parameters.properties, {
      reminder_purpose: {
        type: "string",
        description:
          purposeRequirement +
          (canUpdate ? "Supply full replacement text for update. " : "") +
          "In 2-4 sentences, record what to do, why, and the details needed later. Leave out IDs and metadata.",
      },
      reminder_time: {
        type: "string",
        description:
          "Absolute trigger in YYYY-MM-DD_HH:MM. Copy the user's wall-clock time. Uses the server timezone unless utc_offset is set. Overrides relative timing.",
      },
      utc_offset: {
        type: "number",
        description:
          "Offset in hours for reminder_time (e.g. 5.5 for UTC+5:30). Use the user's offset for time given in their local time.",
      },
      minutes_from_now: {
        type: "number",
        description: "Elapsed minutes to the trigger (60 per hour, 1440 per day).",
      },
      months_from_now: {
        type: "number",
        description:
          "Add calendar months in the server timezone before elapsed minutes. Keep the time of day and clamp to the last day if needed.",
      },
      repetition_interval_minutes: {
        type: "number",
        description: "Repeat every X minutes (60 for hourly, 1440 for daily).",
      },
      repetition_interval_months: {
        type: "number",
        description:
          "Repeat every X calendar months (1 for monthly, 12 for yearly). Keep the original day and time, using the last day in shorter months.",
      },
      repeat_count: {
        type: "number",
        description:
          "Remaining deliveries, including the next trigger. Requires recurrence. Choose a count or a cutoff.",
      },
      repeat_until_time: {
        type: "string",
        description: "Last delivery allowed, in YYYY-MM-DD_HH:MM in the server timezone. Requires recurrence.",
      },
      daily_window_start_time: {
        type: "string",
        description:
          "Start of a daily window for fixed repeats in server time (e.g. 05:00 or 5AM). Supply the end too. A closed window moves the trigger to its opening.",
      },
      daily_window_end_time: {
        type: "string",
        description: "End of the daily window in the server timezone, on the same day as the start.",
      },
    } satisfies ToolParameterSchema["properties"]);
  }
  if (canCreate) {
    Object.assign(parameters.properties, {
      target_user: {
        type: "string",
        description: "User name as shown in context. Defaults to the invoking user.",
      },
      target_channel: {
        type: "string",
        description:
          "Channel or active thread in this server. Copy the exact label in context, including any ID, or pass the channel ID. Defaults to this channel.",
      },
      self_reminder: {
        type: "boolean",
        description: "Set true for a task you will execute yourself. Suppresses user mentions.",
      },
    } satisfies ToolParameterSchema["properties"]);
  }
  if (canUpdate) {
    parameters.properties.clear_repeat_limit = {
      type: "boolean",
      description: "Clear the remaining delivery count or cutoff.",
    };
    parameters.properties.clear_daily_window = { type: "boolean", description: "Clear the daily active window." };
  }
  return { description, parameters };
}

const fullDefinition = buildTaskDefinition(["create", "update", "delete"]);

export class ManageTaskTool extends BaseTool {
  name = "manage_task";
  category = "utility" as const;
  description = fullDefinition.description;
  parameters = fullDefinition.parameters;

  withActions(actions: string[]): this {
    return createToolVariant(this, buildTaskDefinition(actions));
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = args.action;
    if (action !== "create" && action !== "update" && action !== "delete") {
      return invalidToolActionArguments(this, context);
    }
    const actionFailure = unavailableToolAction(this, action, context);
    if (actionFailure) return actionFailure;

    const variant = this.withActions([action]);
    if (
      !variant.validateParameters(args).isValid ||
      Object.keys(args).some((key) => !Object.hasOwn(variant.parameters.properties, key)) ||
      (action !== "delete" && !String(args.reminder_purpose).trim())
    ) {
      return invalidToolActionArguments(this, context);
    }

    return action === "create" ? createScheduledTask(args, context) : changeScheduledTask(args, context);
  }
}
