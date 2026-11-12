export function readRecordingRetentionDays(value = process.env.RECORD_RETENTION_DAYS): number | null {
  if (value === undefined) return null;
  const days = Number(value);
  if (
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(days) ||
    !Number.isFinite(new Date(Date.now() + days * 86_400_000).getTime())
  ) {
    throw new Error("RECORD_RETENTION_DAYS must be a positive integer number of days");
  }
  return days;
}
