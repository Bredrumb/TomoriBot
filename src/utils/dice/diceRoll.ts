import { randomInt } from "node:crypto";
import { z } from "zod";

const MAX_DICE_COUNT = 100;
const MAX_DICE_SIDES = 1000;
const MAX_DICE_MODIFIER = 10000;
export const MAX_DICE_EXPRESSION_LENGTH = 64;
export const MAX_ROLL_REASON_LENGTH = 100;
export const DICE_MODES = ["normal", "advantage", "disadvantage"] as const;
export const ROLL_VISIBILITIES = ["public", "hidden", "shared"] as const;
export type DiceMode = (typeof DICE_MODES)[number];
export type RollVisibility = (typeof ROLL_VISIBILITIES)[number];

const rollInputSchema = z.object({
  dice: z.string().trim().min(1).max(MAX_DICE_EXPRESSION_LENGTH),
  mode: z.enum(DICE_MODES).default("normal"),
  reason: z
    .string()
    .trim()
    .max(MAX_ROLL_REASON_LENGTH)
    .transform((value) => value.replace(/\s+/gu, " "))
    .optional(),
});

export interface DiceRollInput {
  dice: string;
  count: number;
  sides: number;
  modifier: number;
  mode: DiceMode;
  reason?: string;
}

export interface DiceRollResult extends DiceRollInput {
  rolls: number[];
  kept: number[];
  keptIndex?: number;
  subtotal: number;
  total: number;
}

type DiceParseResult = { success: true; data: DiceRollInput } | { success: false; errorKey: string };

export function parseDiceRoll(input: unknown): DiceParseResult {
  const parsed = rollInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, errorKey: "commands.roll.invalid_input" };
  const match = /^(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?$/i.exec(parsed.data.dice);
  if (!match) return { success: false, errorKey: "commands.roll.invalid_notation" };
  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const modifier = match[4] ? Number(match[4]) * (match[3] === "-" ? -1 : 1) : 0;
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_DICE_COUNT ||
    !Number.isSafeInteger(sides) ||
    sides < 2 ||
    sides > MAX_DICE_SIDES ||
    !Number.isSafeInteger(modifier) ||
    Math.abs(modifier) > MAX_DICE_MODIFIER
  ) {
    return { success: false, errorKey: "commands.roll.invalid_limits" };
  }
  if (parsed.data.mode !== "normal" && (count !== 1 || sides !== 20)) {
    return { success: false, errorKey: "commands.roll.invalid_mode" };
  }
  const dice = `${count}d${sides}${modifier === 0 ? "" : modifier > 0 ? `+${modifier}` : modifier}`;
  return { success: true, data: { ...parsed.data, dice, count, sides, modifier } };
}

export function rollDice(
  input: DiceRollInput,
  randomInteger: (min: number, max: number) => number = randomInt,
): DiceRollResult {
  const rolls = Array.from({ length: input.mode === "normal" ? input.count : 2 }, () =>
    randomInteger(1, input.sides + 1),
  );
  let keptIndex: number | undefined;
  if (input.mode !== "normal") {
    const keepFirst = input.mode === "advantage" ? rolls[0] >= rolls[1] : rolls[0] <= rolls[1];
    keptIndex = keepFirst ? 0 : 1;
  }
  const kept = keptIndex === undefined ? [...rolls] : [rolls[keptIndex]];
  const subtotal = kept.reduce((sum, value) => sum + value, 0);
  return { ...input, rolls, kept, keptIndex, subtotal, total: subtotal + input.modifier };
}
