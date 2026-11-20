import { type Guild, GuildFeature, type GuildMember, GuildMemberFlags } from "discord.js";
import { log } from "@/utils/misc/logger";
import { WELCOME_DELAY_MS, waitForWelcomeDelay } from "@/events/guildMemberAdd/helpers/welcomeDelay";

// Maximum waiter lifetime before dropping without greeting, because Discord sends no event when a member abandons
// onboarding.
const WELCOME_GATE_MAX_WAIT_MS = 60 * 60 * 1000;

type WelcomeGateOutcome = "open" | "ended" | "expired";

// Result carries the freshest member state seen while waiting so greetings do not use stale join-time names or
// avatars.
export interface WelcomeGateResult {
  outcome: WelcomeGateOutcome;
  member: GuildMember;
}

export interface WelcomeGateOptions {
  maxWaitMs?: number;
  fallbackDelayMs?: number;
}

interface PendingWelcome {
  // Freshest member state seen, needed because a gateway update can arrive before the async onboarding lookup
  // returns.
  latest: GuildMember;
  isOpen: ((member: GuildMember) => boolean) | null;
  finish: (outcome: WelcomeGateOutcome) => void;
}

const pendingWelcomes = new Map<string, PendingWelcome>();

// Guild IDs already logged as unreadable so repeated onboarding lookup failures do not spam logs on every join.
const unreadableOnboardingGuilds = new Set<string>();

function gateKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

// Discord never sets CompletedOnboarding unless the guild enables Onboarding, so non-onboarding guilds must bypass
// that flag check.
export function isWelcomeGateOpen(member: GuildMember, onboardingEnabled: boolean): boolean {
  if (member.pending) return false;
  return !onboardingEnabled || member.flags.has(GuildMemberFlags.CompletedOnboarding);
}

// Lookup failures return null without caching or defaulting to false, because assuming disabled would greet members
// still in onboarding.
async function fetchOnboardingEnabled(guild: Guild): Promise<boolean | null> {
  // Onboarding requires Community, so a non-Community guild cannot have it and the lookup is skipped.
  if (!guild.features.includes(GuildFeature.Community)) return false;

  try {
    return (await guild.fetchOnboarding()).enabled;
  } catch (error) {
    if (!unreadableOnboardingGuilds.has(guild.id)) {
      unreadableOnboardingGuilds.add(guild.id);
      // log.warn is dropped under RUN_ENV=production, and this degrades every onboarding guild.
      log.error(`Could not read onboarding config for guild ${guild.id}; falling back to a timed welcome`, error);
    }
    return null;
  }
}

export async function waitForWelcomeGate(
  member: GuildMember,
  options: WelcomeGateOptions = {},
): Promise<WelcomeGateResult> {
  const { maxWaitMs = WELCOME_GATE_MAX_WAIT_MS, fallbackDelayMs = WELCOME_DELAY_MS } = options;
  const key = gateKey(member.guild.id, member.id);
  // A stale waiter under the same key belongs to a membership that has already ended.
  pendingWelcomes.get(key)?.finish("ended");

  let resolveOutcome: (outcome: WelcomeGateOutcome) => void = () => {};
  const outcome = new Promise<WelcomeGateOutcome>((resolve) => {
    resolveOutcome = resolve;
  });

  let settled = false;
  let expiry: ReturnType<typeof setTimeout> | undefined;

  const pending: PendingWelcome = {
    latest: member,
    isOpen: null,
    finish: (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(expiry);
      if (pendingWelcomes.get(key) === pending) pendingWelcomes.delete(key);
      resolveOutcome(result);
    },
  };

  expiry = setTimeout(() => pending.finish("expired"), maxWaitMs);
  expiry.unref();

  // Registered before the onboarding lookup so an update or departure during the REST call is not lost.
  pendingWelcomes.set(key, pending);

  const onboardingEnabled = await fetchOnboardingEnabled(member.guild);
  pending.isOpen = (current) => isWelcomeGateOpen(current, onboardingEnabled === true);
  if (pending.isOpen(pending.latest)) pending.finish("open");

  const result = await outcome;
  if (result === "open" && onboardingEnabled === null) {
    await waitForWelcomeDelay(fallbackDelayMs);
  }
  return { outcome: result, member: pending.latest };
}

export function notifyWelcomeGateMemberUpdate(member: GuildMember): void {
  const pending = pendingWelcomes.get(gateKey(member.guild.id, member.id));
  if (!pending) return;

  pending.latest = member;
  if (pending.isOpen?.(member)) pending.finish("open");
}

export function notifyWelcomeGateMemberRemove(guildId: string, userId: string): void {
  pendingWelcomes.get(gateKey(guildId, userId))?.finish("ended");
}
