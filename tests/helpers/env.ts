import { afterAll, afterEach, beforeEach } from "bun:test";

type EnvSnapshot = ReadonlyMap<string, string | undefined>;

function snapshotEnv(names: readonly string[]): EnvSnapshot {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [name, value] of snapshot) {
    // Assigning `undefined` stores the string "undefined", so an unset variable must be deleted.
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function snapshotFullEnv(): EnvSnapshot {
  return new Map(Object.entries(process.env));
}

function restoreFullEnv(snapshot: EnvSnapshot): void {
  for (const name of Object.keys(process.env)) if (!snapshot.has(name)) delete process.env[name];
  restoreEnv(snapshot);
}

// The scope snapshot runs at registration so beforeAll writes are undone, which is safe because Bun collects each
// file only after the previous one finishes.
function registerEnvRestore(take: () => EnvSnapshot, restore: (snapshot: EnvSnapshot) => void): void {
  const scopeSnapshot = take();
  let testSnapshot = scopeSnapshot;
  beforeEach(() => {
    testSnapshot = take();
  });
  afterEach(() => restore(testSnapshot));
  afterAll(() => restore(scopeSnapshot));
}

// The names argument must contain inline string literals when tests write process.env.X because
// scripts/checks/lib/testIsolation.ts checks AST literals.
export function useEnvSandbox(names: readonly string[]): void {
  registerEnvRestore(() => snapshotEnv(names), restoreEnv);
}

// Must be called before the scope's own afterEach or afterAll hooks because Bun runs hooks in registration order and
// re-init hooks need restored values.
export function useFullEnvSandbox(): void {
  registerEnvRestore(snapshotFullEnv, restoreFullEnv);
}
