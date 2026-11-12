import { describe, expect, it } from "bun:test";
import { readRecordingRetentionDays } from "@/modules/conversation-recording/config";
import { recordingAttachmentsSchema } from "@/modules/conversation-recording/db/types";
import { startBot } from "@/index";
import { useEnvSandbox } from "../helpers/env";

describe("recording configuration", () => {
  useEnvSandbox(["RECORD_RETENTION_DAYS"]);
  it("allows absent retention and rejects invalid configured retention", () => {
    delete process.env.RECORD_RETENTION_DAYS;
    expect(readRecordingRetentionDays()).toBeNull();
    expect(readRecordingRetentionDays("30")).toBe(30);
    for (const value of ["", "0", "-1", "1.2", "7days", " 3", "Infinity", "9007199254740992"]) {
      expect(() => readRecordingRetentionDays(value)).toThrow();
    }
  });
  it("accepts only bounded type counts without media identifiers", () => {
    expect(recordingAttachmentsSchema.safeParse({ image: 2, video: 1, audio: 1, file: 1 }).success).toBe(true);
    for (const metadata of [
      { image: -1, video: 0, audio: 0, file: 0 },
      { image: 10, video: 1, audio: 0, file: 0 },
      { image: 1, video: 0, audio: 0, file: 0, url: "https://example.com/image" },
    ]) {
      expect(recordingAttachmentsSchema.safeParse(metadata).success).toBe(false);
    }
  });
  it("fails startup before loading credentials when retention is invalid", async () => {
    process.env.RECORD_RETENTION_DAYS = "0";
    await expect(startBot()).rejects.toBeInstanceOf(Error);
  });
});
