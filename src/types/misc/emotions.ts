/**
 * Enum of 28 emotion categories for emoji and sticker classification
 * Used by /server emojis initialize and /server stickers initialize commands
 * to categorize emojis/stickers based on their visual emotional expression
 */
export enum EmotionKey {
  ADMIRATION = "admiration",
  AMUSEMENT = "amusement",
  ANGER = "anger",
  ANNOYANCE = "annoyance",
  APPROVAL = "approval",
  CARING = "caring",
  CONFUSION = "confusion",
  CURIOSITY = "curiosity",
  DESIRE = "desire",
  DISAPPOINTMENT = "disappointment",
  DISAPPROVAL = "disapproval",
  DISGUST = "disgust",
  EMBARRASSMENT = "embarrassment",
  EXCITEMENT = "excitement",
  FEAR = "fear",
  GRATITUDE = "gratitude",
  GRIEF = "grief",
  JOY = "joy",
  LOVE = "love",
  NERVOUSNESS = "nervousness",
  OPTIMISM = "optimism",
  PRIDE = "pride",
  REALIZATION = "realization",
  RELIEF = "relief",
  REMORSE = "remorse",
  SADNESS = "sadness",
  SURPRISE = "surprise",
  NEUTRAL = "neutral",
}

/**
 * Mapping of emotion index to emotion key string
 * Used for LLM structured output parsing
 */
export const EMOTION_INDEX_MAP: Record<string, EmotionKey> = {
  "0": EmotionKey.ADMIRATION,
  "1": EmotionKey.AMUSEMENT,
  "2": EmotionKey.ANGER,
  "3": EmotionKey.ANNOYANCE,
  "4": EmotionKey.APPROVAL,
  "5": EmotionKey.CARING,
  "6": EmotionKey.CONFUSION,
  "7": EmotionKey.CURIOSITY,
  "8": EmotionKey.DESIRE,
  "9": EmotionKey.DISAPPOINTMENT,
  "10": EmotionKey.DISAPPROVAL,
  "11": EmotionKey.DISGUST,
  "12": EmotionKey.EMBARRASSMENT,
  "13": EmotionKey.EXCITEMENT,
  "14": EmotionKey.FEAR,
  "15": EmotionKey.GRATITUDE,
  "16": EmotionKey.GRIEF,
  "17": EmotionKey.JOY,
  "18": EmotionKey.LOVE,
  "19": EmotionKey.NERVOUSNESS,
  "20": EmotionKey.OPTIMISM,
  "21": EmotionKey.PRIDE,
  "22": EmotionKey.REALIZATION,
  "23": EmotionKey.RELIEF,
  "24": EmotionKey.REMORSE,
  "25": EmotionKey.SADNESS,
  "26": EmotionKey.SURPRISE,
  "27": EmotionKey.NEUTRAL,
};

/**
 * Get all emotion keys as an array (useful for LLM prompting)
 */
export const getAllEmotionKeys = (): string[] => {
  return Object.values(EmotionKey);
};

/**
 * Emotion keys intentionally excluded from the manual `/server expressions edit`
 * picker. The full 28-key taxonomy is retained everywhere else (AI classification,
 * storage, any future classifier) — these three are simply hidden from the manual
 * dropdown so it fits within Discord's 25-option string-select limit. Each was chosen
 * because it is rare in actual emoji/sticker art and folds cleanly into a neighbor:
 *   - grief       → sadness
 *   - remorse     → embarrassment / sadness
 *   - realization → surprise / curiosity
 */
export const MANUAL_EDIT_EXCLUDED_EMOTIONS: readonly EmotionKey[] = [
  EmotionKey.GRIEF,
  EmotionKey.REMORSE,
  EmotionKey.REALIZATION,
];

/**
 * Get the curated 25-emotion subset offered in the manual expression-edit select menu.
 * Derived from the full taxonomy minus {@link MANUAL_EDIT_EXCLUDED_EMOTIONS} so it stays
 * in sync if the enum changes. Order follows the EmotionKey declaration order.
 */
export const getManualEditEmotionKeys = (): string[] => {
  return getAllEmotionKeys().filter((key) => !MANUAL_EDIT_EXCLUDED_EMOTIONS.includes(key as EmotionKey));
};

/**
 * Validate if a string is a valid emotion key
 */
export const isValidEmotionKey = (key: string): key is EmotionKey => {
  return Object.values(EmotionKey).includes(key as EmotionKey);
};
