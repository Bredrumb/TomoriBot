import { z } from "zod";

export const RECORDING_QUOTA_BYTES = 100 * 1024 * 1024;
export const RECORDING_READ_BYTES = 4 * 1024 * 1024;
export const RECORDING_READ_EXCERPTS = 100;
const RECORDING_DURATIONS = ["24h", "7d", "14d", "30d", "unlimited"] as const;
export const recordingSettingsSchema = z
  .object({
    context: z.enum(["own", "surrounding"]),
    duration: z.enum(RECORDING_DURATIONS),
  })
  .strict();
export type RecordingSettings = z.infer<typeof recordingSettingsSchema>;
export interface RecordingScope {
  ownerUserId: number;
  serverId: number;
}
export interface RecordingToken {
  sessionId: string;
  revision: number;
}
export const recordingSessionSchema = z.object({
  session_id: z.string().uuid(),
  revision: z.number().int(),
  context: recordingSettingsSchema.shape.context,
  duration: recordingSettingsSchema.shape.duration,
  started_at: z.date(),
  ends_at: z.date().nullable(),
  stopped_at: z.date().nullable(),
});
export type RecordingSession = z.infer<typeof recordingSessionSchema>;
export const recordingIdentitySchema = z
  .object({
    kind: z.enum(["participant", "channel", "role"]),
    sourceId: z.string().min(1).max(100),
  })
  .strict();
export type RecordingIdentity = z.infer<typeof recordingIdentitySchema>;
export const recordingAttachmentsSchema = z
  .object({
    image: z.number().int().min(0).max(10),
    video: z.number().int().min(0).max(10),
    audio: z.number().int().min(0).max(10),
    file: z.number().int().min(0).max(10),
  })
  .strict()
  .refine((counts) => Object.values(counts).reduce((sum, count) => sum + count, 0) <= 10);
export type RecordingAttachments = z.infer<typeof recordingAttachmentsSchema>;
const speaker = z.string().regex(/^(SELF|PARTICIPANT_[1-9]\d*)$/);
const channel = z.string().regex(/^CHANNEL_[1-9]\d*$/);
export const storedRecordingMessageSchema = z
  .object({
    id: z.string().uuid(),
    timestamp: z.iso.datetime(),
    editedTimestamp: z.iso.datetime().nullable(),
    speaker,
    channel,
    body: z.string(),
    attachments: recordingAttachmentsSchema,
    replyTo: z.string().uuid().nullable(),
  })
  .strict();
export type RecordingMessage = z.infer<typeof storedRecordingMessageSchema>;
const recordingMessageInputSchema = z
  .object({
    sourceMessageId: z.string().regex(/^\d{1,20}$/),
    sourceAuthorId: z.string().min(1).max(100),
    privacyUserIds: z.array(z.string().min(1).max(100)).max(10),
    timestamp: z.date(),
    editedTimestamp: z.date().nullable(),
    speaker,
    channel,
    body: z.string(),
    attachments: recordingAttachmentsSchema,
    replyToSourceMessageId: z
      .string()
      .regex(/^\d{1,20}$/)
      .nullable(),
  })
  .strict();
export type RecordingMessageInput = z.infer<typeof recordingMessageInputSchema>;
export const recordingExcerptInputSchema = z
  .object({
    sourceChannelId: z.string().min(1).max(100),
    sourceParentChannelId: z.string().min(1).max(100).nullable(),
    messages: z.array(recordingMessageInputSchema).min(1).max(11),
  })
  .strict();
export type RecordingExcerptInput = z.infer<typeof recordingExcerptInputSchema>;
export const recordingExcerptSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    sessionId: z.string().uuid(),
    triggeredAt: z.iso.datetime(),
    context: recordingSettingsSchema.shape.context,
    messages: z.array(storedRecordingMessageSchema).min(1).max(11),
  })
  .strict();
export type RecordingExcerpt = z.infer<typeof recordingExcerptSchema>;
export interface RecordingRange {
  from: Date;
  until: Date;
}
export interface RecordingCursor {
  triggeredAt: Date;
  excerptId: string;
}
export interface RecordingPage {
  excerpts: RecordingExcerpt[];
  nextCursor: RecordingCursor | null;
  bytes: number;
  oversized: boolean;
}
export interface RecordingEviction {
  excerpts: number;
  bytes: number;
}
export type RecordingAppendResult =
  | { status: "stored"; excerptId: string; eviction: RecordingEviction }
  | { status: "stale" | "duplicate" | "private" | "too-large" };
export interface RecordingSummary {
  session: RecordingSession | null;
  serverBytes: number;
  ownerBytes: number;
  quotaBytes: number;
  excerpts: number;
  retentionDays: number | null;
  nextExpiry: Date | null;
  evictedExcerpts: number;
  evictedBytes: number;
  lastEvictedAt: Date | null;
}
