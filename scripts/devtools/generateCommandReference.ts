async function main(): Promise<void> {
  process.env.RUN_ENV = "production";
  const { COMMAND_REFERENCE_PATH, exitAfterCommandGraphLoad, writeCommandReference } = await import(
    "../lib/commandReference"
  );

  await writeCommandReference();
  console.log(`Command reference generated: ${COMMAND_REFERENCE_PATH}`);
  exitAfterCommandGraphLoad();
}

if (import.meta.main) {
  await main();
}
