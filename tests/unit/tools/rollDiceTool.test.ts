import { afterEach, beforeAll, expect, it, mock, spyOn } from "bun:test";
import { type EmbedBuilder, MessageFlags, PermissionFlagsBits } from "discord.js";
import { RollDiceTool } from "@/tools/functionCalls/rollDiceTool";
import { getAvailableToolsForContext, isBuiltInToolAvailable, type ToolStateForContext } from "@/tools/availability";
import type { ToolContext } from "@/types/tool/interfaces";
import type { DiceRollResult } from "@/utils/dice/diceRoll";
import {
  buildCapabilitiesManageConfigWritePlan,
  getCapabilitiesManagePermissionDefinitions,
} from "@/utils/discord/manageConfigMapping";
import * as channelQueue from "@/utils/chat/channelQueue";
import { log } from "@/utils/misc/logger";
import { initializeLocalizer } from "@/utils/text/localizer";
import { getDeliberateToolAllowedNames } from "@/utils/tools/deliberateToolMode";
import { createPersona } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";

beforeAll(initializeLocalizer);
afterEach(() => mock.restore());

function fixture(enabled = true) {
  const send = mock(async (_payload: unknown) => ({ id: "roll-message" }));
  const context = {
    client: {},
    channel: { id: "channel", send },
    tomoriState: createPersona({ persona_nickname: "Juno", config: { dice_rolling_enabled: enabled } }),
    provider: "google",
    locale: "en-US",
  } as unknown as ToolContext;
  return { context, send };
}

it("advertises and executes dice rolls only after opt-in", async () => {
  const f = fixture(false);
  const tool = new RollDiceTool();
  const state: ToolStateForContext = {
    server_id: "server",
    activePersonaHasElevenlabsVoice: false,
    llm: f.context.tomoriState.llm,
    config: f.context.tomoriState.config,
  };
  expect(createPersona().config.dice_rolling_enabled).toBe(false);
  expect(getAvailableToolsForContext([tool], "google", state)).toEqual([]);
  expect(isBuiltInToolAvailable(tool, "google", f.context)).toBe(false);
  expect((await tool.execute({ dice: "d20" }, f.context)).success).toBe(false);
  expect(f.send).not.toHaveBeenCalled();
  f.context.tomoriState.config.dice_rolling_enabled = true;
  expect(getAvailableToolsForContext([tool], "google", state).map((entry) => entry.name)).toContain("roll_dice");
  expect(getDeliberateToolAllowedNames("Please roll dice for this check")).toContain("roll_dice");
});

it("saves the opt-in through the existing Available Tools write plan", () => {
  const config = createPersona().config;
  const selected = getCapabilitiesManagePermissionDefinitions({ page: "available-tools" })
    .filter((definition) => definition.getState(config))
    .map((definition) => definition.value);
  const plan = buildCapabilitiesManageConfigWritePlan(config, [...selected, "dicerolling"], {
    page: "available-tools",
  });
  expect(plan.patch.capabilities).toEqual({ dice_rolling_enabled: true });
  const disabled = buildCapabilitiesManageConfigWritePlan({ ...config, dice_rolling_enabled: true }, selected, {
    page: "available-tools",
  });
  expect(disabled.patch.capabilities).toEqual({ dice_rolling_enabled: false });
});

it("posts the persona's public embed and returns the same dice results to the model", async () => {
  const f = fixture();
  const suppress = spyOn(channelQueue, "suppressNextSelfReply").mockImplementation(() => undefined);
  const result = await new RollDiceTool().execute(
    { dice: "1d20+5", mode: "advantage", reason: "Stealth check" },
    f.context,
  );
  expect(result.success).toBe(true);
  const data = result.data as DiceRollResult & { message_id: string };
  expect(data.rolls).toHaveLength(2);
  expect(data.kept).toEqual([Math.max(...data.rolls)]);
  expect(data.total).toBe(data.kept[0] + 5);
  expect(data.message_id).toBe("roll-message");
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(suppress).toHaveBeenCalledWith(f.context.channel.id);
  const payload = f.send.mock.calls[0][0] as { embeds: EmbedBuilder[]; flags: number; allowedMentions: unknown };
  expect(payload.embeds[0].data.description).toContain(
    localizedCopy("en-US", "commands.roll.rolled_with_reason", {
      actor: "Juno",
      dice: data.dice,
      reason: "Stealth check",
    }),
  );
  expect(payload.embeds[0].data.footer?.text).toBe(localizedCopy("en-US", "commands.roll.footer_shared"));
  expect(payload.flags).toBe(MessageFlags.SuppressNotifications);
  expect(payload.allowedMentions).toEqual({ parse: [] });
});

it("rejects invalid and cancelled rolls without posting and reports delivery failures", async () => {
  const f = fixture();
  const tool = new RollDiceTool();
  for (const args of [{}, { dice: "101d6" }, { dice: "2d6", mode: "advantage" }])
    expect((await tool.execute(args, f.context)).success).toBe(false);
  f.context.abortSignal = AbortSignal.abort();
  expect((await tool.execute({ dice: "d20" }, f.context)).success).toBe(false);
  expect(f.send).not.toHaveBeenCalled();
  f.context.abortSignal = undefined;
  f.send.mockRejectedValueOnce(new Error("delivery failed"));
  const logged = spyOn(log, "error").mockImplementation(async () => {});
  expect((await tool.execute({ dice: "d20" }, f.context)).success).toBe(false);
  expect(logged).toHaveBeenCalled();
});

it("requires embed access and uses thread send permission in threads", async () => {
  const f = fixture();
  const tool = new RollDiceTool();
  const has = mock((_permissions: readonly bigint[]) => false);
  Object.assign(f.context.client, { user: { id: "bot" } });
  Object.assign(f.context.channel, { permissionsFor: () => ({ has }), isThread: () => true });
  expect((await tool.execute({ dice: "d20" }, f.context)).success).toBe(false);
  expect(f.send).not.toHaveBeenCalled();
  expect(has.mock.calls[0][0]).toContain(PermissionFlagsBits.SendMessagesInThreads);
  has.mockReturnValue(true);
  expect((await tool.execute({ dice: "d20" }, f.context)).success).toBe(true);
  expect(f.send).toHaveBeenCalledTimes(1);
});
