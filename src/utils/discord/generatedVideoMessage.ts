import { ComponentType, MessageFlags, type MessageCreateOptions } from "discord.js";
import { buildGeneratedMediaSourceLine, type GeneratedMediaSource } from "@/utils/discord/generatedMediaMetadata";
import { localizer } from "@/utils/text/localizer";

export type GeneratedVideoComponentsV2Payload = Required<Pick<MessageCreateOptions, "components" | "flags">>;

// Media Gallery (type 12) renders the .mp4 inline with the timing footer below it, whereas a plain message content
// caption would render above the media.
export function buildGeneratedVideoComponentsV2Payload(
  attachmentFilename: string,
  elapsedMs: number,
  locale: string,
  spoiler = false,
  source?: GeneratedMediaSource,
): GeneratedVideoComponentsV2Payload {
  const seconds = Math.max(0, elapsedMs / 1000).toFixed(1);
  const timingLine = localizer(locale, "tools.video.generated_after_seconds_line", {
    seconds,
  });

  const components = [
    {
      type: ComponentType.MediaGallery,
      items: [
        {
          ...(spoiler ? { spoiler: true } : {}),
          media: {
            url: `attachment://${attachmentFilename}`,
          },
        },
      ],
    },
    {
      type: ComponentType.TextDisplay,
      content: [timingLine, ...(source ? [buildGeneratedMediaSourceLine(locale, source)] : [])]
        .map((line) => `-# ${line}`)
        .join("\n"),
    },
  ] satisfies NonNullable<MessageCreateOptions["components"]>;

  return {
    components,
    flags: MessageFlags.IsComponentsV2,
  };
}
