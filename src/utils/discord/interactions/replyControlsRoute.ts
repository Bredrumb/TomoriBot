import { tomoriChat } from "@/events/messageCreate/tomoriChat";
import {
  type FastRegenerationDecline,
  REPLY_CONTROLS_NAMESPACE,
  REPLY_CONTROLS_VERSION,
  resolveFastRegeneration,
} from "@/utils/discord/fastRegeneration";
import type { GlobalInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { replyPanelReceipt } from "@/utils/discord/ui/panel";
import { localizer } from "@/utils/text/localizer";

export const replyControlsInteractionRoute: GlobalInteractionRoute = {
  namespace: REPLY_CONTROLS_NAMESPACE,
  version: REPLY_CONTROLS_VERSION,
  async execute(client, interaction, route): Promise<void> {
    const [action, locale] = route.segments;
    if (
      !interaction.isButton() ||
      route.segments.length !== 2 ||
      !locale ||
      (action !== "retry" && action !== "continue")
    ) {
      throw new Error("Invalid reply control");
    }
    await interaction.deferUpdate();
    const selection = await resolveFastRegeneration(
      interaction.channelId,
      interaction.message.id,
      interaction.user.id,
      action,
    );
    if (selection.status !== "ready") {
      await replyPanelReceipt(interaction, {
        tone: "warning",
        heading: localizer(locale, "general.reply_controls.unavailable"),
        detail: localizer(
          locale,
          selection.status === "denied" ? "general.reply_controls.only_triggerer" : "general.reply_controls.stale",
        ),
      });
      return;
    }
    const member = interaction.inCachedGuild()
      ? interaction.member
      : await interaction.guild?.members.fetch(interaction.user.id);
    if (!member) return;

    const message = action === "retry" ? selection.trigger : selection.reply;
    let decline: FastRegenerationDecline | undefined;
    const disposition = await tomoriChat({
      client,
      message,
      isFromQueue: false,
      isManuallyTriggered: true,
      selectedPersonaId: selection.personaId,
      textQuotaTriggerKey: `fast-regeneration:${selection.request.replyId}`,
      textQuotaUserDiscId: interaction.user.id,
      suppressSelfReply: true,
      manualTriggerInvoker: {
        userDiscId: interaction.user.id,
        username: interaction.user.username,
        locale,
        member,
      },
      fastRegeneration: {
        ...selection.request,
        onDecline: (reason) => {
          decline = reason;
        },
      },
    });
    if (disposition !== "run" || decline) {
      await replyPanelReceipt(interaction, {
        tone: "warning",
        heading: localizer(locale, "general.reply_controls.unavailable"),
        detail: localizer(
          locale,
          decline === "newer-messages" ? "general.reply_controls.newer_messages" : "general.reply_controls.stale",
        ),
      });
    }
  },
};
