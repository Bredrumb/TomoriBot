import { describe, expect, it } from "bun:test";
import {
  auditMockModuleSurfaces,
  HIGH_RISK_MOCK_MODULES,
  scanMockModuleSurfaceSource,
  type MockModuleSurfaceViolationKind,
} from "../../../scripts/checks/lib/mockModuleSurface";

function kinds(source: string): MockModuleSurfaceViolationKind[] {
  return scanMockModuleSurfaceSource(source).map((violation) => violation.kind);
}

describe("module mock surface scanner", () => {
  it("flags a partial high-risk module mock", () => {
    const source = `
      import { mock } from "bun:test";
      mock.module("@/utils/misc/logger", () => ({ log: fakeLog }));
    `;

    expect(kinds(source)).toEqual(["missing-hoisted-real-import", "missing-real-spread", "unscoped-behavior"]);
  });

  it("accepts a harmless raw passthrough with the matching namespace spread", () => {
    const source = `
      import { mock } from "bun:test";
      import * as realLogger from "@/utils/misc/logger";
      mock.module("@/utils/misc/logger", () => ({ ...realLogger }));
    `;

    expect(kinds(source)).toEqual([]);
  });

  it("requires behavioral overrides to use the scoped registrar", () => {
    const unsafe = `
      import { mock } from "bun:test";
      import * as realLogger from "@/utils/misc/logger";
      mock.module("@/utils/misc/logger", () => ({
        ...realLogger,
        log: fakeLog,
      }));
    `;
    const safe = `
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

    expect(kinds(unsafe)).toEqual(["unscoped-behavior"]);
    expect(kinds(safe)).toEqual([]);
  });

  it("does not accept a spread from a different module", () => {
    const source = `
      import { mock } from "bun:test";
      import * as realLogger from "@/utils/misc/logger";
      import * as realRepositories from "@/utils/db/repositories";
      mock.module("@/utils/db/repositories", () => ({ ...realLogger }));
    `;

    expect(kinds(source)).toEqual(["missing-real-spread", "unscoped-behavior"]);
  });

  it("ignores local modules outside the curated set and text in comments", () => {
    const source = `
      import { mock } from "bun:test";
      // mock.module("@/utils/misc/logger", () => ({ log: fakeLog }));
      mock.module("./localFixture", () => ({ value: "fake" }));
    `;

    expect(kinds(source)).toEqual([]);
  });

  it("keeps the curated list focused on shared high-fanout modules", () => {
    expect(HIGH_RISK_MOCK_MODULES).toContain("@/utils/misc/logger");
    expect(HIGH_RISK_MOCK_MODULES).toContain("@/utils/db/repositories");
    expect(HIGH_RISK_MOCK_MODULES).toContain("@/utils/text/localizer");
    expect(HIGH_RISK_MOCK_MODULES).toContain("@/utils/discord/ui/personaWorkflow");
    expect(HIGH_RISK_MOCK_MODULES.has("./localFixture")).toBe(false);
  });
});

describe("module mock surface guard on the real tree", () => {
  it("keeps high-risk module mocks full-surface and leak-scoped", async () => {
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
