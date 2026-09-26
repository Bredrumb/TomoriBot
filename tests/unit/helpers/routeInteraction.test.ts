/**
 * Guards the shared route-interaction fake. A route suite observes this object's recording arrays
 * and capability predicates, so a change to what it records has to fail here rather than inside a
 * route suite whose assertion happens to be shaped differently.
 */

import { describe, expect, it } from "bun:test";
import { createRouteInteraction } from "../../helpers/routeInteraction";

describe("route interaction fake", () => {
  it("records each acknowledgement method in call order", async () => {
    const deferred = createRouteInteraction();
    await deferred.deferUpdate();
    await deferred.editReply({ content: "first" });
    await deferred.followUp({ content: "second" });

    expect(deferred.calls.map((call) => call.method)).toEqual(["deferUpdate", "editReply", "followUp"]);
    expect(deferred.edits).toEqual([{ content: "first" }]);
    expect(deferred.replies).toEqual([{ content: "second" }]);

    const replied = createRouteInteraction();
    await replied.reply({ content: "third" });
    expect(replied.replies).toEqual([{ content: "third" }]);
  });

  it("marks the interaction acknowledged so a route can probe it mid-write", async () => {
    const interaction = createRouteInteraction();

    expect({ deferred: interaction.deferred, replied: interaction.replied }).toEqual({
      deferred: false,
      replied: false,
    });

    await interaction.deferReply();
    expect(interaction.deferred).toBe(true);
    expect(interaction.replied).toBe(false);

    const replied = createRouteInteraction();
    await replied.reply({ content: "ack" });
    expect(replied.replied).toBe(true);
  });

  it("rejects a second reply the way discord.js does", async () => {
    const deferred = createRouteInteraction();
    await deferred.deferUpdate();
    await expect(deferred.reply({ content: "late" })).rejects.toThrow("already been sent or deferred");

    const replied = createRouteInteraction();
    await replied.reply({ content: "first" });
    await expect(replied.reply({ content: "second" })).rejects.toThrow("already been sent or deferred");
  });

  it("answers component predicates from the requested kind alone", () => {
    const modal = createRouteInteraction({ kind: "modal" });

    expect({
      button: modal.isButton(),
      stringSelect: modal.isStringSelectMenu(),
      channelSelect: modal.isChannelSelectMenu(),
      modalSubmit: modal.isModalSubmit(),
      chatInput: modal.isChatInputCommand(),
    }).toEqual({ button: false, stringSelect: false, channelSelect: false, modalSubmit: true, chatInput: false });
  });

  it("gates ManageGuild on the manager flag and models a DM with a null guild", () => {
    const manager = createRouteInteraction({ isManager: true });
    const member = createRouteInteraction({ isManager: false });
    const dm = createRouteInteraction({ guildId: null });

    // Some routes compare the bigint flag and others the bare name; both mean the same permission.
    expect(manager.memberPermissions.has(32n)).toBe(true);
    expect(manager.memberPermissions.has("ManageGuild")).toBe(true);
    expect(member.memberPermissions.has(32n)).toBe(false);
    expect(member.memberPermissions.has("ManageGuild")).toBe(false);
    expect(dm.guildId).toBeNull();
    expect(dm.guild).toBeNull();
  });

  it("reports modal field presence from the field IDs the caller declared", () => {
    const interaction = createRouteInteraction({ fields: { nickname_nonce123456: "Mirri" } });

    expect(interaction.fields.fields.get("nickname_nonce123456")).toBe(true);
    expect(interaction.fields.fields.has("absent_nonce123456")).toBe(false);
    expect(interaction.fields.getTextInputValue("nickname_nonce123456")).toBe("Mirri");
    expect(interaction.fields.getTextInputValue("absent_nonce123456")).toBe("");
  });

  it("resolves declared channels from both the guild cache and fetch", async () => {
    const interaction = createRouteInteraction({
      channelCache: new Map([["123456789012345678", { name: "lounge", type: 0 }]]),
    });

    expect(interaction.guild?.channels.cache.get("123456789012345678")).toEqual({ name: "lounge", type: 0 });
    expect(await interaction.guild?.channels.fetch("123456789012345678")).toEqual({
      id: "123456789012345678",
      name: "lounge",
      type: 0,
    });
    expect(await interaction.guild?.channels.fetch("999999999999999999")).toBeUndefined();
  });

  it("applies the identity overrides a suite needs and rejects any other", () => {
    const interaction = createRouteInteraction({ overrides: { id: "modal-step1" } });

    expect(interaction.id).toBe("modal-step1");
    expect(() => createRouteInteraction({ overrides: { channelId: "other" } as never })).toThrow(
      /unknown override "channelId"/,
    );
  });

  it("rejects an identity field passed as a top-level option instead of silently keeping the default", () => {
    expect(() => createRouteInteraction({ user: { id: "user-123" } } as never)).toThrow(
      /unknown option "user"\. Pass it as overrides: \{ user \}/,
    );
    expect(() => createRouteInteraction({ id: "modal-1" } as never)).toThrow(/unknown option "id"/);
  });
});
