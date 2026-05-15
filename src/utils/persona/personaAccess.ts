import type { WhitelistCheckResult } from "@/types/misc/channelWhitelist";
import { whitelistRepository } from "@/utils/db/repositories/WhitelistRepository";
import { userRepository, type PersonalSpotlightStatus } from "@/utils/db/repositories/UserRepository";

export function isPersonaAllowedForTrigger(
  whitelistStatus: WhitelistCheckResult | null | undefined,
  spotlightStatus: PersonalSpotlightStatus | null | undefined,
  tomoriId: number | null | undefined,
): boolean {
  return (
    whitelistRepository.isPersonaAllowedByWhitelistStatus(whitelistStatus, tomoriId) &&
    userRepository.isPersonaAllowedByPersonalSpotlight(spotlightStatus, tomoriId)
  );
}

export function filterPersonasForTrigger<T extends { tomori_id?: number | null | undefined }>(
  personas: readonly T[],
  whitelistStatus: WhitelistCheckResult | null | undefined,
  spotlightStatus: PersonalSpotlightStatus | null | undefined,
): T[] {
  return personas.filter((persona) => isPersonaAllowedForTrigger(whitelistStatus, spotlightStatus, persona.tomori_id));
}
