// Bounds stay within -12 to +14 because real-world timezones and database CHECK constraints enforce that range.
export const UTC_OFFSET_MIN = -12;
export const UTC_OFFSET_MAX = 14;
// Quarter-hour step is required because real timezones such as Nepal (+5:45) and Chatham (+12:45) sit on 45-minute
// marks.
export const UTC_OFFSET_STEP_HOURS = 0.25;
