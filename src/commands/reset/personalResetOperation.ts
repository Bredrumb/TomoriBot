import { invalidatePersonalSpotlightCache } from "@/utils/cache/personalSpotlightCache";
import { invalidateUserCache } from "@/utils/cache/userCache";
import { type PersonalResetResult, resetRepository } from "@/utils/db/repositories/ResetRepository";

// Excludes personal reset helper from commandLoader scans (warns without this export).
export const isCommandEnabled = () => false;

export interface PersonalResetOperationInput {
  userId: number;
}

export interface PersonalResetOperationDependencies {
  resetPersonalConfiguration: (userId: number) => Promise<PersonalResetResult | null>;
  invalidateUserCache: (userDiscId: string) => void;
  invalidatePersonalSpotlightCache: (serverId: number, userId?: number, channelDiscId?: string) => void;
}

const defaultDependencies: PersonalResetOperationDependencies = {
  resetPersonalConfiguration: (userId) => resetRepository.resetPersonalConfiguration(userId),
  invalidateUserCache,
  invalidatePersonalSpotlightCache,
};

export async function executePersonalReset(
  input: PersonalResetOperationInput,
  deps: PersonalResetOperationDependencies = defaultDependencies,
): Promise<PersonalResetResult | null> {
  const result = await deps.resetPersonalConfiguration(input.userId);
  if (!result) return null;

  deps.invalidateUserCache(result.userDiscId);
  for (const serverId of result.affectedServerIds) {
    deps.invalidatePersonalSpotlightCache(serverId, input.userId);
  }

  return result;
}
