import type { ConditioningType } from "@/types/db/schema";

const REWARD_ACTION_KEYS = ["headpat", "hug", "kiss", "tickle", "feed"] as const;
const PUNISH_ACTION_KEYS = ["spank", "pinch", "bite", "squeeze", "bonk"] as const;

type RewardActionKey = (typeof REWARD_ACTION_KEYS)[number];
type PunishActionKey = (typeof PUNISH_ACTION_KEYS)[number];
export type ConditioningActionKey = RewardActionKey | PunishActionKey;
const CONTEXT_PAST_PARTICIPLES: Record<ConditioningType, Record<ConditioningActionKey, string>> = {
  reward: {
    headpat: "headpatted",
    hug: "hugged",
    kiss: "kissed",
    tickle: "tickled",
    feed: "fed",
    spank: "spanked",
    pinch: "pinched",
    bite: "bitten",
    squeeze: "squeezed",
    bonk: "bonked",
  },
  punish: {
    headpat: "headpatted",
    hug: "hugged",
    kiss: "kissed",
    tickle: "tickled",
    feed: "fed",
    spank: "spanked",
    pinch: "pinched",
    bite: "bitten",
    squeeze: "squeezed",
    bonk: "bonked",
  },
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const CONDITIONING_REASON_MAX_LENGTH = parsePositiveInt(process.env.CONDITIONING_REASON_MAX_LENGTH, 250);
export const CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE = parsePositiveInt(
  process.env.CONDITIONING_CONTEXT_MAX_GROUPS_PER_TYPE,
  10,
);

export function normalizeConditioningReason(reason: string | null | undefined): string {
  return (reason ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeConditioningReasonKey(reason: string | null | undefined): string {
  return normalizeConditioningReason(reason).toLowerCase();
}

export function getConditioningContextPastParticiple(
  type: ConditioningType,
  actionKey: ConditioningActionKey | string,
): string {
  const actionMap = CONTEXT_PAST_PARTICIPLES[type];
  return actionMap[actionKey as ConditioningActionKey] ?? actionKey;
}
