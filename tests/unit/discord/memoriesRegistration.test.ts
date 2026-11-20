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

  // /memory dissolution is covered by configRegistration's DISSOLVED_ROOTS, so this suite
  // protects only /memories' bare root and absent manager default.
});
