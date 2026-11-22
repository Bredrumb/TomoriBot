import { createToolVariant } from "@/tools/assembly";
import { createLongTermMemory } from "@/tools/functionCalls/memoryTool";
import { changeLongTermMemory } from "@/tools/functionCalls/updateLongTermMemoryTool";
import { BaseTool, type ToolContext, type ToolParameterSchema, type ToolResult } from "@/types/tool/interfaces";
import { invalidToolActionArguments, unavailableToolAction } from "@/utils/tools/toolActions";

function buildMemoryDefinition(actions: string[]) {
  const canCreate = actions.includes("create");
  const canUpdate = actions.includes("update");
  const canDelete = actions.includes("delete");
  const canWriteContent = canCreate || canUpdate;
  const description = [
    canCreate && canUpdate && canDelete
      ? "Save, replace, or delete facts, preferences, or instructions that persist across conversations."
      : canCreate
        ? "Proactively save new facts, preferences, or instructions worth remembering across conversations."
        : canUpdate && canDelete
          ? "Replace or delete a persistent server or personal memory."
          : canUpdate
            ? "Replace an existing server or personal memory."
            : "Delete an existing server or personal memory.",
    canCreate && canUpdate && "Save new information proactively. Update an existing memory when it changes.",
    canCreate && "Skip duplicates and identifying details like real names, addresses, or contact info.",
  ]
    .filter(Boolean)
    .join(" ");
  const parameters: ToolParameterSchema = {
    type: "object",
    required: [
      "action",
      "memory_scope",
      ...(!canCreate ? ["memory_id"] : []),
      ...(canWriteContent && !canDelete ? ["memory_content"] : []),
    ],
    properties: {
      action: { type: "string", enum: actions },
      memory_scope: {
        type: "string",
        enum: ["server_wide", "target_user"],
        description: "Use server_wide for shared information or target_user for a user's memory.",
      },
      target_user: {
        type: "string",
        description: "Required for target_user scope. Use the user's name as shown in context.",
      },
    },
  };
  if (canUpdate || canDelete) {
    parameters.properties.memory_id = {
      type: "number",
      description: canCreate
        ? "Required for update or delete. Use the positive integer shown in context (24 from ID:24)."
        : "Use the ID shown with the memory in context (e.g. 24 from ID:24).",
    };
  }
  if (canWriteContent) {
    parameters.properties.memory_content = {
      type: "string",
      description:
        canCreate && canUpdate
          ? "Required for create or update. For update, give the full replacement. Write concise third-person text using {user} for the target and {bot} for yourself. Omit IDs and metadata."
          : canCreate
            ? "Write concise third-person text. Use {user} for the target and {bot} for yourself, like '{user} likes dogs'."
            : canDelete
              ? "Full replacement text for update. Omit IDs and metadata. Omit this field for delete."
              : "Full replacement text. Omit IDs and metadata.",
    };
  }
  return { description, parameters };
}

const fullDefinition = buildMemoryDefinition(["create", "update", "delete"]);

export class ManageLongTermMemoryTool extends BaseTool {
  name = "manage_long_term_memory";
  category = "memory" as const;
  requiresFeatureFlag = "self_teaching";
  description = fullDefinition.description;
  parameters = fullDefinition.parameters;

  withActions(actions: string[]): this {
    return createToolVariant(this, buildMemoryDefinition(actions));
  }

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = args.action;
    if (action !== "create" && action !== "update" && action !== "delete") {
      return invalidToolActionArguments(this, context);
    }
    const actionFailure = unavailableToolAction(this, action, context);
    if (actionFailure) return actionFailure;

    const variant = this.withActions([action]);
    const validScope =
      args.memory_scope === "target_user"
        ? typeof args.target_user === "string" && args.target_user.trim().length > 0
        : args.memory_scope === "server_wide" && args.target_user == null;
    if (
      !variant.validateParameters(args).isValid ||
      Object.entries(args).some(
        ([key, value]) => value != null && !Object.hasOwn(variant.parameters.properties, key),
      ) ||
      !validScope ||
      (action !== "delete" && !String(args.memory_content).trim())
    ) {
      return invalidToolActionArguments(this, context);
    }

    return action === "create" ? createLongTermMemory(args, context) : changeLongTermMemory(args, context);
  }
}
