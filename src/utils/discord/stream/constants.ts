// Kept in this leaf module so StreamSegmentProcessor can read the retry cap without importing the chat pipeline.
export const MAX_EMPTY_RESPONSE_RETRIES = 2;
// Bounds retained draft prose per turn (64 KiB byte cap plus segment count for blank segments) against runaway
// provider streams.
export const MAX_PENDING_RESPONSE_BYTES = 64 * 1024;
export const MAX_PENDING_RESPONSE_SEGMENTS = 4096;
export const STREAM_CHUNK_DEDUP_TAIL_CHARS = 4096;
export const STREAM_CHUNK_DEDUP_MIN_CHARS = 8;
export const ORPHAN_PUNCTUATION_REGEX = /^[.,!?;。！？、，…]+$/;
