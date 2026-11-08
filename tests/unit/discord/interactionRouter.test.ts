import { describe, expect, it, spyOn } from "bun:test";
import type { Client, Interaction } from "discord.js";
import { dispatchGlobalInteraction, isGlobalRoutableInteraction } from "@/utils/discord/interactions/router";
import type { GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { InteractionRouteRegistry } from "@/utils/discord/interactions/routeRegistry";
import { log } from "@/utils/misc/logger";
import * as interactionLocale from "@/utils/discord/interactionLocale";
import * as panel from "@/utils/discord/ui/panel";
import { createRouteInteraction } from "../../helpers/routeInteraction";

function makeInteraction(
  kind: "button" | "string" | "channel" | "role" | "user" | "mentionable" | "modal" | "other",
): Interaction {
  return {
    isMessageComponent: () => ["button", "string", "channel", "role", "user", "mentionable"].includes(kind),
    isModalSubmit: () => kind === "modal",
  } as unknown as Interaction;
}

describe("global interaction router predicate", () => {
  it("admits every message component and modal without enumerating select types", () => {
    expect(isGlobalRoutableInteraction(makeInteraction("button"))).toBe(true);
    expect(isGlobalRoutableInteraction(makeInteraction("string"))).toBe(true);
    expect(isGlobalRoutableInteraction(makeInteraction("channel"))).toBe(true);
    expect(isGlobalRoutableInteraction(makeInteraction("role"))).toBe(true);
    expect(isGlobalRoutableInteraction(makeInteraction("user"))).toBe(true);
    expect(isGlobalRoutableInteraction(makeInteraction("mentionable"))).toBe(true);
    expect(isGlobalRoutableInteraction(makeInteraction("modal"))).toBe(true);
    expect(isGlobalRoutableInteraction(makeInteraction("other"))).toBe(false);
  });
});

describe("retired panel namespaces", () => {
  it("distinguishes interaction age at dispatch from time spent in a failed route", async () => {
    let now = 11_000;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    const errors = spyOn(log, "error").mockResolvedValue(undefined);
    const dispatch = spyOn(InteractionRouteRegistry.prototype, "dispatchDetailed").mockImplementation(async () => {
      now += 2_000;
      throw Object.assign(new Error("Expired interaction"), { code: 10062 });
    });
    const locale = spyOn(interactionLocale, "resolveUserLocale").mockResolvedValue("en-US");
    const reply = spyOn(panel, "replyPanelReceipt").mockResolvedValue(undefined);
    const interaction = Object.assign(createRouteInteraction(), { createdTimestamp: 10_000 });
    try {
      expect(await dispatchGlobalInteraction({} as Client, interaction as unknown as GlobalRoutableInteraction)).toBe(
        true,
      );
      expect(errors.mock.calls[0]?.[2]).toMatchObject({
        metadata: { interactionAgeAtDispatchMs: 1_000, dispatchDurationMs: 2_000, deferred: false, replied: false },
      });
    } finally {
      clock.mockRestore();
      errors.mockRestore();
      dispatch.mockRestore();
      locale.mockRestore();
      reply.mockRestore();
    }
  });

  it("leaves legacy MCP and ST preset controls unmatched without replying", async () => {
    for (const customId of ["mcps:v1:retry:en-US:none", "st-presets:v1:retry:en-US"]) {
      const interaction = {
        id: `retired-${customId}`,
        customId,
        locale: "en-US",
        guildLocale: "en-US",
        user: { id: "user-1" },
        replied: false,
        deferred: false,
        reply: async () => {},
      } as unknown as GlobalRoutableInteraction;
      const replySpy = spyOn(interaction, "reply");

      await expect(dispatchGlobalInteraction({} as Client, interaction)).resolves.toBe(false);
      expect(replySpy).not.toHaveBeenCalled();

      replySpy.mockRestore();
    }
  });
});
