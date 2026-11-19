import { beforeAll, describe, expect, it } from "bun:test";
import { loadCommandData } from "@/utils/discord/commandLoader";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

describe("/personal registration", () => {
  it("leaves only the accepted personal leaves", async () => {
    const { executionMap } = await loadCommandData();
    const personal = executionMap.get("personal");

    expect(personal).toBeDefined();
    if (!personal) return;

    // `nuke` is the erasure route the Privacy Policy names, so it must stay registered.
    expect([...personal.keys()].sort()).toEqual([
      "config",
      "language",
      "memories",
      "message-proxy",
      "nuke",
      "providers",
    ]);
  }, 30000);

  // `/memory` dissolution is omitted here because configRegistration asserts it in DISSOLVED_ROOTS.
});
