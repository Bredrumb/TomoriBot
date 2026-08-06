import { createConditioningInteractionCommand } from "@/utils/conditioning/conditioningInteractionCommand";

/** Headpat reward: give the bot a headpat and trigger a response */
export const { configureSubcommand, execute } = createConditioningInteractionCommand("reward", "headpat");
