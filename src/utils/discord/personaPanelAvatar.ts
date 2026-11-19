import {
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  GuildMember,
  type InteractionEditReplyOptions,
} from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import type { GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import {
  isLocalPersonaAvatarPath,
  loadStoredPersonaAvatarBuffer,
  resolvePersonaAvatarPublicUrl,
} from "@/utils/storage/avatarStorage";

export interface PersonaPanelAvatarData {
  url: string | null;
  files: AttachmentBuilder[];
}

export type PersonaAvatarAsset = { type: "url"; url: string } | { type: "buffer"; buffer: Buffer };

export interface PersonaPanelAvatarDependencies {
  resolvePublicAvatarUrl(reference?: string | null): string | null;
  isLocalAvatarPath(reference?: string | null): boolean;
  loadStoredAvatarBuffer(reference: string): Promise<Buffer | null>;
}

const defaultDependencies: PersonaPanelAvatarDependencies = {
  resolvePublicAvatarUrl: resolvePersonaAvatarPublicUrl,
  isLocalAvatarPath: isLocalPersonaAvatarPath,
  loadStoredAvatarBuffer: loadStoredPersonaAvatarBuffer,
};

export async function resolvePersonaPanelAvatarReference(
  reference: string | null | undefined,
  attachmentName: string,
  dependencies: PersonaPanelAvatarDependencies = defaultDependencies,
): Promise<PersonaPanelAvatarData> {
  const publicUrl = dependencies.resolvePublicAvatarUrl(reference);
  if (publicUrl) return { url: publicUrl, files: [] };
  if (!reference || !dependencies.isLocalAvatarPath(reference)) return { url: null, files: [] };

  const buffer = await dependencies.loadStoredAvatarBuffer(reference);
  return buffer
    ? {
        url: `attachment://${attachmentName}`,
        files: [new AttachmentBuilder(buffer, { name: attachmentName })],
      }
    : { url: null, files: [] };
}

export async function resolveAlterPersonaAvatarAsset(
  persona: TomoriState,
  dependencies: PersonaPanelAvatarDependencies = defaultDependencies,
): Promise<PersonaAvatarAsset | null> {
  const publicUrl = dependencies.resolvePublicAvatarUrl(persona.webhook_avatar_url);
  if (publicUrl) {
    return { type: "url", url: publicUrl };
  }

  const avatarReference = persona.webhook_avatar_url;
  if (!avatarReference || !dependencies.isLocalAvatarPath(avatarReference)) {
    return null;
  }

  const buffer = await dependencies.loadStoredAvatarBuffer(avatarReference);
  return buffer ? { type: "buffer", buffer } : null;
}

// Main personas prefer the bot's guild avatar before webhook_avatar_url because they speak through the bot account.
export async function resolvePersonaPanelAvatar(
  interaction: GlobalRoutableInteraction | ChatInputCommandInteraction,
  persona: TomoriState,
  dependencies: PersonaPanelAvatarDependencies = defaultDependencies,
): Promise<PersonaPanelAvatarData> {
  if (!persona.is_alter) {
    const avatarOptions = { size: 256, extension: "png", forceStatic: true } as const;
    return {
      url:
        interaction.guild?.members.me?.displayAvatarURL(avatarOptions) ??
        interaction.client.user?.displayAvatarURL(avatarOptions) ??
        resolvePersonaAvatarPublicUrl(persona.webhook_avatar_url),
      files: [],
    };
  }

  return resolvePersonaPanelAvatarReference(
    persona.webhook_avatar_url,
    `persona_avatar_${persona.persona_id ?? "selected"}.png`,
    dependencies,
  );
}

// Existing attachments are cleared on every repaint because Discord keeps prior message attachments unless
// attachments: [] is sent.
export function withPersonaPanelAvatar<T extends InteractionEditReplyOptions>(
  payload: T,
  avatar?: PersonaPanelAvatarData | readonly PersonaPanelAvatarData[],
): T & Pick<InteractionEditReplyOptions, "attachments" | "files"> {
  const avatars = avatar ? (Array.isArray(avatar) ? avatar : [avatar]) : [];
  return {
    ...payload,
    attachments: [],
    files: [...(payload.files ?? []), ...avatars.flatMap((item) => item.files)],
  };
}

export function resolveInvokerAvatarUrl(interaction: GlobalRoutableInteraction | ChatInputCommandInteraction): string {
  // An uncached member arrives as a raw APIInteractionGuildMember, which has no displayAvatarURL.
  const source = interaction.member instanceof GuildMember ? interaction.member : interaction.user;
  return source.displayAvatarURL({ size: 256, extension: "png" });
}
