async function main(): Promise<void> {
  process.env.RUN_ENV = "production";
  const { commandReferencePath, exitAfterCommandGraphLoad, generateCommandReferences } = await import(
    "../lib/commandReference"
  );

  const stale: string[] = [];
  for (const [locale, expected] of await generateCommandReferences()) {
    const file = Bun.file(commandReferencePath(locale));
    if (!(await file.exists()) || (await file.text()) !== expected) {
      stale.push(`docs/${locale}/features/command-reference.md`);
    }
  }

  if (stale.length === 0) {
    console.log("Command reference OK");
    exitAfterCommandGraphLoad();
  }

  console.error(
    `Command reference is stale: ${stale.join(", ")}. Run \`bun run generate-command-reference\` and commit the regenerated files.`,
  );
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
