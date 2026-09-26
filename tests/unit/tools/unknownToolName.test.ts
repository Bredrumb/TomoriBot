import { expect, it, spyOn } from "bun:test";
import { BlockUserTool } from "@/tools/functionCalls/blockUserTool";
import { InteractWithRecentMessageTool } from "@/tools/functionCalls/interactWithRecentMessageTool";
import { ToolRegistry } from "@/tools/toolRegistry";
import type { ToolContext } from "@/types/tool/interfaces";
import { log } from "@/utils/misc/logger";

it("returns the closest registered name to the model for an unknown tool", async () => {
  if (!ToolRegistry.getTool("interact_with_recent_message")) {
    ToolRegistry.registerTool(new InteractWithRecentMessageTool());
  }
  const errorSpy = spyOn(log, "error").mockImplementation(async () => {});
  try {
    const result = await ToolRegistry.executeTool("interact_using_recent_message", {}, {
      provider: "google",
      tomoriState: { server_id: 0 },
    } as ToolContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain("interact_with_recent_message");
    // Earlier files in a shared batch leave background health checks that log through the same
    // singleton while this spy is live, so only the unknown-tool line is countable.
    const unknownToolLogs = errorSpy.mock.calls.filter(([message]) =>
      String(message).includes("interact_using_recent_message"),
    );
    expect(unknownToolLogs).toHaveLength(1);
  } finally {
    errorSpy.mockRestore();
  }
});

it("suggests only tools the current turn can run", async () => {
  if (!ToolRegistry.getTool("block_user")) {
    ToolRegistry.registerTool(new BlockUserTool());
  }
  const errorSpy = spyOn(log, "error").mockImplementation(async () => {});
  try {
    const result = await ToolRegistry.executeTool("block_usr", {}, {
      provider: "google",
      tomoriState: { server_id: 0, config: {} },
    } as ToolContext);
    expect(result.success).toBe(false);
    expect(result.error).not.toContain("block_user");
  } finally {
    errorSpy.mockRestore();
  }
});
