import { describe, expect, it } from "bun:test";
import {
  auditMockModuleSurfaces,
  FORBIDDEN_MOCK_MODULES,
  isGuardedMockModule,
  scanMockModuleSurfaceSource,
  type MockModuleSurfaceViolationKind,
} from "../../../scripts/checks/lib/mockModuleSurface";

function kinds(source: string): MockModuleSurfaceViolationKind[] {
  return scanMockModuleSurfaceSource(source).map((violation) => violation.kind);
}

describe("module mock surface scanner", () => {
  it("flags a partial module mock", () => {
    const source = `
      import { mock } from "bun:test";
      mock.module("@/utils/text/localizer", () => ({ log: fakeLog }));
    `;

    expect(kinds(source)).toEqual(["missing-hoisted-real-import", "missing-real-spread", "unscoped-behavior"]);
  });

  it("accepts a harmless raw passthrough with the matching namespace spread", () => {
    const source = `
      import { mock } from "bun:test";
      import * as realLocalizer from "@/utils/text/localizer";
      mock.module("@/utils/text/localizer", () => ({ ...realLocalizer }));
    `;

    expect(kinds(source)).toEqual([]);
  });

  it("requires behavioral overrides to use the scoped registrar", () => {
    const unsafe = `
      import { mock } from "bun:test";
      import * as realLocalizer from "@/utils/text/localizer";
      mock.module("@/utils/text/localizer", () => ({
        ...realLocalizer,
        log: fakeLog,
      }));
    `;
    const safe = `
      import { mock } from "bun:test";
      import * as realLocalizer from "@/utils/text/localizer";
      import { createScopedModuleMocker } from "../../helpers/mockSurface";
      const leakSafe = createScopedModuleMocker(mock, {
        "@/utils/text/localizer": realLocalizer,
      });
      leakSafe.module("@/utils/text/localizer", () => ({
        ...realLocalizer,
        log: fakeLog,
      }));
    `;

    expect(kinds(unsafe)).toEqual(["unscoped-behavior"]);
    expect(kinds(safe)).toEqual([]);
  });

  it("does not accept a spread from a different module", () => {
    const source = `
      import { mock } from "bun:test";
      import * as realLocalizer from "@/utils/text/localizer";
      import * as realRepositories from "@/utils/db/repositories";
      mock.module("@/utils/db/repositories", () => ({ ...realLocalizer }));
    `;

    expect(kinds(source)).toEqual(["missing-real-spread", "unscoped-behavior"]);
  });

  it("ignores relative modules and text in comments", () => {
    const source = `
      import { mock } from "bun:test";
      // mock.module("@/utils/text/localizer", () => ({ log: fakeLog }));
      mock.module("./localFixture", () => ({ value: "fake" }));
    `;

    expect(kinds(source)).toEqual([]);
  });

  it("guards a low-fanout project module as strictly as a shared one", () => {
    // A partial WhitelistRepository mock once broke autocomplete and blacklist suites that ran later
    // in the same bare `bun test` process, though few files import it.
    const source = `
      import { mock } from "bun:test";
      mock.module("@/utils/db/repositories/WhitelistRepository", () => ({
        whitelistRepository: { getAllWhitelistPersonas: async () => [] },
      }));
    `;

    expect(kinds(source)).toEqual(["missing-hoisted-real-import", "missing-real-spread", "unscoped-behavior"]);
    expect(isGuardedMockModule("./localFixture")).toBe(false);
  });

  it("rejects a forbidden module mock even when it is full-surface and leak-scoped", () => {
    // The shape below satisfies every surface and scope rule, which is exactly why the forbidden set
    // exists: scoping restores behavior but never the replaced module record.
    const source = `
      import { mock } from "bun:test";
      import * as realLogger from "@/utils/misc/logger";
      import { createScopedModuleMocker } from "../../helpers/mockSurface";
      const leakSafe = createScopedModuleMocker(mock, {
        "@/utils/misc/logger": realLogger,
      });
      leakSafe.module("@/utils/misc/logger", () => ({
        ...realLogger,
        log: fakeLog,
      }));
    `;

    expect(kinds(source)).toEqual(["forbidden-module"]);
    expect(FORBIDDEN_MOCK_MODULES).toContain("@/utils/misc/logger");
  });
});

describe("module mock surface guard on the real tree", () => {
  it("keeps every project module mock full-surface and leak-scoped", async () => {
    const { violations, guardedMocks } = await auditMockModuleSurfaces();
    const detail = violations
      .map(
        (violation) =>
          `${violation.file}:${violation.line}:${violation.column} ` +
          `[${violation.kind}] ${violation.moduleSpecifier}`,
      )
      .join("\n");

    expect(guardedMocks).toBeGreaterThan(0);
    expect(
      violations,
      `Unsafe module mocks:\n${detail}\n\n` +
        "Fix: spread a hoisted real namespace and register behavioral overrides with " +
        "createScopedModuleMocker from tests/helpers/mockSurface.ts.",
    ).toHaveLength(0);
  });
});
