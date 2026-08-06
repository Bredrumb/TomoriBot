async function main(): Promise<void> {
  process.env.RUN_ENV = "production";
  const { COMMAND_REFERENCE_PATH, generateCommandReferenceMarkdown } = await import("../lib/commandReference");

  const expected = await generateCommandReferenceMarkdown();
  const current = await Bun.file(COMMAND_REFERENCE_PATH).text();

  if (current === expected) {
    console.log("Command reference OK");
    return;
  }

  console.error(
    "Command reference is stale. Run `bun run generate-command-reference` and commit docs/en/features/command-reference.md.",
  );
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
