const runtimeImports = ["@google-cloud/storage"] as const;
const lockfile = await Bun.file("bun.lock").text();

if (!/"gaxios\/uuid": \["uuid@9\./.test(lockfile)) {
  throw new Error("bun.lock must resolve gaxios to its declared uuid@9 dependency.");
}

for (const dependency of runtimeImports) {
  await import(dependency);
  console.log(`Runtime dependency import passed: ${dependency}`);
}
