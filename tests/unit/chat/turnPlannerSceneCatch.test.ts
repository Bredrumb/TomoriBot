import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { TextChannel, type Message } from "discord.js";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import * as userCache from "@/utils/cache/userCache";
import * as admissionGuards from "@/utils/chat/admissionGuards";
import * as errorVisibility from "@/utils/chat/errorVisibility";
import { normalizeChatInvocation } from "@/utils/chat/admission";
import { planChatTurns } from "@/utils/chat/turnPlanner";
import type { LockedChatTurn } from "@/utils/chat/types";
import { observeWelcomeReply, trackWelcomeReply } from "@/utils/chat/welcomeReply";
import * as credentialResolver from "@/utils/provider/credentialResolver";
import * as textModels from "@/utils/provider/textModelSelection";
import { userNamingRepository } from "@/utils/db/repositories/UserNamingRepository";
import { createPersona, createUserRow } from "../../helpers/fixtures";

const CHANNEL_ID = "100000000000000101";
const MIRRI = createPersona({
  persona_id: 5,
  server_id: 7,
  persona_nickname: "Mirri",
  is_alter: false,
  config: { welcome_channel_disc_id: CHANNEL_ID, welcome_prompt: "Greet the new member" },
});
const BAU = createPersona({ persona_id: 6, server_id: 7, persona_nickname: "Bau", is_alter: true });
const JUNO = createPersona({
  persona_id: 7,
  server_id: 7,
  persona_nickname: "Juno",
  is_alter: true,
  trigger_words: ["juno"],
});

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

async function planImplicitReply(
  content: string,
  options: { personalDtm?: "off" | "on"; welcome?: boolean; allowedPersonaIds?: Set<number> } = {},
): Promise<number[]> {
  const personas = [MIRRI, BAU, JUNO];
  const member = createUserRow({
    user_id: 77,
    user_disc_id: "100000000000000077",
    personal_dtm: options.personalDtm ?? "off",
  });
  const client = { user: { id: "fixture-bot" } };
  const guild = { id: "fixture-guild", preferredLocale: "en-US", members: { fetch: async () => null } };
  const channel = Object.assign(Object.create(TextChannel.prototype), {
    id: CHANNEL_ID,
    type: 0,
    isThread: () => false,
  });
  const message = {
    id: "100000000000000203",
    channelId: channel.id,
    author: { id: member.user_disc_id, username: "member", bot: false },
    webhookId: null,
    channel,
    guild,
    client,
    member: null,
    content,
    mentions: { users: new Map(), roles: new Map(), everyone: false },
    reference: null,
    attachments: new Map(),
    embeds: [],
  } as unknown as Message;
  if (options.welcome) {
    const welcome = trackWelcomeReply(channel, member.user_disc_id, 6, personas);
    await welcome.confirm("100000000000000202");
    await observeWelcomeReply(message, Promise.resolve(null));
  }
  const incoming = normalizeChatInvocation({
    client: message.client,
    message,
    isFromQueue: true,
    nudgeSceneCatcherPersonaId: options.welcome ? undefined : BAU.persona_id,
  });
  const lockedTurn = {
    channelId: channel.id,
    admission: {
      incoming,
      client,
      message,
      channel,
      guild,
      serverDiscId: guild.id,
      userDiscId: member.user_disc_id,
      isDMChannel: false,
      allPersonas: personas,
      tomoriState: MIRRI,
      referencedMessage: null,
      locale: "en-US",
    },
  } as unknown as LockedChatTurn;

  spies.push(
    spyOn(textModels, "resolveServerTextModel").mockImplementation(async (state) => state.persona_llm ?? state.llm),
    spyOn(credentialResolver, "resolvePersonalCapabilityCredentials").mockResolvedValue(null),
    spyOn(tomoriStateCache, "getCachedAllPersonas").mockResolvedValue(personas),
    spyOn(userCache, "getCachedUserRow").mockResolvedValue(member),
    spyOn(userCache, "getCachedBlacklistStatus").mockResolvedValue(false),
    spyOn(userCache, "getCachedPrivacyLevel").mockResolvedValue(0),
    spyOn(userNamingRepository, "loadPreferences").mockResolvedValue(new Map()),
    spyOn(admissionGuards, "enforceGlobalRateLimit").mockResolvedValue(true),
    spyOn(admissionGuards, "enforceServerTriggerCooldownForAdmission").mockResolvedValue(true),
    spyOn(admissionGuards, "checkTextQuotaForAdmission").mockResolvedValue({ allowed: true, state: null } as never),
    spyOn(errorVisibility, "shouldSurfaceChatUserErrors").mockReturnValue(false),
    spyOn(admissionGuards, "validateDirectChatTrigger").mockResolvedValue({
      shouldContinue: true,
      isUserImpersonation: false,
      isReplyToBot: false,
      replyPersona: null,
      isBotMentioned: false,
    } as never),
    spyOn(admissionGuards, "evaluateChatAccess").mockResolvedValue({
      rejectedByWhitelist: false,
      allowedPersonaIds: options.allowedPersonaIds ?? null,
      whitelistStatus: undefined,
      personalSpotlightStatus: null,
    } as never),
    spyOn(credentialResolver, "resolveCapabilityCredentials").mockResolvedValue({
      source: "server",
      provider: "google",
    } as never),
  );
  const plan = await planChatTurns(lockedTurn);
  return plan.turns.map((turn) => turn.persona.persona_id as number);
}

describe("a member interrupting a Natural Nudges scene", () => {
  it("is answered by the next scripted speaker when the message addresses nobody", async () => {
    expect(await planImplicitReply("よ")).toEqual([BAU.persona_id as number]);
  });

  it("is answered by the persona the member named instead", async () => {
    expect(await planImplicitReply("juno, what are you two plotting?")).toEqual([JUNO.persona_id as number]);
  });

  it("is not answered for merely joining when the member chose deliberate triggers, or wrote a bot command", async () => {
    expect(await planImplicitReply("よ", { personalDtm: "on" })).toEqual([]);
    expect(await planImplicitReply("!roll d20")).toEqual([]);
  });
});

describe("a member replying to their welcome", () => {
  it("plans a normal member turn with the welcoming persona", async () => {
    expect(await planImplicitReply("Thanks!", { welcome: true })).toEqual([BAU.persona_id as number]);
  });

  it("uses the persona the member explicitly addresses", async () => {
    expect(await planImplicitReply("juno, where should I start?", { welcome: true })).toEqual([
      JUNO.persona_id as number,
    ]);
  });

  it("respects deliberate triggers and persona access", async () => {
    expect(await planImplicitReply("Thanks!", { welcome: true, personalDtm: "on" })).toEqual([]);
    expect(await planImplicitReply("Thanks!", { welcome: true, allowedPersonaIds: new Set([5, 7]) })).toEqual([]);
  });
});
