// SillyTavern authors leave HTML comments in card fields as editing notes, so strip them before storage.
export function sanitizeSillyTavernText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?--!?>/g, "")
    .trim();
}
