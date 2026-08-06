import { createConditioningInteractionCommand } from "@/utils/conditioning/conditioningInteractionCommand";

/** Hug reward: give the bot a hug and trigger a response */
export const { configureSubcommand, execute } = createConditioningInteractionCommand("reward", "hug");
