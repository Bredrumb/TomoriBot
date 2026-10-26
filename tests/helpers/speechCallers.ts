import { spyOn } from "bun:test";
import { ChannelType } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import { personaRepository } from "@/utils/db/repositories";
import { cooldownRepository } from "@/utils/db/repositories/CooldownRepository";
import * as delivery from "@/utils/discord/webhook/voiceMessageDelivery";
import * as metadata from "@/utils/audio/voiceMessageMetadata";
import * as modals from "@/utils/discord/ui/modals";
import * as whitelist from "@/utils/cache/channelWhitelistCache";
import * as spotlight from "@/utils/cache/personalSpotlightCache";
import { makeFakeInteraction } from "./fakeInteraction";

export function createSpeechCallerFixture(getPersona: () => TomoriState) {
  const spies: Array<{ mockRestore(): void }> = [];
  let delivered = 0;
  const channel = { id: "channel-1", type: ChannelType.GuildText, isThread: () => false };
  const modal = makeFakeInteraction();
  spies.push(spyOn(personaRepository, "loadAllForServer").mockImplementation(async () => [getPersona()]));
  spies.push(
    spyOn(cooldownRepository, "checkMessageTriggerCooldownWithWhitelist").mockResolvedValue({
      isOnCooldown: false,
      remainingSeconds: 0,
      cooldownType: 0,
    }),
  );
  spies.push(
    spyOn(whitelist, "getCachedWhitelistStatus").mockResolvedValue({
      hasActiveWhitelist: false,
      hasActiveChannelWhitelist: false,
      isChannelWhitelisted: false,
      hasActiveRoleWhitelist: false,
      isRoleWhitelisted: false,
      hasActivePersonaWhitelist: false,
      isTriggerAllowed: true,
      hasChannelCooldownOverride: false,
    }),
  );
  spies.push(spyOn(spotlight, "getCachedPersonalSpotlightStatus").mockResolvedValue(null));
  spies.push(spyOn(metadata, "generateVoiceMessageMetadata").mockResolvedValue(null));
  spies.push(spyOn(delivery, "deliverVoiceMessage").mockImplementation(async () => `synthetic-message-${++delivered}`));
  spies.push(
    spyOn(modals, "promptWithRawModal").mockImplementation(
      async () =>
        ({ outcome: "submit", interaction: modal.interaction, values: { voice_message_script: "Hello" } }) as never,
    ),
  );
  return {
    channel,
    modal,
    get delivered() {
      return delivered;
    },
    restore() {
      for (const spy of spies) spy.mockRestore();
    },
  };
}
