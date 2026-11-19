import type { FakeCall } from "./fakeInteraction";
import { Collection, type Attachment } from "discord.js";

type RouteInteractionKind = "button" | "string-select" | "channel-select" | "modal";

interface RouteInteractionCall extends FakeCall {
  payload?: unknown;
}

export interface RouteGuildChannel {
  name: string;
  type: number;
}

interface RouteModalFields {
  fields: Map<string, boolean>;
  getTextInputValue: (fieldId: string) => string;
}

export interface RouteInteraction {
  id: string;
  customId: string;
  user: { id: string; username: string; displayName: string; globalName: string; displayAvatarURL?: () => string };
  locale: string;
  channelId: string;
  channel: { id: string; name: string; type: number; isThread: () => boolean; send: () => Promise<unknown> };
  guildId: string | null;
  guild: {
    id: string;
    name: string;
    channels: { fetch: (id: string) => Promise<unknown>; cache: Map<string, unknown> };
    members: { me: unknown; fetch: (id: string) => Promise<unknown> };
  } | null;
  client: { user: unknown };
  memberPermissions: { has: (flag: unknown) => boolean };
  values: string[];
  attachmentSizeLimit: number;
  message: { attachments: Collection<string, Pick<Attachment, "id" | "name" | "size">> };
  fields: RouteModalFields;
  deferred: boolean;
  replied: boolean;
  edits: unknown[];
  replies: unknown[];
  calls: RouteInteractionCall[];
  isButton: () => boolean;
  isStringSelectMenu: () => boolean;
  isChannelSelectMenu: () => boolean;
  isModalSubmit: () => boolean;
  isChatInputCommand: () => boolean;
  deferReply: (payload?: unknown) => Promise<void>;
  deferUpdate: (payload?: unknown) => Promise<void>;
  reply: (payload?: unknown) => Promise<unknown>;
  editReply: (payload?: unknown) => Promise<unknown>;
  followUp: (payload?: unknown) => Promise<unknown>;
  showModal: (payload?: unknown) => Promise<void>;
  update: (payload?: unknown) => Promise<unknown>;
  fetchReply: () => Promise<{ id: string; createdTimestamp: number }>;
  webhook: { send: (payload?: unknown) => Promise<unknown> };
}

export interface RouteInteractionOptions {
  customId?: string;
  kind?: RouteInteractionKind;
  // `null` selects a DM workspace because omitting `guildId` defaults to a guild workspace.
  guildId?: string | null;
  // This fake grants only `ManageGuild` (defaulting to true) because every other permission flag is denied, so routes
  // checking another flag need their own fake.
  isManager?: boolean;
  values?: string[];
  attachmentSizeLimit?: number;
  messageAttachments?: ReadonlyArray<Pick<Attachment, "id" | "name" | "size">>;
  onEditReply?: (payload: unknown) => Promise<unknown>;
  fields?: Record<string, string>;
  fetch?: (channelId: string) => Promise<unknown>;
  channelCache?: ReadonlyMap<string, RouteGuildChannel>;
  overrides?: Partial<Pick<RouteInteraction, "id" | "user">>;
}

const IDENTITY_OVERRIDE_KEYS = new Set(["id", "user"]);

// Destructuring and spread options bypass excess-property checks, so OPTION_KEYS catches
// misplaced keys like a top-level user.
const OPTION_KEYS = new Set<string>([
  "customId",
  "kind",
  "guildId",
  "isManager",
  "values",
  "attachmentSizeLimit",
  "messageAttachments",
  "onEditReply",
  "fields",
  "fetch",
  "channelCache",
  "overrides",
] satisfies (keyof RouteInteractionOptions)[]);

const GUILD_TEXT = 0;

// `32n` is `PermissionsBitField.Flags.ManageGuild` and both bigint and string forms are kept because different routes
// check either spelling.
const MANAGE_GUILD_FLAG = 32n;
const MANAGE_GUILD_NAME = "ManageGuild";

export function createRouteInteraction(options: RouteInteractionOptions = {}): RouteInteraction {
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.has(key)) {
      const hint = IDENTITY_OVERRIDE_KEYS.has(key) ? ` Pass it as overrides: { ${key} }.` : "";
      throw new Error(`createRouteInteraction: unknown option "${key}".${hint}`);
    }
  }

  const {
    customId = "config:v2:test-action:en-US",
    kind = "button",
    guildId = "guild-1",
    isManager = true,
    values = [],
    attachmentSizeLimit = 10 * 1024 * 1024,
    messageAttachments = [],
    onEditReply,
    fields = {},
    fetch,
    channelCache,
    overrides = {},
  } = options;

  for (const key of Object.keys(overrides)) {
    if (!IDENTITY_OVERRIDE_KEYS.has(key)) {
      throw new Error(
        `createRouteInteraction: unknown override "${key}". Add it as an option so the factory keeps recording the behavior it drives.`,
      );
    }
  }

  const calls: RouteInteractionCall[] = [];
  const edits: unknown[] = [];
  const replies: unknown[] = [];
  // A modal submit reports field presence, so the map holds the declared field IDs rather than values.
  const modalFields = new Map(Object.keys(fields).map((fieldId) => [fieldId, true]));

  const inGuild = guildId !== null;

  // `channels.fetch` answers the same rows the cache holds, so a route that resolves a channel
  // either way sees one consistent guild rather than two fixtures that can disagree.
  const channelCacheStore = new Map<string, unknown>(channelCache ?? []);
  const fetchChannel =
    fetch ??
    (async (channelId: string) =>
      channelCacheStore.has(channelId)
        ? { id: channelId, ...(channelCacheStore.get(channelId) as RouteGuildChannel) }
        : undefined);

  const interaction: RouteInteraction = {
    id: "interaction-1",
    customId,
    user: {
      id: "user-1",
      username: "Mirri",
      displayName: "Mirri",
      globalName: "Mirri",
      displayAvatarURL: () => "https://cdn.example.invalid/avatar.png",
    },
    locale: "en-US",
    channelId: "channel-1",
    channel: {
      id: "channel-1",
      name: "lounge",
      type: GUILD_TEXT,
      isThread: () => false,
      send: async () => undefined,
    },
    guildId,
    guild: inGuild
      ? {
          id: guildId,
          name: "Juno Lounge",
          channels: {
            fetch: fetchChannel,
            cache: channelCacheStore,
          },
          members: { me: null, fetch: async () => null },
        }
      : null,
    client: { user: null },
    memberPermissions: {
      has: (flag: unknown) => isManager && (flag === MANAGE_GUILD_FLAG || flag === MANAGE_GUILD_NAME),
    },
    values,
    attachmentSizeLimit,
    message: { attachments: new Collection(messageAttachments.map((attachment) => [attachment.id, attachment])) },
    fields: {
      fields: modalFields,
      getTextInputValue: (fieldId: string) => fields[fieldId] ?? "",
    },
    deferred: false,
    replied: false,
    edits,
    replies,
    calls,

    isButton: () => kind === "button",
    isStringSelectMenu: () => kind === "string-select",
    isChannelSelectMenu: () => kind === "channel-select",
    isModalSubmit: () => kind === "modal",
    isChatInputCommand: () => false,

    deferReply: async (payload?: unknown) => {
      calls.push({ method: "deferReply", args: [payload], payload });
      interaction.deferred = true;
    },
    deferUpdate: async (payload?: unknown) => {
      calls.push({ method: "deferUpdate", args: [payload], payload });
      interaction.deferred = true;
    },
    reply: async (payload?: unknown) => {
      calls.push({ method: "reply", args: [payload], payload });
      // Mirrors discord.js InteractionAlreadyReplied, which a permissive fake let ship once.
      if (interaction.deferred || interaction.replied) {
        throw new Error("The reply to this interaction has already been sent or deferred.");
      }
      replies.push(payload);
      interaction.replied = true;
      return payload;
    },
    editReply: async (payload?: unknown) => {
      calls.push({ method: "editReply", args: [payload], payload });
      edits.push(payload);
      if (onEditReply) return onEditReply(payload);
      return payload;
    },
    followUp: async (payload?: unknown) => {
      calls.push({ method: "followUp", args: [payload], payload });
      replies.push(payload);
      return payload;
    },
    showModal: async (payload?: unknown) => {
      calls.push({ method: "showModal", args: [payload], payload });
    },
    update: async (payload?: unknown) => {
      calls.push({ method: "update", args: [payload], payload });
      return payload;
    },
    fetchReply: async () => ({ id: "fake_reply_id", createdTimestamp: Date.now() }),
    webhook: {
      send: async (payload?: unknown) => {
        calls.push({ method: "webhook.send", args: [payload], payload });
        return undefined;
      },
    },
  };

  Object.assign(interaction, overrides);

  return interaction;
}

export function createInteractionRecorder() {
  const recorded: RouteInteraction[] = [];
  return {
    get edits(): unknown[] {
      return recorded.flatMap((interaction) => interaction.edits);
    },
    get replies(): unknown[] {
      return recorded.flatMap((interaction) => interaction.replies);
    },
    get calls(): RouteInteraction["calls"] {
      return recorded.flatMap((interaction) => interaction.calls);
    },
    record(interaction: RouteInteraction): void {
      recorded.push(interaction);
    },
  };
}
