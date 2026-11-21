import { afterEach, beforeAll, expect, it, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client, ModalSubmitInteraction } from "discord.js";
import { applyPresetDefault } from "@/commands/persona/default";
import { configRepository, personaRepository } from "@/utils/db/repositories";
import * as stateCache from "@/utils/cache/tomoriStateCache";
import * as interactions from "@/utils/discord/interactionHelper";
import { log } from "@/utils/misc/logger";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";

beforeAll(initializeLocalizer);
const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

it("reports failures after a modal submission on the deferred submission", async () => {
  const persona = createPersona();
  const preset = { persona_preset_name: "Mirri", persona_preset_desc: "Preset", preset_trigger_words: ["mirri"] };
  spies.push(spyOn(stateCache, "getCachedTomoriState").mockResolvedValue(persona));
  spies.push(spyOn(configRepository, "loadPresetRowsByLocale").mockResolvedValue([preset] as never));
  const modal = makeFakeInteraction({ deferred: true });
  spies.push(
    spyOn(interactions, "promptWithRawModal").mockResolvedValue({
      outcome: "submit",
      interaction: modal.interaction as unknown as ModalSubmitInteraction,
      values: { preset_select: "Mirri" },
    }),
  );
  spies.push(spyOn(personaRepository, "loadAllForServer").mockRejectedValue(new Error("Missing Access")));
  spies.push(spyOn(log, "error").mockImplementation(async () => {}));
  const command = makeFakeInteraction({ channel: {}, options: { getString: () => "default", getBoolean: () => null } });
  await applyPresetDefault(
    {} as Client,
    command.interaction as unknown as ChatInputCommandInteraction,
    createUserRow(),
    "en-US",
    { nsfw: false },
  );
  expect(modal.calls.map((call) => call.method)).toContain("editReply");
  expect(command.calls.map((call) => call.method)).not.toContain("reply");
});
