import type { Tool, MCPCapableToolAdapter, ToolResult } from "../../types/tool/interfaces";
import { GoogleToolAdapter } from "../google/googleToolAdapter";

export class VertexToolAdapter implements MCPCapableToolAdapter {
  private static instance: VertexToolAdapter;
  private readonly googleAdapter: GoogleToolAdapter;

  private constructor() {
    this.googleAdapter = GoogleToolAdapter.getInstance();
  }

  static getInstance(): VertexToolAdapter {
    if (!VertexToolAdapter.instance) {
      VertexToolAdapter.instance = new VertexToolAdapter();
    }
    return VertexToolAdapter.instance;
  }

  getProviderName(): string {
    return "vertex";
  }

  convertTool(tool: Tool): Record<string, unknown> {
    return this.googleAdapter.convertTool(tool);
  }

  convertResult(result: ToolResult): Record<string, unknown> {
    return this.googleAdapter.convertResult(result);
  }

  async getAllToolsInProviderFormat(
    builtInTools: Tool[],
    serverId?: number,
    allowedMCPFunctions?: string[],
  ): Promise<Array<Record<string, unknown>>> {
    return this.googleAdapter.getAllToolsInGoogleFormat(builtInTools, serverId, allowedMCPFunctions);
  }
}

export function getVertexToolAdapter(): VertexToolAdapter {
  return VertexToolAdapter.getInstance();
}
