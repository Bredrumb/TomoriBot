import { describe, expect, it } from "bun:test";
import {
  buildExportFilename,
  formatExportTimestamp,
  sanitizeAttachmentFilenamePart,
} from "@/utils/discord/attachmentFilename";

const FIXED_UTC = new Date("2026-11-13T04:05:02.987Z");

describe("attachmentFilename", () => {
  it("formats compact UTC timestamps without local-offset drift", () => {
    expect(formatExportTimestamp(FIXED_UTC)).toBe("20261113T040502Z");
  });

  it("builds kind-first export filenames with optional scope, subject, shortId, and multipart suffix", () => {
    expect(
      buildExportFilename({
        kind: "config",
        scope: "server",
        subject: { value: "Juno Lounge", fallback: "server" },
        extension: "json",
        now: FIXED_UTC,
      }),
    ).toBe("tomori-config-server-Juno_Lounge-20261113T040502Z.json");

    expect(
      buildExportFilename({
        kind: "recordings",
        shortId: "a1b2c3d4",
        part: { index: 1, total: 1 },
        extension: ".md",
        now: FIXED_UTC,
      }),
    ).toBe("tomori-recordings-20261113T040502Z-a1b2c3d4.md");

    expect(
      buildExportFilename({
        kind: "sprites",
        subject: { value: "Tomori", fallback: "persona" },
        part: { index: 2, total: 3 },
        extension: "zip",
        now: FIXED_UTC,
      }),
    ).toBe("tomori-sprites-Tomori-20261113T040502Z-part-2-of-3.zip");
  });

  it("sanitizes unsafe, empty, Unicode, and long subjects within the length budget", () => {
    for (const raw of ["../../etc/passwd", "a:b*c?d|e", "", "🌟🌟🌟", `café-${"x".repeat(80)}`]) {
      const sanitized = sanitizeAttachmentFilenamePart(raw, { fallback: "persona", maxLength: 50 });
      expect(sanitized.length).toBeGreaterThan(0);
      expect(sanitized.length).toBeLessThanOrEqual(50);
      expect(sanitized).toMatch(/^[A-Za-z0-9_-]+$/);
    }

    const emptyOne = sanitizeAttachmentFilenamePart("🌟", { fallback: "persona", maxLength: 50 });
    const emptyTwo = sanitizeAttachmentFilenamePart("✨", { fallback: "persona", maxLength: 50 });
    expect(emptyOne).not.toBe(emptyTwo);

    const filename = buildExportFilename({
      kind: "memories",
      scope: "personal",
      subject: { value: `../../${"a".repeat(80)}`, fallback: "personal" },
      extension: "json",
      now: FIXED_UTC,
    });
    expect(filename.length).toBeLessThanOrEqual(100);
  });
});
