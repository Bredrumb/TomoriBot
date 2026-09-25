async function main(): Promise<void> {
  process.env.RUN_ENV = "production";
  const { exitAfterCommandGraphLoad, writeCommandReferences } = await import("../lib/commandReference");

  for (const path of await writeCommandReferences()) {
    console.log(`Command reference generated: ${path}`);
  }
  exitAfterCommandGraphLoad();
}

if (import.meta.main) {
  await main();
}
