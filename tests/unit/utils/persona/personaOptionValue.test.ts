import { describe, expect, it } from "bun:test";
import { parsePersonaOptionId, resolveSelectedPersona } from "@/utils/persona/personaOptionValue";

/** The helpers read only an id and a nickname, so the stub carries nothing else. */
function createPersona(personaId: number, nickname: string) {
  return { persona_id: personaId, persona_nickname: nickname };
}

describe("parsePersonaOptionId", () => {
  it("strictly accepts positive safe decimal integers", () => {
    expect(parsePersonaOptionId("1")).toBe(1);
    expect(parsePersonaOptionId("42")).toBe(42);
    expect(parsePersonaOptionId("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects whitespace, signs, decimals, zero, and junk", () => {
    expect(parsePersonaOptionId(" 42")).toBeNull();
    expect(parsePersonaOptionId("42 ")).toBeNull();
    expect(parsePersonaOptionId(" 42 ")).toBeNull();
    expect(parsePersonaOptionId("+42")).toBeNull();
    expect(parsePersonaOptionId("-42")).toBeNull();
    expect(parsePersonaOptionId("42.0")).toBeNull();
    expect(parsePersonaOptionId("42.5")).toBeNull();
    expect(parsePersonaOptionId("0")).toBeNull();
    expect(parsePersonaOptionId("00")).toBeNull();
    expect(parsePersonaOptionId("042")).toBeNull();
    expect(parsePersonaOptionId("abc")).toBeNull();
    expect(parsePersonaOptionId("42a")).toBeNull();
    expect(parsePersonaOptionId("")).toBeNull();
    expect(parsePersonaOptionId("   ")).toBeNull();
  });

  it("rejects non-strings and unsafe integers", () => {
    expect(parsePersonaOptionId(null)).toBeNull();
    expect(parsePersonaOptionId(undefined)).toBeNull();
    expect(parsePersonaOptionId(42)).toBeNull();
    expect(parsePersonaOptionId("9007199254740992")).toBeNull();
  });
});

describe("resolveSelectedPersona", () => {
  const personas = [createPersona(1, "Alice"), createPersona(2, "Bob")];

  it("returns the persona matching the parsed ID", () => {
    const result = resolveSelectedPersona(personas, "2");
    expect(result).not.toBeNull();
    expect(result?.persona_id).toBe(2);
    expect(result?.persona_nickname).toBe("Bob");
  });

  it("returns null for malformed or missing option values", () => {
    expect(resolveSelectedPersona(personas, null)).toBeNull();
    expect(resolveSelectedPersona(personas, "")).toBeNull();
    expect(resolveSelectedPersona(personas, "invalid")).toBeNull();
    expect(resolveSelectedPersona(personas, "0")).toBeNull();
    expect(resolveSelectedPersona(personas, "-2")).toBeNull();
  });

  it("returns null for stale or cross-server persona IDs", () => {
    expect(resolveSelectedPersona(personas, "999")).toBeNull();
  });
});
