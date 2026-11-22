import type { StreamingContext, Tool, ToolAssemblyState, ToolContext, ToolResult } from "@/types/tool/interfaces";
import { localizer } from "@/utils/text/localizer";

const CREATE_ACTIONS = ["create"] as const;
const CHANGE_ACTIONS = ["update", "delete"] as const;
export const MESSAGE_MANAGEMENT_ACTIONS = ["pin", "edit", "delete"] as const;
export const MESSAGE_INTERACTION_ACTIONS = ["reply", "react"] as const;

const ACTION_SELECTORS = new Map<string, { name: string; actions: readonly string[] }>([
  ["create_task", { name: "manage_task", actions: CREATE_ACTIONS }],
  ["update_task", { name: "manage_task", actions: CHANGE_ACTIONS }],
  ["create_long_term_memory", { name: "manage_long_term_memory", actions: CREATE_ACTIONS }],
  ["update_long_term_memory", { name: "manage_long_term_memory", actions: CHANGE_ACTIONS }],
  ["remember_this_fact", { name: "manage_long_term_memory", actions: CREATE_ACTIONS }],
  ["manage_message", { name: "manage_message", actions: MESSAGE_MANAGEMENT_ACTIONS }],
  ["interact_with_recent_message", { name: "manage_message", actions: MESSAGE_INTERACTION_ACTIONS }],
]);

export function getActionSelector(name: string) {
  return ACTION_SELECTORS.get(name);
}

export function getActionSelectorNames(): Iterable<string> {
  return ACTION_SELECTORS.keys();
}

type ToolActionStreamContext = Pick<
  StreamingContext,
  "disableAllTools" | "disableReminderTool" | "disableTaskCreation" | "disableRecentMessageReplyTool"
> & { deliberateToolAllowedNames?: readonly string[] | null };

function getAvailableToolActions(
  tool: Tool,
  config: ToolAssemblyState["config"],
  streamContext?: ToolActionStreamContext | null,
): string[] {
  if (streamContext?.disableAllTools) return [];
  if (tool.name === "manage_task" && streamContext?.disableReminderTool) return [];
  if (tool.name === "manage_long_term_memory" && !config.self_teaching_enabled) return [];

  const selectors = streamContext?.deliberateToolAllowedNames;
  const eligibleActions = selectors?.length
    ? new Set(
        selectors.flatMap((selector) => {
          const group = getActionSelector(selector);
          if (group) return group.name === tool.name ? group.actions : [];
          return selector === tool.name ? (tool.parameters.properties.action?.enum ?? []) : [];
        }),
      )
    : undefined;

  return (tool.parameters.properties.action?.enum ?? []).filter((action) => {
    if (eligibleActions && !eligibleActions.has(action)) return false;
    if (tool.name === "manage_task" && action === "create") return !streamContext?.disableTaskCreation;
    if (tool.name !== "manage_message") return true;
    if (action === "reply") return !streamContext?.disableRecentMessageReplyTool;
    if (action === "react") return config.emoji_usage_enabled;
    return config.manage_message_enabled;
  });
}

export function applyToolActionAvailability(
  tool: Tool,
  config: ToolAssemblyState["config"],
  streamContext?: ToolActionStreamContext | null,
): Tool | null {
  if (!tool.withActions) return tool;
  const actions = getAvailableToolActions(tool, config, streamContext);
  if (actions.length === 0) return null;
  return actions.length === tool.parameters.properties.action?.enum?.length ? tool : tool.withActions(actions);
}

export function getAvailableToolSelectors(tool: Tool): string[] {
  if (!tool.withActions) return [tool.name];
  const actions = tool.parameters.properties.action?.enum ?? [];
  return [
    ...(getActionSelector(tool.name) ? [] : [tool.name]),
    ...[...ACTION_SELECTORS].flatMap(([selector, group]) =>
      group.name === tool.name && group.actions.some((action) => actions.includes(action)) ? [selector] : [],
    ),
  ];
}

export function unavailableToolAction(tool: Tool, action: string, context: ToolContext): ToolResult | undefined {
  if (getAvailableToolActions(tool, context.tomoriState.config, context.streamContext).includes(action)) return;
  return {
    success: false,
    error: localizer(context.locale, "tools.execution.action_unavailable", { tool: tool.name, action }),
    data: { status: "tool_action_unavailable", action },
  };
}

export function invalidToolActionArguments(tool: Tool, context: ToolContext): ToolResult {
  return {
    success: false,
    error: localizer(context.locale, "tools.execution.invalid_action_arguments", { tool: tool.name }),
    data: { status: "invalid_tool_action_arguments" },
  };
}
