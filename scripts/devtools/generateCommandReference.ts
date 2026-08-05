async function main(): Promise<void> {
  process.env.RUN_ENV = "production";
  const { COMMAND_REFERENCE_PATH, writeCommandReference } = await import("../lib/commandReference");

  await writeCommandReference();
  console.log(`Command reference generated: ${COMMAND_REFERENCE_PATH}`);
}

if (import.meta.main) {
  await main();
}
