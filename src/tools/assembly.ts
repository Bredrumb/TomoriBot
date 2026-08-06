import type { Tool, ToolAssemblyContext, ToolParameterSchema } from "@/types/tool/interfaces";
import { log } from "@/utils/misc/logger";

export interface ToolAssemblyOverrides {
  description?: string;
  parameters?: ToolParameterSchema;
}

export function createToolVariant<TTool extends Tool>(tool: TTool, overrides: ToolAssemblyOverrides): TTool {
  const propertyDescriptors: PropertyDescriptorMap = {};

  if (overrides.description !== undefined) {
    propertyDescriptors.description = {
      value: overrides.description,
      enumerable: true,
    };
  }

  if (overrides.parameters !== undefined) {
    propertyDescriptors.parameters = {
      value: overrides.parameters,
      enumerable: true,
    };
  }

  return Object.create(tool, propertyDescriptors) as TTool;
}

async function assembleToolForContext(tool: Tool, context: ToolAssemblyContext): Promise<Tool | null> {
  if (!tool.assembleForContext) {
    return tool;
  }

  return await tool.assembleForContext(context);
}

export async function assembleToolsForContext(tools: Iterable<Tool>, context: ToolAssemblyContext): Promise<Tool[]> {
  const assembledTools: Tool[] = [];

  for (const tool of tools) {
    try {
      const assembledTool = await assembleToolForContext(tool, context);
      if (assembledTool) {
        assembledTools.push(assembledTool);
      }
    } catch (error) {
      log.warn(`Tool schema assembly failed for ${tool.name}; omitting tool for this turn`, error as Error);
    }
  }

  return assembledTools;
}
