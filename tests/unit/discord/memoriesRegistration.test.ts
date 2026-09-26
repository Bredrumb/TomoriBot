/**
 * `/memories` absorbed roots that formerly had opposite registration shapes, and the resulting
 * permission is the one thing an implementation summary can describe correctly while being wrong.
 * Shared memory teaching must remain reachable to non-managers under `server_memteaching_enabled`,
 * while the Short-Term category remains manager-gated in the route layer.
 * The sibling `/providers` panel exports `managerOnly = true`, so copying it would
 * silently remove teaching from every non-manager in every guild with nothing failing. The manager
 * check for the Short-Term category belongs in the route layer, not in the command's registration,
 * and memoriesRoutes.test.ts proves it for both the clear modal and the clear submit.
 */
import { beforeAll, describe, expect, it } from "bun:test";
import { loadCommandData, ROOT_COMMAND_EXECUTION_KEY } from "@/utils/discord/commandLoader";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

type RegistrationPayload = {
  name: string;
  contexts?: number[];
  default_member_permissions?: string;
};

function findRegistration(
  registrationData: Awaited<ReturnType<typeof loadCommandData>>["registrationData"],
  name: string,
): RegistrationPayload | undefined {
  return registrationData.find((command) => command.name === name) as unknown as RegistrationPayload | undefined;
}

describe("/memories registration restrictions", () => {
  it("registers /memories with no manager default and no context restriction", async () => {
    const { registrationData } = await loadCommandData();
    const memories = findRegistration(registrationData, "memories");

    expect(memories).toBeDefined();
    if (!memories) return;

    expect(memories.default_member_permissions).toBeUndefined();
    expect(memories.contexts).toBeUndefined();
  }, 30000);

  it("keeps /memories a bare root", async () => {
    const { executionMap } = await loadCommandData();

    expect([...(executionMap.get("memories")?.keys() ?? [])]).toEqual([ROOT_COMMAND_EXECUTION_KEY]);
  }, 30000);

  // `/memory` is dissolved outright: its transfer leaves moved to /export and /import, leaving no
  // enabled subcommand behind. Dissolution is asserted by root in configRegistration's DISSOLVED_ROOTS,
  // so this file does not restate it. What the two tests above protect is `/memories` itself: the bare
  // root and its absent manager default, neither of which any other file asserts.
});
