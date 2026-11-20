// Top-level await below needs this file to be a module, and it has no other import or export.
export {};

const runtimeImports = ["@google-cloud/storage"] as const;
const lockfile = await Bun.file("bun.lock").text();

// Prevent a global `uuid` override (e.g. from moderate advisories) from collapsing gaxios (^9) and storage (^8) to
// one incompatible version.
if (!/"gaxios\/uuid": \["uuid@9\./.test(lockfile)) {
  throw new Error(
    "bun.lock must resolve gaxios to its declared uuid@9 dependency. Remove any global `uuid` " +
      "override from package.json overrides and rerun `bun install`.",
  );
}

for (const dependency of runtimeImports) {
  await import(dependency);
  console.log(`Runtime dependency import passed: ${dependency}`);
}
