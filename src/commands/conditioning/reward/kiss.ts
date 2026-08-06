import { createConditioningInteractionCommand } from "@/utils/conditioning/conditioningInteractionCommand";

/** Kiss reward: give the bot a kiss and trigger a response */
export const { configureSubcommand, execute } = createConditioningInteractionCommand("reward", "kiss");
