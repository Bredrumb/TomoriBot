/** @public Enum members are consumed dynamically by schemas and classifier prompts. */
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

export const getAllEmotionKeys = (): string[] => {
  return Object.values(EmotionKey);
};

// Three rare keys hidden from the `/expressions manage` dropdown so it fits Discord's 25-option select limit, while
// AI and storage keep all 28.
const MANUAL_EDIT_EXCLUDED_EMOTIONS: readonly EmotionKey[] = [
  EmotionKey.GRIEF,
  EmotionKey.REMORSE,
  EmotionKey.REALIZATION,
];

export const getManualEditEmotionKeys = (): string[] => {
  return getAllEmotionKeys().filter((key) => !MANUAL_EDIT_EXCLUDED_EMOTIONS.includes(key as EmotionKey));
};

export const isValidEmotionKey = (key: string): key is EmotionKey => {
  return Object.values(EmotionKey).includes(key as EmotionKey);
};
