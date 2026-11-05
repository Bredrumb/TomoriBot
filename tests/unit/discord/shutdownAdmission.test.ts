import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Client, InteractionCollector, Locale, MessageFlags, type EmbedBuilder, type Interaction } from "discord.js";
import handleCommands from "@/events/interactionCreate/handleCommands";
import {
  initializeShutdownInteractionAdmission,
  rejectInteractionDuringShutdown,
  promptWithRawModal,
  promptWithPaginatedModal,
} from "@/utils/discord/ui/interactionCore";
import * as shutdownState from "@/utils/misc/shutdownState";
import { initializeLocalizer } from "@/utils/text/localizer";
import { makeFakeInteraction } from "../../helpers/fakeInteraction";
import { createRouteInteraction } from "../../helpers/routeInteraction";
import { localizedCopy } from "../../helpers/localeCases";

let draining = true;
const gate = spyOn(shutdownState, "isDraining").mockImplementation(() => draining);
beforeAll(() => initializeLocalizer());
beforeEach(() => {
  draining = true;
});
afterEach(() => {
  draining = false;
});

function expectRestartingNotice(payload: unknown): void {
  const { embeds, flags } = payload as { embeds: EmbedBuilder[]; flags: number };
  expect(flags).toBe(MessageFlags.Ephemeral);
  expect(embeds[0].toJSON().description).toBe(localizedCopy("en-US", "general.restarting"));
}

describe("shutdown interaction admission", () => {
  it("acknowledges slash commands at the global router before command loading", async () => {
    const f = makeFakeInteraction();
    const interaction = Object.assign(f.interaction, {
      locale: Locale.EnglishUS,
      isAutocomplete: () => false,
      isRepliable: () => true,
    }) as unknown as Interaction;
    const client = new Client({ intents: [] });
    await handleCommands(client, interaction);
    await handleCommands(client, interaction);
    expect(f.calls.map((call) => call.method)).toEqual(["reply"]);
    expectRestartingNotice(f.calls[0].args[0]);
    await client.destroy();
  });

  it("blocks collector listeners and routes for components and modal submits", async () => {
    const client = new Client({ intents: [] });
    initializeShutdownInteractionAdmission(client);
    initializeShutdownInteractionAdmission(client);
    const collected = mock(() => {});
    const routed = mock(() => {});
    const collector = new InteractionCollector(client as Client<true>, { filter: () => true });
    collector.on("collect", collected);
    client.on("interactionCreate", routed);
    try {
      for (const kind of ["button", "string-select", "modal"] as const) {
        const f = createRouteInteraction({ kind });
        const interaction = Object.assign(f, {
          isAutocomplete: () => false,
          isRepliable: () => true,
        }) as unknown as Interaction;
        client.emit("interactionCreate", interaction);
        await rejectInteractionDuringShutdown(interaction);
        expect(f.calls.map((call) => call.method)).toEqual(["reply"]);
        expect(f.replies).toHaveLength(1);
        expectRestartingNotice(f.replies[0]);
      }
      expect(collected).not.toHaveBeenCalled();
      expect(routed).not.toHaveBeenCalled();
    } finally {
      collector.stop();
      await client.destroy();
    }
  });

  it("answers autocomplete once with an empty choice list", async () => {
    const client = new Client({ intents: [] });
    initializeShutdownInteractionAdmission(client);
    const respond = mock(async (_choices: unknown[]) => {});
    const interaction = Object.assign(makeFakeInteraction().interaction, {
      isAutocomplete: () => true,
      responded: false,
      respond,
    }) as unknown as Interaction;
    client.emit("interactionCreate", interaction);
    await handleCommands(client, interaction);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith([]);
    await client.destroy();
  });

  it("cancels new modal helpers without pre-deferring or posting a modal", async () => {
    const f = makeFakeInteraction();
    const interaction = Object.assign(f.interaction, {
      locale: Locale.EnglishUS,
      isAutocomplete: () => false,
      isRepliable: () => true,
    }) as unknown as import("discord.js").ChatInputCommandInteraction;
    const options = { modalTitleKey: "general.restarting", modalCustomId: "shutdown-modal", components: [] };
    expect(await promptWithRawModal(interaction, "en-US", options)).toMatchObject({ outcome: "cancelled" });
    expect(await promptWithPaginatedModal(interaction, "en-US", options)).toMatchObject({ outcome: "cancelled" });
    expect(f.calls.map((call) => call.method)).toEqual(["reply"]);
  });

  it("forwards normal interaction events and prevents late ready dispatch while draining", async () => {
    const client = new Client({ intents: [] });
    initializeShutdownInteractionAdmission(client);
    const ready = mock(() => {});
    const received = mock(() => {});
    client.on("clientReady", ready);
    client.on("interactionCreate", received);
    client.emit("clientReady", client as Client<true>);
    expect(ready).not.toHaveBeenCalled();
    draining = false;
    const interaction = createRouteInteraction() as unknown as Interaction;
    expect(client.emit("interactionCreate", interaction)).toBe(true);
    expect(received).toHaveBeenCalledWith(interaction);
    await client.destroy();
  });
});

afterAll(() => gate.mockRestore());
