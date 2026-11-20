import type { TomoriState } from "@/types/db/schema";
import { personaRepository } from "@/utils/db/repositories";

// Must run before writing an avatar or sprite on a pointer persona, because pointers share preset storage and writing
// directly would mutate every server.
export async function forkPointerForAvatarChange(
  selectedPersona: Pick<TomoriState, "persona_id" | "is_pointer">,
): Promise<boolean> {
  if (!selectedPersona.persona_id) {
    return false;
  }

  if (selectedPersona.is_pointer !== true) {
    return true;
  }

  return await personaRepository.materializeIfPointer(selectedPersona.persona_id);
}
