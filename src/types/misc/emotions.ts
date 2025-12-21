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
 * Validate if a string is a valid emotion key
 */
export const isValidEmotionKey = (key: string): key is EmotionKey => {
	return Object.values(EmotionKey).includes(key as EmotionKey);
};
