import { beforeAll, expect, it, spyOn } from "bun:test";
import { BlockUserTool } from "@/tools/functionCalls/blockUserTool";
import { ManageMessageTool } from "@/tools/functionCalls/manageMessageTool";
import { ToolRegistry } from "@/tools/toolRegistry";
import type { ToolContext } from "@/types/tool/interfaces";
import { log } from "@/utils/misc/logger";
import { createPersona } from "../../helpers/fixtures";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(initializeLocalizer);

function context(blockingEnabled = true): ToolContext {
  return {
    channel: { id: "fixture-channel" } as ToolContext["channel"],
    client: { user: { id: "fixture-bot" } } as ToolContext["client"],
    provider: "google",
    locale: "en-US",
    tomoriState: createPersona({ server_id: 0, config: { user_blocking_enabled: blockingEnabled } }),
  };
}

it("returns the closest registered name to the model for an unknown tool", async () => {
  if (!ToolRegistry.getTool("manage_message")) {
    ToolRegistry.registerTool(new ManageMessageTool());
  }
  const errorSpy = spyOn(log, "error").mockImplementation(async () => {});
  const warnSpy = spyOn(log, "warn").mockImplementation(() => {});
  try {
    const result = await ToolRegistry.executeTool("manage_msg", {}, context());
    expect(result.success).toBe(false);
    expect(result.error).toContain("manage_message");
    // Earlier files in a shared batch leave background health checks that log through the same
    // singleton while this spy is live, so only the unknown-tool line is countable.
    const unknownToolLogs = (spy: typeof errorSpy | typeof warnSpy) =>
      spy.mock.calls.filter(([message]) => String(message).includes("manage_msg"));
    expect(unknownToolLogs(errorSpy)).toHaveLength(0);
    expect(unknownToolLogs(warnSpy)).toHaveLength(1);
  } finally {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  }
});

it("suggests only tools the current turn can run", async () => {
  if (!ToolRegistry.getTool("block_user")) {
    ToolRegistry.registerTool(new BlockUserTool());
  }
  const errorSpy = spyOn(log, "error").mockImplementation(async () => {});
  try {
    const result = await ToolRegistry.executeTool("block_usr", {}, context(false));
    expect(result.success).toBe(false);
    expect(result.error).not.toContain("block_user");
  } finally {
    errorSpy.mockRestore();
  }
});
