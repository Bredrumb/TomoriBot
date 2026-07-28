import { beforeEach, describe, expect, it, mock } from "bun:test";
import { MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { TomoriState, UserRow } from "@/types/db/schema";

type Payload = Record<string, unknown>;

const renderedPayloads: Payload[] = [];
const invalidations: string[] = [];
const writes: Array<{ personaId: number; values: Payload }> = [];
const rootCalls: Array<{ method: string; payload: unknown }> = [];
const directives: string[] = [];
const chronology: string[] = [];
const logCalls: Array<{ message: string; error: unknown; context: Payload | undefined }> = [];

let selectedPersona: TomoriState;

function resetPersona(): TomoriState {
  return {
    server_id: 7,
    persona_id: 77,
    persona_nickname: "Kayra",
    nai_attg_author: "Old Author",
    nai_attg_title: "Old Title",
    nai_attg_tags: "old, tags",
    nai_attg_genre: "Old Genre",
    nai_attg_stars: 2,
  } as TomoriState;
}

const controller = {
  anchorMessageId: "anchor-attg",
  replace: async (payload: unknown) => {
    chronology.push("message.replace");
    renderedPayloads.push(payload as Payload);
  },
};

mock.module("@/utils/cache/tomoriStateCache", () => ({
  invalidateTomoriStateCache: (serverDiscId: string) => {
    chronology.push("cache.invalidate");
    invalidations.push(serverDiscId);
  },
}));

mock.module("@/utils/db/repositories", () => ({
  personaRepository: {
    loadAllForServer: async () => [selectedPersona],
    setNaiAttg: async (personaId: number, values: Payload) => {
      chronology.push("repo.setNaiAttg");
      writes.push({ personaId, values });
      return false;
    },
  },
}));

mock.module("@/utils/discord/interactionHelper", () => ({
  replyInfoEmbed: async () => undefined,
}));

mock.module("@/utils/misc/logger", () => ({
  ColorCode: {
    INFO: "#3498DB",
    SUCCESS: "#2ECC71",
    WARN: "#F1C40F",
    ERROR: "#E74C3C",
  },
  log: {
    info: () => undefined,
    error: async (message: string, error: unknown, context?: Payload) => {
      chronology.push("log.error");
      logCalls.push({ message, error, context });
    },
  },
}));

mock.module("@/utils/discord/ui/personaWorkflow", () => ({
  buildPersonaWorkflowNotice: (options: Payload) => options,
  completePersonaWorkflow: () => ({ action: "complete" }),
  retryPersonaWorkflow: () => ({ action: "retry" }),
  runPersonaPickerWorkflow: async (
    _interaction: ChatInputCommandInteraction,
    _locale: string,
    options: {
      onSelected: (selection: unknown) => Promise<{ action: string }>;
    },
  ) => {
    const directive = await options.onSelected({
      persona: selectedPersona,
      message: controller,
      beginInPlaceWork: async () => ({ message: controller }),
      openModal: async () => ({
        outcome: "submitted",
        phase: {
          values: {
            nai_attg_author: "New Author",
            nai_attg_title: "New Title",
            nai_attg_tags: "new, tags",
            nai_attg_genre: "New Genre",
            nai_attg_stars: "5",
          },
          beginInPlaceWork: async () => ({ message: controller }),
        },
      }),
    });
    directives.push(directive.action);
    return { outcome: "selected", persona: selectedPersona, absoluteIndex: 0 };
  },
}));

function makeInteraction(): ChatInputCommandInteraction {
  const interaction = {
    deferred: false,
    replied: false,
    guild: { id: "guild-1" },
    user: { id: "user-1" },
    deferReply: async (payload: unknown) => {
      interaction.deferred = true;
      rootCalls.push({ method: "deferReply", payload });
    },
  };
  return interaction as unknown as ChatInputCommandInteraction;
}

const userData = {
  user_id: 4,
  user_disc_id: "user-1",
  language_pref: "en-US",
} as UserRow;

beforeEach(() => {
  selectedPersona = resetPersona();
  renderedPayloads.length = 0;
  invalidations.length = 0;
  writes.length = 0;
  rootCalls.length = 0;
  directives.length = 0;
  chronology.length = 0;
  logCalls.length = 0;
});

describe("/novelai attg persona workflow", () => {
  it("keeps selected ATTG state unchanged and invalidates after a false write result", async () => {
    const { execute } = await import("@/commands/novelai/attg");
    await execute({} as Client, makeInteraction(), userData, "en-US");

    expect(rootCalls).toEqual([{ method: "deferReply", payload: { flags: MessageFlags.Ephemeral } }]);
    expect(writes).toEqual([
      {
        personaId: 77,
        values: {
          nai_attg_author: "New Author",
          nai_attg_title: "New Title",
          nai_attg_tags: "new, tags",
          nai_attg_genre: "New Genre",
          nai_attg_stars: 5,
        },
      },
    ]);
    expect(selectedPersona).toMatchObject({
      nai_attg_author: "Old Author",
      nai_attg_title: "Old Title",
      nai_attg_tags: "old, tags",
      nai_attg_genre: "Old Genre",
      nai_attg_stars: 2,
    });
    expect(invalidations).toEqual(["guild-1"]);
    expect(directives).toEqual(["complete"]);
    expect(logCalls).toHaveLength(1);
    expect(logCalls[0]).toMatchObject({
      message: "Failed to update NovelAI ATTG metadata",
      error: expect.any(Error),
      context: {
        userId: 4,
        serverId: 7,
        personaId: 77,
        errorType: "DatabaseUpdateError",
        metadata: {
          command: "novelai attg",
          guildId: "guild-1",
          isClearing: false,
          targetTable: "persona_configs",
        },
      },
    });
    expect(chronology).toEqual(["repo.setNaiAttg", "cache.invalidate", "log.error", "message.replace"]);
    expect(renderedPayloads).toContainEqual(
      expect.objectContaining({
        titleKey: "general.errors.update_failed_title",
        descriptionKey: "general.errors.update_failed_description",
      }),
    );
    expect(renderedPayloads.some((payload) => payload.titleKey === "commands.novelai.attg.success_title")).toBe(false);
    expect(renderedPayloads.some((payload) => payload.titleKey === "commands.novelai.attg.cleared_title")).toBe(false);
  });
});
