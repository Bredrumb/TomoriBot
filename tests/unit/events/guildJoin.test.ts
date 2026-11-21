import { afterEach, expect, it, mock, spyOn } from "bun:test";
import { Client, Collection, type Guild } from "discord.js";
import handler from "@/events/guildCreate/addBot";
import { serverRepository } from "@/utils/db/repositories/ServerRepository";
import { log } from "@/utils/misc/logger";

afterEach(() => mock.restore());

it("counts a welcome with no writable channel as expected and preserves unexpected failures", async () => {
  const client = new Client({ intents: [] });
  const guild = {
    id: "fixture-guild",
    name: "Lantern Lounge",
    preferredLocale: "en-US",
    systemChannel: null,
    channels: { cache: new Collection() },
  } as unknown as Guild;
  const load = spyOn(serverRepository, "loadServerIdByDiscId").mockResolvedValue(null);
  const errors = spyOn(log, "error").mockResolvedValue(undefined);
  const warnings = spyOn(log, "warn").mockImplementation(() => {});
  const metrics = spyOn(log, "metric").mockImplementation(() => {});

  await handler(client, guild);
  expect(errors).not.toHaveBeenCalled();
  expect(warnings).toHaveBeenCalledTimes(1);
  expect(metrics).toHaveBeenCalledWith("guild_welcome_skipped", { reason: "no_sendable_channel" });

  load.mockRejectedValue(new Error("Unexpected database failure"));
  await handler(client, guild);
  expect(errors).toHaveBeenCalledTimes(1);
});
