// Bounds on one server's stop-string list, both for the `/config` model panel that has to
// render the merged list and because every stop string is sent with every request.
export const MAX_STOP_STRINGS_PER_SERVER = 40;
export const MAX_STOP_STRING_LENGTH = 200;

function decodeStopStringEscapes(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
}

export function parseCommaSeparatedStopStrings(input: string): string[] {
  const stops: string[] = [];
  const seen = new Set<string>();

  for (const rawPart of input.split(",")) {
    const stop = decodeStopStringEscapes(rawPart.trim());
    if (!stop || seen.has(stop)) {
      continue;
    }
    seen.add(stop);
    stops.push(stop);
  }

  return stops;
}

export function mergeConfiguredStopStrings(existingStops: readonly string[], newStops: readonly string[]): string[] {
  const merged: string[] = [];

  for (const stop of [...existingStops, ...newStops]) {
    if (stop && !merged.includes(stop)) {
      merged.push(stop);
    }
  }

  return merged;
}

export function formatStopStringForDisplay(stop: string): string {
  return stop.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}
