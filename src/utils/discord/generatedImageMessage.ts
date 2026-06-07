import { ComponentType, MessageFlags, type MessageCreateOptions } from "discord.js";
import { localizer } from "@/utils/text/localizer";

export type GeneratedImageComponentsV2Payload = Required<Pick<MessageCreateOptions, "components" | "flags">>;

export function buildGeneratedImageComponentsV2Payload(
  attachmentFilename: string,
  elapsedMs: number,
  locale: string,
  referencedIdentities: string[] = [],
): GeneratedImageComponentsV2Payload {
  const seconds = Math.max(0, elapsedMs / 1000).toFixed(1);
  const timingLine = localizer(locale, "tools.image.generated_after_seconds_line", {
    seconds,
  });

  // Build the small-text footer lines: timing first, then any referenced
  // users/personas whose avatars were used as generation references.
  const footerLines = [timingLine];
  if (referencedIdentities.length > 0) {
    footerLines.push(
      localizer(locale, "tools.image.referenced_identities_line", {
        names: referencedIdentities.join(", "),
      }),
    );
  }

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
      content: footerLines.map((line) => `-# ${line}`).join("\n"),
    },
  ] satisfies NonNullable<MessageCreateOptions["components"]>;

  return {
    components,
    flags: MessageFlags.IsComponentsV2,
  };
}
