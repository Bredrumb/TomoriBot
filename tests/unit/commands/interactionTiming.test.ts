import { describe, expect, it, mock, spyOn } from "bun:test";
import type { Client } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { makeFakeInteraction, callMethods } from "../../helpers/fakeInteraction";
import { createScopedModuleMocker, overrideMembers, stubLogMembers } from "../../helpers/mockSurface";
// Capture real namespaces before mock.module runs so process-global mocks keep full exports.
import * as realTomoriStateCache from "@/utils/cache/tomoriStateCache";
import * as realRepositories from "@/utils/db/repositories";
import * as realInteractionCore from "@/utils/discord/ui/interactionCore";
import * as realLocalizer from "@/utils/text/localizer";

// Spreading realInteractionCore keeps ColorCode hex strings intact, so load-time string calls succeed.
const scopedMock = createScopedModuleMocker(mock, {
  "@/utils/text/localizer": realLocalizer,
  "@/utils/discord/ui/interactionCore": realInteractionCore,
  "@/utils/cache/tomoriStateCache": realTomoriStateCache,
  "@/utils/db/repositories": realRepositories,
});

stubLogMembers({
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  success: () => undefined,
  section: () => undefined,
});

scopedMock.module("@/utils/text/localizer", () => ({
  ...realLocalizer,
  // Image-footer keys stay rendered in this localizer stub because generated-image payload tests can run later in the
  // same Bun process under this global mock.
  localizer: (_locale: string, key: string, vars?: Record<string, string>) => {
    if (key === "tools.image.generated_after_seconds_line") {
      return `Generated after ${vars?.seconds ?? ""} seconds`;
    }
    if (key === "tools.image.referenced_identities_line") {
      return `Referenced: ${vars?.names ?? ""}`;
    }
    return key;
  },
  initializeLocalizer: async () => undefined,
}));

// Mocking interactionCore rather than ui/modals or ui/embeds ensures all UI barrels share one stub without
// duplicate-binding conflicts in the barrel chain.
scopedMock.module("@/utils/discord/ui/interactionCore", () => ({
  ...realInteractionCore,
  replyInfoEmbed: async (
    interaction: {
      deferred: boolean;
      replied: boolean;
      reply: (...a: unknown[]) => Promise<void>;
      editReply: (...a: unknown[]) => Promise<void>;
    },
    _locale: string,
    _options: unknown,
    _flags?: unknown,
  ) => {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({});
    } else {
      await interaction.reply({});
    }
  },
  promptWithRawModal: async (
    interaction: { showModal: (...a: unknown[]) => Promise<void> },
    _locale: string,
    _options: unknown,
    _flags?: unknown,
  ) => {
    await interaction.showModal({});
    return { outcome: "timeout" as const };
  },
  promptWithPaginatedModal: async (
    interaction: { showModal: (...a: unknown[]) => Promise<void> },
    _locale: string,
    _options: unknown,
  ) => {
    await interaction.showModal({});
    return { outcome: "timeout" as const };
  },
  safeSelectOptionText: (text: string) => text,
  replySummaryEmbed: async () => undefined,
  replyComponentsV2Status: async () => undefined,
  acknowledgeModalSubmitForRefresh: async () => undefined,
  promptWithConfirmation: async () => ({ confirmed: false }),
  promptWithUnacknowledgedConfirmation: async () => ({ confirmed: false }),
  replyPaginatedChoices: async () => ({ outcome: "timeout" }),
  replyPaginatedPersonaChoicesV2: async () => ({ outcome: "timeout", reason: "timeout" }),
}));

const fakeTomoriState = {
  server_id: 1,
  persona_id: 1,
  persona_nickname: "Tomori",
  is_alter: false,
  config: {
    uncensor_injection_enabled: false,
    uncensor_unicode_space_enabled: false,
    uncensor_sanitize_enabled: false,
  },
};

scopedMock.module("@/utils/cache/tomoriStateCache", () => ({
  ...realTomoriStateCache,
  getCachedTomoriState: async () => fakeTomoriState,
  invalidateTomoriStateCache: () => undefined,
  getLastDbError: () => null,
}));

// Bun's mock registry is global and last-wins across files, so this spreads realRepositories rather than relying on
// another file's factory.
scopedMock.module("@/utils/db/repositories", () => ({
  ...realRepositories,
  configRepository: overrideMembers(realRepositories.configRepository, {
    updateNsfwConfig: async () => true,
  }),
  personaRepository: overrideMembers(realRepositories.personaRepository, {
    loadAllForServer: async () => [],
    hasNicknameConflict: async () => false,
    renamePersona: async () => true,
    addTrigger: async () => true,
  }),
  llmProviderRepo: overrideMembers(realRepositories.llmProviderRepo, {
    loadSavedProviderConfig: async () => null,
  }),
  userRepository: overrideMembers(realRepositories.userRepository, {
    loadOrCreateUser: async () => null,
    updateLastSeen: async () => undefined,
  }),
  serverRepository: overrideMembers(realRepositories.serverRepository, {
    loadServerState: async () => null,
  }),
}));

function makeUserData(): UserRow {
  return {
    user_id: 1,
    user_disc_id: "fake_user_id",
    language_pref: "en-US",
  } as unknown as UserRow;
}

function makeClient(): Client {
  return {} as unknown as Client;
}

// Channel type 0 (GuildText) is set so isGuildMessageCommandChannel passes without mocking its module.
function makeFakeGuildChannel(): object {
  return {
    type: 0,
    id: "fake_channel_id",
    send: async () => ({ id: "sent_msg_id" }),
  };
}

describe("Contract 1: modal command /nsfw jailbreaks", () => {
  it("calls showModal() as the only interaction acknowledgement", async () => {
    const { interaction, calls } = makeFakeInteraction({
      guild: { id: "guild_1" },
      channel: makeFakeGuildChannel(),
      guildId: "guild_1",
      user: {
        id: "fake_user_id",
        displayName: "TestUser",
        globalName: "TestUser",
        username: "testuser",
        displayAvatarURL: () => "https://cdn.example.com/avatar.png",
      },
    });

    const { execute } = await import("@/commands/nsfw/jailbreaks");
    await execute(makeClient(), interaction as never, makeUserData(), "en-US");

    expect(callMethods(calls)).toEqual(["showModal"]);
  });

  it("does not call deferReply() before showModal()", async () => {
    const { interaction, calls } = makeFakeInteraction({
      guild: { id: "guild_1" },
      channel: makeFakeGuildChannel(),
      guildId: "guild_1",
      user: {
        id: "fake_user_id",
        displayName: "TestUser",
        globalName: "TestUser",
        username: "testuser",
        displayAvatarURL: () => "https://cdn.example.com/avatar.png",
      },
    });

    const { execute } = await import("@/commands/nsfw/jailbreaks");
    await execute(makeClient(), interaction as never, makeUserData(), "en-US");

    const methods = callMethods(calls);
    const deferIndex = methods.indexOf("deferReply");
    const modalIndex = methods.indexOf("showModal");

    expect(modalIndex).toBeGreaterThanOrEqual(0);
    expect(deferIndex).toBe(-1);
  });

  it("does not call reply() on the slash interaction", async () => {
    const { interaction, calls } = makeFakeInteraction({
      guild: { id: "guild_1" },
      channel: makeFakeGuildChannel(),
      guildId: "guild_1",
      user: {
        id: "fake_user_id",
        displayName: "TestUser",
        globalName: "TestUser",
        username: "testuser",
        displayAvatarURL: () => "https://cdn.example.com/avatar.png",
      },
    });

    const { execute } = await import("@/commands/nsfw/jailbreaks");
    await execute(makeClient(), interaction as never, makeUserData(), "en-US");

    expect(callMethods(calls)).not.toContain("reply");
    expect(callMethods(calls)).not.toContain("deferReply");
  });
});

describe("Contract 2: async defer command /ping", () => {
  it("calls deferReply() as the first acknowledgement", async () => {
    const { interaction, calls } = makeFakeInteraction();

    const { execute } = await import("@/commands/ping");
    await execute(makeClient(), interaction as never, makeUserData(), "en-US");

    expect(calls[0]?.method).toBe("deferReply");
  });

  it("follows deferReply() with editReply() — not a second reply()", async () => {
    const { interaction, calls } = makeFakeInteraction();

    const { execute } = await import("@/commands/ping");
    await execute(makeClient(), interaction as never, makeUserData(), "en-US");

    const methods = callMethods(calls);
    expect(methods[0]).toBe("deferReply");
    expect(methods[1]).toBe("editReply");
    expect(methods).not.toContain("reply");
  });

  it("produces exactly two acknowledgement calls: deferReply then editReply", async () => {
    const { interaction, calls } = makeFakeInteraction();

    const { execute } = await import("@/commands/ping");
    await execute(makeClient(), interaction as never, makeUserData(), "en-US");

    expect(callMethods(calls)).toEqual(["deferReply", "editReply"]);
  });
});

describe("/persona remove interaction timing", () => {
  it("acknowledges the command before loading personas and updates the reply when none can be removed", async () => {
    const { interaction, calls } = makeFakeInteraction({
      guild: { id: "fixture-guild" },
      guildId: "fixture-guild",
      memberPermissions: { has: () => true },
      options: { getString: () => "3", getBoolean: () => null },
    });
    const { personaRepository } = await import("@/utils/db/repositories");
    const load = spyOn(personaRepository, "loadAllForServer").mockImplementation(async () => {
      expect(interaction.deferred).toBe(true);
      return [];
    });
    try {
      const { execute } = await import("@/commands/persona/remove");
      await execute(makeClient(), interaction as never, makeUserData(), "en-US");
      expect(load).toHaveBeenCalledWith("fixture-guild");
      expect(callMethods(calls)).toEqual(["deferReply", "editReply"]);
    } finally {
      load.mockRestore();
    }
  });
});

describe("Contract 3: /comment acknowledgement ordering", () => {
  it("non-guild early-exit: sends exactly one reply() with no prior deferReply()", async () => {
    const { interaction, calls } = makeFakeInteraction({
      guild: null,
      channel: null,
    });

    const { execute } = await import("@/commands/comment");
    await execute(makeClient(), interaction as never, makeUserData(), "en-US");

    const methods = callMethods(calls);
    expect(methods).toEqual(["reply"]);
    expect(methods).not.toContain("deferReply");
  });

  it("non-guild path: interaction is not acknowledged twice", async () => {
    const { interaction, calls } = makeFakeInteraction({
      guild: null,
      channel: null,
    });

    const { execute } = await import("@/commands/comment");
    await execute(makeClient(), interaction as never, makeUserData(), "en-US");

    const methods = callMethods(calls);
    const hasReply = methods.includes("reply");
    const hasDefer = methods.includes("deferReply");
    expect(hasReply && hasDefer).toBe(false);
  });

  it("normal path: deferReply() is first; editReply() follows; no reply() present", async () => {
    const fakeChannel = makeFakeGuildChannel();
    const { interaction, calls } = makeFakeInteraction({
      guild: { id: "guild_1" },
      channel: fakeChannel,
      guildId: "guild_1",
      user: {
        id: "fake_user_id",
        displayName: "TestUser",
        globalName: "TestUser",
        username: "testuser",
        displayAvatarURL: () => "https://cdn.example.com/avatar.png",
      },
      member: {
        displayAvatarURL: () => "https://cdn.example.com/member_avatar.png",
      },
      options: {
        getString: (_name: string, _required?: boolean) => "This is a test comment.",
        getBoolean: () => null,
      },
    });

    const { execute } = await import("@/commands/comment");
    await execute(makeClient(), interaction as never, makeUserData(), "en-US");

    const methods = callMethods(calls);

    expect(methods[0]).toBe("deferReply");
    expect(methods).toContain("editReply");
    expect(methods).not.toContain("reply");
  });

  it("normal path: interaction is not double-acknowledged", async () => {
    const fakeChannel = makeFakeGuildChannel();
    const { interaction, calls } = makeFakeInteraction({
      guild: { id: "guild_1" },
      channel: fakeChannel,
      guildId: "guild_1",
      user: {
        id: "fake_user_id",
        displayName: "TestUser",
        globalName: "TestUser",
        username: "testuser",
        displayAvatarURL: () => "https://cdn.example.com/avatar.png",
      },
      member: {
        displayAvatarURL: () => "https://cdn.example.com/member_avatar.png",
      },
      options: {
        getString: (_name: string, _required?: boolean) => "Double-ack check.",
        getBoolean: () => null,
      },
    });

    const { execute } = await import("@/commands/comment");
    await execute(makeClient(), interaction as never, makeUserData(), "en-US");

    const methods = callMethods(calls);
    expect(methods.filter((m) => m === "reply").length).toBe(0);
    expect(methods.filter((m) => m === "deferReply").length).toBeLessThanOrEqual(1);
  });
});

describe("/booru search rating denial acknowledges before any deferral", () => {
  function makeBooruInteraction(options: { rating: string | null }) {
    return makeFakeInteraction({
      guild: { id: "guild_1" },
      guildId: "guild_1",
      channel: { isDMBased: () => false, isThread: () => false, nsfw: false },
      options: {
        getString: (name: string) => (name === "tag" ? "ryza" : name === "rating" ? options.rating : null),
        getBoolean: () => null,
      },
    });
  }

  it.each([
    "questionable",
    "explicit",
  ])("replies once without deferring for %s outside an age-restricted channel", async (rating) => {
    const { interaction, calls } = makeBooruInteraction({ rating });

    const { execute } = await import("@/commands/booru/search");
    await execute(makeClient(), interaction as never, makeUserData(), "en-US");

    expect(callMethods(calls)).toEqual(["reply"]);
  });
});
