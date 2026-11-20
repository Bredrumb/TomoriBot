import { ComponentType, type MessageCreateOptions, MessageFlags } from "discord.js";
import { danbooruPostUrl, type PostableImage } from "@/tools/restAPIs/danbooru/posts";
import { localizer } from "@/utils/text/localizer";

// Type narrows flags to IsComponentsV2 because interaction reply edits reject notification flags permitted on
// MessageCreateOptions.
export type DanbooruGalleryPayload = Required<Pick<MessageCreateOptions, "components" | "allowedMentions">> & {
  flags: MessageFlags.IsComponentsV2;
};

export function buildDanbooruGalleryPayload(
  locale: string,
  tags: readonly string[],
  images: readonly PostableImage[],
  typedTags?: readonly string[],
): DanbooruGalleryPayload {
  const codeSafe = (text: string) => text.replaceAll("`", "'");
  const query = tags
    .map((tag, index) => {
      const typed = typedTags?.[index];
      return typed && typed !== tag
        ? localizer(locale, "tools.danbooru.gallery_resolved_tag", { typed: codeSafe(typed), tag: codeSafe(tag) })
        : `\`${codeSafe(tag)}\``;
    })
    .join(", ");
  const links = images.map(({ post }) =>
    localizer(locale, "tools.danbooru.gallery_post_link", { id: String(post.id), url: danbooruPostUrl(post.id) }),
  );
  const footerLines = [localizer(locale, "tools.danbooru.gallery_footer", { query }), links.join(" · ")];

  return {
    components: [
      {
        type: ComponentType.MediaGallery,
        items: images.map(({ post, imageUrl }) => ({
          media: { url: imageUrl },
          spoiler: post.rating === "q" || post.rating === "e",
        })),
      },
      {
        type: ComponentType.TextDisplay,
        content: footerLines.map((line) => `-# ${line}`).join("\n"),
      },
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
