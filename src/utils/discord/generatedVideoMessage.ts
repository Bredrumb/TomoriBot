import { ComponentType, MessageFlags, type MessageCreateOptions } from "discord.js";
import { localizer } from "@/utils/text/localizer";

export type GeneratedVideoComponentsV2Payload = Required<Pick<MessageCreateOptions, "components" | "flags">>;

/**
 * Build a Components V2 payload that renders a generated video inside a Media
 * Gallery with a small-text "Generated in Xs" footer below it.
 *
 * This mirrors {@link buildGeneratedImageComponentsV2Payload}: the Media Gallery
 * component (type 12) is documented as "Display images and other media", so it
 * renders the .mp4 with Discord's inline player while letting the timing line sit
 * BELOW the media (a plain message `content` caption would render above it).
 *
 * @param attachmentFilename - Name of the attached video file (referenced via attachment://)
 * @param elapsedMs - Wall-clock generation time in milliseconds
 * @param locale - Locale for the footer text
 * @returns Components V2 payload with the IsComponentsV2 flag set
 */
export function buildGeneratedVideoComponentsV2Payload(
  attachmentFilename: string,
  elapsedMs: number,
  locale: string,
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
          media: {
            url: `attachment://${attachmentFilename}`,
          },
        },
      ],
    },
    {
      type: ComponentType.TextDisplay,
      content: `-# ${timingLine}`,
    },
  ] satisfies NonNullable<MessageCreateOptions["components"]>;

  return {
    components,
    flags: MessageFlags.IsComponentsV2,
  };
}
