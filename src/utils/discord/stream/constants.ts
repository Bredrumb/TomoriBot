export const PREFILL_WHITESPACE_SENTINEL = "\uE000";
// Maximum number of empty-response regeneration attempts scheduled by
// maybeScheduleEmptyResponseRetry (postTurnEffects). Lives here (a leaf module) so the stream
// segment processor can consult the remaining retry budget without importing the chat pipeline.
export const MAX_EMPTY_RESPONSE_RETRIES = 2;
export const STREAM_CHUNK_DEDUP_TAIL_CHARS = 4096;
export const STREAM_CHUNK_DEDUP_MIN_CHARS = 8;
export const ORPHAN_PUNCTUATION_REGEX = /^[.,!?;。！？、，…]+$/;
