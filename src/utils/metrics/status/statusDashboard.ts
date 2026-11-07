import type { Client } from "discord.js";
import type { TomoriState } from "@/types/db/schema";
import {
  buildPersonalStatusPages,
  type PersonalStatusIdentity,
  type StatusViewerInteraction,
} from "@/utils/metrics/status/personalPages";
import { buildServerChannelPages } from "@/utils/metrics/status/serverChannelPages";
import { buildServerConfigPages } from "@/utils/metrics/status/serverConfigPages";
import { buildServerModelPages } from "@/utils/metrics/status/serverModelPages";
import type { StatusPageCategory } from "@/utils/metrics/status/statusPageRenderer";
import {
  STATUS_CATEGORIES,
  STATUS_CATEGORY_LABEL_KEYS,
  type StatusCategory,
} from "@/utils/discord/statusDashboardCatalog";
import { canViewPromptText } from "@/utils/text/promptInspection/delivery";

export interface StatusDashboardBuildDependencies {
  buildServerChannelPages: typeof buildServerChannelPages;
  buildServerConfigPages: typeof buildServerConfigPages;
  buildServerModelPages: typeof buildServerModelPages;
  buildPersonalStatusPages: typeof buildPersonalStatusPages;
}

const defaultDependencies: StatusDashboardBuildDependencies = {
  buildServerChannelPages,
  buildServerConfigPages,
  buildServerModelPages,
  buildPersonalStatusPages,
};

export async function resolveStatusDashboardCategories(
  client: Client,
  interaction: StatusViewerInteraction,
  userData: PersonalStatusIdentity,
  serverDiscId: string,
  tomoriState: TomoriState,
  locale: string,
  dependencies: StatusDashboardBuildDependencies = defaultDependencies,
): Promise<StatusPageCategory[]> {
  const [configPages, modelPages, channelPages, personalPages] = await Promise.all([
    dependencies.buildServerConfigPages(
      client,
      tomoriState,
      locale,
      canViewPromptText(interaction.memberPermissions ?? null, tomoriState),
    ),
    dependencies.buildServerModelPages(client, serverDiscId, tomoriState, locale),
    dependencies.buildServerChannelPages(client, serverDiscId, tomoriState, locale),
    dependencies.buildPersonalStatusPages(interaction, userData, locale),
  ]);

  const pagesByCategory: Record<StatusCategory, StatusPageCategory["pages"]> = {
    persona: [],
    behavior: [configPages[0], configPages[3], channelPages[0]],
    access: [configPages[1], configPages[2], modelPages[2]],
    personal: personalPages,
    models: [modelPages[0], modelPages[1], modelPages[3], configPages[4]],
  };

  return STATUS_CATEGORIES.map((id) => ({
    id,
    labelKey: STATUS_CATEGORY_LABEL_KEYS[id],
    pages: pagesByCategory[id],
  }));
}
