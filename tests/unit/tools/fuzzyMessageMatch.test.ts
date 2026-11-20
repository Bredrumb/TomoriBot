import { describe, expect, it } from "bun:test";
import type { Collection, Message } from "discord.js";
import { DISCORD_ID_PATTERN, findFuzzyMessageMatch, MAX_FUZZY_DISTANCE } from "@/utils/text/fuzzyMessageMatch";

/** The fuzzy search only reads `id`, so the entries are never real discord.js messages. */
function makeMessages(ids: string[]): Collection<string, Message> {
  return new Map(ids.map((id) => [id, { id } as unknown as Message])) as unknown as Collection<string, Message>;
}

describe("fuzzy message matching", () => {
  it("accepts 17 to 20 digit ids and rejects anything else", () => {
    expect(DISCORD_ID_PATTERN.test("12345678901234567")).toBe(true);
    expect(DISCORD_ID_PATTERN.test("12345678901234567890")).toBe(true);
    expect(DISCORD_ID_PATTERN.test("1234567890123456")).toBe(false);
    expect(DISCORD_ID_PATTERN.test("123456789012345678901")).toBe(false);
    expect(DISCORD_ID_PATTERN.test("msg_ref_1")).toBe(false);
  });

  it("picks the closest candidate and reports its distance", () => {
    const messages = makeMessages(["1000000000000000050", "1000000000000000007", "1000000000000000900"]);

    const match = findFuzzyMessageMatch(messages, "1000000000000000000");

    expect(match?.message.id).toBe("1000000000000000007");
    expect(match?.diff).toBe(7n);
  });

  it("ignores a candidate that sits exactly on the requested id", () => {
    // An exact hit is already handled by the caller's own lookup, so the search must not
    // report the id back as its own fuzzy neighbour.
    const messages = makeMessages(["1000000000000000000", "1000000000000000042"]);

    const match = findFuzzyMessageMatch(messages, "1000000000000000000");

    expect(match?.message.id).toBe("1000000000000000042");
  });

  it("refuses a candidate beyond the distance limit", () => {
    const messages = makeMessages([(BigInt("1000000000000000000") + MAX_FUZZY_DISTANCE).toString()]);

    expect(findFuzzyMessageMatch(messages, "1000000000000000000")).toBeNull();
  });

  it("returns null instead of throwing when the requested id is unparseable", () => {
    const messages = makeMessages(["1000000000000000000"]);

    expect(findFuzzyMessageMatch(messages, "not-a-snowflake")).toBeNull();
  });

  it("abandons the search when a candidate id is not a snowflake", () => {
    // Discord never issues a non-snowflake message id, so this only pins the fail-closed
    // behaviour the per-site loops had before they were shared.
    const messages = makeMessages(["opaque_ref", "1000000000000000010"]);

    expect(findFuzzyMessageMatch(messages, "1000000000000000000")).toBeNull();
  });

  it("returns null for an empty window", () => {
    expect(findFuzzyMessageMatch(makeMessages([]), "1000000000000000000")).toBeNull();
  });
});
