const runtimeImports = ["@google-cloud/storage"] as const;
const lockfile = await Bun.file("bun.lock").text();

// A global `uuid` override in package.json is the only thing that trips this, and it breaks the
// import below: gaxios@6 declares uuid ^9.0.1 and @google-cloud/storage declares ^8.0.0, so
// forcing v11 collapses every path to one resolution that satisfies neither. The advisory that
// invites the override is moderate and never gates `audit:clean`, which blocks at
// `--audit-level=high` only.
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
