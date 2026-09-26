import { expect, it, spyOn } from "bun:test";
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
    expect(errorSpy).toHaveBeenCalledTimes(1);
  } finally {
    errorSpy.mockRestore();
  }
});
