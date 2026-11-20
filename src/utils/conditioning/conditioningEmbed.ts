import { EmbedBuilder, escapeMarkdown } from "discord.js";
import type { ConditioningType } from "@/types/db/schema";
import { CONDITIONING_ACTION_LOCALE_KEYS, type ConditioningActionKey } from "@/utils/conditioning/conditioning";
import { localizedStatusTitle } from "@/utils/discord/ui/statusTitle";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";

/** Darker shades of the interaction colors, so an ignored attempt reads as the same action falling flat. */
const IGNORED_COLORS: Record<ConditioningType, `#${string}`> = {
  reward: "#8C0A70",
  punish: "#7B241C",
};

/** The public reply when the targeted persona is blocking the actor, so no reaction or memory follows. */
export function buildConditioningIgnoredEmbed(params: {
  locale: string;
  type: ConditioningType;
  actionKey: ConditioningActionKey;
  targetName: string;
  expiresAt: Date;
}): EmbedBuilder {
  const vars = { bot: params.targetName };
  const until = localizer(params.locale, "commands.conditioning.shared.ignored_until", {
    ...vars,
    time: `<t:${Math.floor(params.expiresAt.getTime() / 1000)}:R>`,
  });
  return new EmbedBuilder()
    .setTitle(localizer(params.locale, "commands.conditioning.shared.ignored_title", vars))
    .setColor(IGNORED_COLORS[params.type])
    .setDescription(
      `${localizer(params.locale, CONDITIONING_ACTION_LOCALE_KEYS[params.actionKey].ignored_description, vars)}\n-# ${until}`,
    );
}

export function buildConditioningInteractionEmbed(params: {
  locale: string;
  type: ConditioningType;
  actionKey: ConditioningActionKey;
  actorLabel: string;
  targetName: string;
  targetMention?: string;
  reasonText: string;
  extraContext?: Record<string, string>;
  footerKey: string | null;
}): EmbedBuilder {
  const keys = CONDITIONING_ACTION_LOCALE_KEYS[params.actionKey];
  const titleKeys = keys.embed_titles;
  const titleKey = titleKeys[Math.floor(Math.random() * titleKeys.length)];
  const color = params.type === "reward" ? ColorCode.AFFECTION : ColorCode.ERROR;
  const embed = new EmbedBuilder()
    .setTitle(localizedStatusTitle(params.locale, titleKey, color))
    .setColor(color)
    .setDescription(
      localizer(
        params.locale,
        params.reasonText.length > 0 ? keys.embed_description_with_reason : keys.embed_description,
        {
          user: params.actorLabel,
          bot: params.targetMention ?? params.targetName,
          reason: escapeMarkdown(params.reasonText),
          ...params.extraContext,
        },
      ),
    );

  if (params.reasonText.length > 0 && params.footerKey) {
    embed.setFooter({ text: localizer(params.locale, params.footerKey, { bot: params.targetName }) });
  }
  return embed;
}
