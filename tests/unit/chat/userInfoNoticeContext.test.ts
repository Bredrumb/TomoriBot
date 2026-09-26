import { beforeAll, describe, expect, it } from "bun:test";
import {
  ComponentType,
  type ComponentInContainerData,
  type ContainerComponentData,
  type Embed,
  type TopLevelComponentData,
} from "discord.js";
import { buildNoticeContainer } from "@/utils/discord/ui/statusComponents";
import { ColorCode } from "@/utils/misc/logger";
import { processEmbedsFromMessage } from "@/utils/chat/contextEmbeds";
import { checkTargetEmbedTitle } from "@/utils/discord/embedClassifier";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";

function makeEmbed(title: string, description: string): Embed {
  return { title, description, fields: [], color: null } as unknown as Embed;
}

function buildContext(embed: Embed): string {
  return processEmbedsFromMessage({
    embeds: [embed],
    content: "",
    imageAttachments: [],
    isTomoriAuthoredMessage: true,
    selfDebugEnabled: false,
    tomoriNickname: "Mirri",
  }).content;
}

function isContainerComponent(
  component: TopLevelComponentData,
): component is ContainerComponentData<ComponentInContainerData> {
  return "components" in component && component.type === ComponentType.Container;
}

describe("update_user_info notice visibility", () => {
  beforeAll(async () => {
    await initializeLocalizer();
  });

  it("classifies the tool's success title the same way a memory-learning title is classified", () => {
    const title = localizer("en-US", "tools.user_info_update.success_title", { target_user: "Bau" });
    expect(checkTargetEmbedTitle(title)).toEqual({ isTarget: true, type: "user_info_update" });

    const memoryTitle = localizer("en-US", "genai.self_teach.personal_memory_learned_title");
    expect(checkTargetEmbedTitle(memoryTitle).isTarget).toBe(true);
  });

  it("renders the notice into the [System: ...] block for a later turn", () => {
    const title = localizer("en-US", "tools.user_info_update.success_title", { target_user: "Bau" });
    const body = 'Updated the following:\n1. Naming prefix: `none` → `Master`\n\nMirri now calls Bau "Master Bau".';

    const content = buildContext(makeEmbed(title, body));

    expect(content).toContain("[System:");
    expect(content).toContain(title);
    expect(content).toContain("Master Bau");
  });

  it("survives the Components V2 round trip the tool actually sends through", () => {
    const targetLabel = "Bau";
    const body = 'Updated the following:\n1. Naming prefix: `none` → `Master`\n\nMirri now calls Bau "Master Bau".';
    const components = buildNoticeContainer({
      locale: "en-US",
      color: ColorCode.SUCCESS,
      titleKey: "tools.user_info_update.success_title",
      titleVars: { target_user: targetLabel },
      description: body,
      footerKey: "tools.user_info_update.success_footer",
      footerVars: { target_user: targetLabel },
    });

    const content = processEmbedsFromMessage({
      embeds: [],
      components,
      content: "",
      imageAttachments: [],
      isTomoriAuthoredMessage: true,
      selfDebugEnabled: false,
      tomoriNickname: "Mirri",
    }).content;

    expect(content).toContain("[System:");
    expect(content).toContain("Updated Bau's Profile");
    expect(content).toContain("Master Bau");
  });

  it("keeps Japanese Components V2 tool notices visible to the chat reader", () => {
    const title = localizer("ja", "tools.user_info_update.success_title", { target_user: "Juno" });
    const components = buildNoticeContainer({
      locale: "ja",
      titleKey: "tools.user_info_update.success_title",
      titleVars: { target_user: "Juno" },
      description: "Updated a profile field.",
    });
    const result = processEmbedsFromMessage({
      embeds: [],
      components,
      content: "",
      imageAttachments: [],
      isTomoriAuthoredMessage: true,
      selfDebugEnabled: false,
      tomoriNickname: "Mirri",
    });
    expect(result.processedSystemEmbed).toBe(true);
    expect(result.content).toContain(title);
  });

  it("separates the footer from the body with a real divider component", () => {
    const components = buildNoticeContainer({
      locale: "en-US",
      titleKey: "tools.user_info_update.success_title",
      titleVars: { target_user: "Bau" },
      description: "body",
      footerKey: "tools.user_info_update.success_footer",
      footerVars: { target_user: "Bau" },
    });

    const [container] = components;
    if (!container || !isContainerComponent(container)) {
      throw new Error("Expected the notice to be wrapped in a container component");
    }

    const inner = container.components;
    expect(
      inner.some(
        (component) =>
          component.type === ComponentType.Separator && "divider" in component && Boolean(component.divider),
      ),
    ).toBe(true);
  });

  it("also recognizes user block and unblock notices", () => {
    const blockTitle = localizer("en-US", "tools.user_block.block_block_title", {
      persona_name: "Mirri",
      user_name: "Bau",
      duration_hours: 2,
    });
    expect(checkTargetEmbedTitle(blockTitle)).toEqual({ isTarget: true, type: "user_moderation" });

    const unblockTitle = localizer("en-US", "tools.user_block.unblock_success_title", {
      persona_name: "Mirri",
      user_name: "Bau",
    });
    expect(checkTargetEmbedTitle(unblockTitle)).toEqual({ isTarget: true, type: "user_moderation" });
  });

  it("leaves an unrecognized Tomori embed title unclassified", () => {
    expect(checkTargetEmbedTitle("Some Unrelated Embed")).toEqual({ isTarget: false, type: null });
  });
});
