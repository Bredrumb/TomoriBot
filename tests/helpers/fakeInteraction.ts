export type FakeCall = {
  method: string;
  args: unknown[];
};

export type FakeInteraction = {
  deferred: boolean;
  replied: boolean;
  id: string;
  createdTimestamp: number;
  guild: object | null;
  channel: object | null;
  channelId: string;
  guildId: string | null;
  user: {
    id: string;
    displayName: string;
    globalName: string;
    username: string;
    displayAvatarURL: (_opts?: unknown) => string;
  };
  member: {
    displayAvatarURL: (_opts?: unknown) => string;
  } | null;
  memberPermissions: { has: (_flag: unknown) => boolean } | null;
  options: {
    getString: (_name: string, _required?: boolean) => string | null;
    getInteger?: (_name: string) => number | null;
    getBoolean: (_name: string) => boolean | null;
  };
  webhook: { send: (..._args: unknown[]) => Promise<void> };
  reply: (..._args: unknown[]) => Promise<void>;
  deferReply: (..._args: unknown[]) => Promise<void>;
  showModal: (..._args: unknown[]) => Promise<void>;
  editReply: (..._args: unknown[]) => Promise<void>;
  followUp: (..._args: unknown[]) => Promise<void>;
  deferUpdate: (..._args: unknown[]) => Promise<void>;
  update: (..._args: unknown[]) => Promise<void>;
  fetchReply: () => Promise<{ id: string; createdTimestamp: number }>;
};

export function makeFakeInteraction(overrides: Partial<FakeInteraction> = {}): {
  interaction: FakeInteraction;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];

  // Defined as a plain object so method bodies can close over `interaction` to
  // update `deferred`/`replied` flags synchronously before any awaiter resumes.
  const interaction: FakeInteraction = {
    deferred: false,
    replied: false,
    id: "fake_interaction_id",
    createdTimestamp: Date.now() - 50,

    guild: null,
    channel: null,
    channelId: "fake_channel_id",
    guildId: null,
    user: {
      id: "fake_user_id",
      displayName: "TestUser",
      globalName: "TestUser",
      username: "testuser",
      displayAvatarURL: () => "https://cdn.example.com/avatar.png",
    },
    member: null,
    memberPermissions: null,
    options: {
      getString: () => null,
      getInteger: () => null,
      getBoolean: () => null,
    },
    webhook: {
      send: async (...args: unknown[]) => {
        calls.push({ method: "webhook.send", args });
      },
    },

    reply: async (...args: unknown[]) => {
      calls.push({ method: "reply", args });
      interaction.replied = true;
    },

    deferReply: async (...args: unknown[]) => {
      calls.push({ method: "deferReply", args });
      interaction.deferred = true;
    },

    // Leave replied=false because discord.js does not set it on showModal even though the interaction is consumed.
    showModal: async (...args: unknown[]) => {
      calls.push({ method: "showModal", args });
    },

    editReply: async (...args: unknown[]) => {
      calls.push({ method: "editReply", args });
    },

    followUp: async (...args: unknown[]) => {
      calls.push({ method: "followUp", args });
    },

    deferUpdate: async (...args: unknown[]) => {
      calls.push({ method: "deferUpdate", args });
    },

    update: async (...args: unknown[]) => {
      calls.push({ method: "update", args });
    },

    // Returns a fake message without acknowledging so latency checks do not throw.
    fetchReply: async () => ({
      id: "fake_reply_id",
      createdTimestamp: Date.now(),
    }),
  };

  Object.assign(interaction, overrides);

  return { interaction, calls };
}

export function callMethods(calls: FakeCall[]): string[] {
  return calls.map((call) => call.method);
}
