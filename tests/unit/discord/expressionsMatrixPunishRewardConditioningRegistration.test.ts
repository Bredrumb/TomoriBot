import { beforeAll, describe, expect, it } from "bun:test";
import { loadCommandData } from "@/utils/discord/commandLoader";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

type RegistrationPayload = {
  name: string;
  contexts?: number[];
  default_member_permissions?: string;
  options?: Array<{ name: string }>;
};

describe("/expressions, /matrix, /punish, /reward, /conditioning registration restrictions", () => {
  it("registers /expressions and /matrix as guild-only and manager-only", async () => {
    const { registrationData } = await loadCommandData();

    const expressionsCommand = registrationData.find((cmd) => cmd.name === "expressions") as unknown as
      | RegistrationPayload
      | undefined;
    const matrixCommand = registrationData.find((cmd) => cmd.name === "matrix") as unknown as
      | RegistrationPayload
      | undefined;

    expect(expressionsCommand).toBeDefined();
    expect(matrixCommand).toBeDefined();
    if (!expressionsCommand || !matrixCommand) return;

    // contexts: [0] means InteractionContextType.Guild
    expect(expressionsCommand.contexts).toEqual([0]);
    expect(matrixCommand.contexts).toEqual([0]);
    // default_member_permissions: "32" means PermissionsBitField.Flags.ManageGuild
    expect(expressionsCommand.default_member_permissions).toBe("32");
    expect(expressionsCommand.options?.map((option) => option.name).sort()).toEqual(["initialize", "manage"]);
    expect(matrixCommand.default_member_permissions).toBe("32");
  });

  it("registers /punish and /reward as guild-only without manager default", async () => {
    const { registrationData } = await loadCommandData();
    const punishCommand = registrationData.find((cmd) => cmd.name === "punish") as unknown as
      | RegistrationPayload
      | undefined;
    const rewardCommand = registrationData.find((cmd) => cmd.name === "reward") as unknown as
      | RegistrationPayload
      | undefined;

    expect(punishCommand).toBeDefined();
    expect(rewardCommand).toBeDefined();
    if (!punishCommand || !rewardCommand) return;

    expect(punishCommand.contexts).toEqual([0]);
    expect(rewardCommand.contexts).toEqual([0]);
    expect(punishCommand.default_member_permissions).toBeUndefined();
    expect(rewardCommand.default_member_permissions).toBeUndefined();
  });

  it("registers /conditioning with correct restrictions and without punish or reward paths", async () => {
    const { registrationData, executionMap } = await loadCommandData();
    const conditioningCommand = registrationData.find((cmd) => cmd.name === "conditioning") as unknown as
      | RegistrationPayload
      | undefined;

    expect(conditioningCommand).toBeDefined();
    if (!conditioningCommand) return;

    expect(conditioningCommand.contexts).toEqual([0]);
    expect(conditioningCommand.default_member_permissions).toBeUndefined();

    const conditioningExec = executionMap.get("conditioning");
    expect(conditioningExec).toBeDefined();
    if (!conditioningExec) return;

    const keys = Array.from(conditioningExec.keys());
    expect(keys).toContain("manage");
    expect(keys).toContain("remove");
    expect(typeof conditioningExec.get("manage")).toBe("function");
    expect(typeof conditioningExec.get("remove")).toBe("function");
    expect(keys.some((k) => k.startsWith("punish."))).toBe(false);
    expect(keys.some((k) => k.startsWith("reward."))).toBe(false);
  });
});
