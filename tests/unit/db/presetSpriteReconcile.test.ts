import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { SQL } from "bun";
import { reconcileRemovedSprites } from "@/db/seed/catalog/presetSpriteSeed";
import { log } from "@/utils/misc/logger";

const SCOPE = { lineageId: 4, language: "en-US", personaName: "Default Tomori" };

type CapturedStatement = {
  /** Bind parameters in the order the client received them. */
  values: unknown[];
  /** The protected key set, taken from the only array-valued parameter. */
  protectedKeys: string[];
  /** Text of the statement, for shape assertions. */
  text: string;
};

/**
 * Reads the protected key set out of the bind the driver receives.
 *
 * Our `sql.array(keys, "text")` marshals to Bun's `{ serializedValues, arrayType }` wrapper whose
 * `serializedValues` is a PostgreSQL array literal (`{"smug","silly"}`), not a JS array. Parsing
 * that literal is what keeps the assertion on the real statement rather than on a restatement of
 * the test's own input.
 *
 * The caller passes the bind position, so a statement that binds its keys elsewhere yields an empty
 * set and the assertion fails rather than quietly passing.
 */
function readKeySet(bind: unknown): string[] {
  if (Array.isArray(bind)) return bind as string[];
  const serialized = (bind as { serializedValues?: unknown } | undefined)?.serializedValues;
  if (typeof serialized !== "string") return [];

  const body = serialized.startsWith("{") && serialized.endsWith("}") ? serialized.slice(1, -1) : serialized;
  if (!body) return [];

  const keys: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "\\" && quoted) {
      current += body[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      keys.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  keys.push(current);
  return keys;
}

function makeClient(storedKeys: string[]) {
  const statements: CapturedStatement[] = [];
  const client = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const protectedKeys = readKeySet(values[2]);
    statements.push({ values, protectedKeys, text: strings.join("?") });
    const protectedSet = new Set(protectedKeys);
    return Promise.resolve(storedKeys.filter((key) => !protectedSet.has(key)).map((sprite_key) => ({ sprite_key })));
  }) as unknown as SQL;
  return { client, statements };
}

const restoreSpies: Array<() => void> = [];

afterEach(() => {
  for (const restore of restoreSpies.splice(0)) restore();
});

/** Captures log.warn calls; always restored, including when the delete path throws. */
function captureWarnings() {
  const warnings: string[] = [];
  const spy = spyOn(log, "warn").mockImplementation((message: string) => {
    warnings.push(message);
  });
  restoreSpies.push(() => spy.mockRestore());
  return warnings;
}

describe("reconcileRemovedSprites", () => {
  it("keeps stored rows when every declared sprite failed to seed", async () => {
    // `seededAny: false` must be a no-op delete. These keys are the only reference to images that
    // are already uploaded and immutable, so losing them costs the art until a later run uploads it.
    const { client, statements } = makeClient(["smug", "silly", "happy"]);
    const warnings = captureWarnings();

    const removed = await reconcileRemovedSprites(client, SCOPE, ["smug", "silly", "happy"], false);

    expect(removed).toBe(0);
    expect(statements).toHaveLength(0);
    expect(warnings.join(" ")).toContain("preserved instead of reconciled");
  });

  it("deletes only the stored keys the catalog no longer declares", async () => {
    // `retired` is gone from the catalog; `smug` and `silly` are still declared.
    const { client, statements } = makeClient(["smug", "silly", "retired"]);
    const removed = await reconcileRemovedSprites(client, SCOPE, ["smug", "silly"], true);

    expect(removed).toBe(1);
    expect(statements).toHaveLength(1);
    // Membership in the array-valued bind is the assertion, not presence somewhere in the
    // statement: a key that drifted into a scalar bind (the lineage or language) must not satisfy it.
    expect(statements[0].protectedKeys.sort()).toEqual(["silly", "smug"]);
    expect(statements[0].text).toContain("NOT (sprite_key = ANY(");
  });

  it("protects a failed sprite while still collecting a removed one", async () => {
    // The protected set carries the seeded key and the failed one, so only `gone` comes back.
    const { client, statements } = makeClient(["smug", "happy", "gone"]);
    const removed = await reconcileRemovedSprites(client, SCOPE, ["smug", "happy"], true);

    expect(removed).toBe(1);
    expect(statements[0].protectedKeys.sort()).toEqual(["happy", "smug"]);
  });

  it("is destructive on an empty protected set, which is why the seeder never calls it that way", async () => {
    // An empty protected set collects every row, so the seeder's empty-array `continue` is the only
    // thing standing between an empty declaration and a wipe. This call is unreachable in
    // production; the test pins what the guard is protecting against.
    const { client, statements } = makeClient(["smug"]);
    const warnings = captureWarnings();

    const removed = await reconcileRemovedSprites(client, SCOPE, [], true);

    expect(removed).toBe(1);
    expect(statements).toHaveLength(1);
    expect(statements[0].protectedKeys).toEqual([]);
    expect(warnings).toHaveLength(0);
  });
});
