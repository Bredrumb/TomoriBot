export const MIN_THRESHOLD = 0; // 0 means always-reply in configured auto-chat channels
export const MIN_RANDOM_THRESHOLD = 1;
export const MAX_THRESHOLD = 100; // The absolute maximum value allowed

export interface ThresholdValidationResult {
  isValid: boolean;
  isAlwaysReplyMode: boolean;
  isRangeMode: boolean;
}

/**
 * Validates a threshold+max pair and identifies which auto-chat mode applies.
 * (0,0) = always-reply; (n,n) = fixed; (min,max where max>min) = random range.
 */
export function validateThresholdInput(threshold: number, maxThreshold: number): ThresholdValidationResult {
  const isAlwaysReplyMode = threshold === MIN_THRESHOLD && maxThreshold === MIN_THRESHOLD;
  const isRangeMode = threshold >= MIN_RANDOM_THRESHOLD && maxThreshold > threshold;
  const isValid =
    isAlwaysReplyMode ||
    (threshold >= MIN_RANDOM_THRESHOLD &&
      threshold <= MAX_THRESHOLD &&
      maxThreshold >= threshold &&
      maxThreshold <= MAX_THRESHOLD);
  return { isValid, isAlwaysReplyMode, isRangeMode };
}

export interface ThresholdInput {
  threshold: number;
  maxThreshold: number;
}

const THRESHOLD_INPUT_PATTERN = /^(\d+)(?:\s*-\s*(\d+))?$/;

/** Sized for a padded "100 - 100" range: a shorter field cap truncates text the parser accepts. */
export const THRESHOLD_INPUT_MAX_LENGTH = 16;

/**
 * Reads the one-field modal form: `0` for every message, `50` for a fixed count, or `50-60` for a
 * random range. Returns the pair so {@link validateThresholdInput} stays the only validity owner.
 */
export function parseThresholdInput(value: string): ThresholdInput | null {
  const match = THRESHOLD_INPUT_PATTERN.exec(value.trim());
  if (!match) return null;

  const threshold = Number.parseInt(match[1], 10);
  const maxThreshold = match[2] === undefined ? threshold : Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(threshold) || !Number.isSafeInteger(maxThreshold)) return null;

  return { threshold, maxThreshold };
}

/** Prefills the modal with the same shape the panel displays for the stored pair. */
export function formatThresholdInput(threshold: number, maxThreshold: number): string {
  if (threshold === MIN_THRESHOLD) return "0";
  return maxThreshold > threshold ? `${threshold}-${maxThreshold}` : String(threshold);
}

export function rollAutochatTarget(minThreshold: number, maxThreshold: number): number {
  if (minThreshold <= 0 || maxThreshold <= 0) {
    return 0;
  }

  if (minThreshold === maxThreshold) {
    return minThreshold;
  }

  return Math.floor(Math.random() * (maxThreshold - minThreshold + 1)) + minThreshold;
}
