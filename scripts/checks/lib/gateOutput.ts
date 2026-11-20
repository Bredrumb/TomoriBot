// --no-verbose overrides --verbose so wrappers like vl can append it after forwarded flags instead of stripping them.
export function isVerboseOutput(argv: string[] = process.argv): boolean {
  if (argv.includes("--no-verbose")) return false;
  return argv.includes("--verbose");
}

export function verboseOutputHint(rerunCommand: string): string {
  return `Re-run with \`${rerunCommand} --verbose\` to list them.`;
}
