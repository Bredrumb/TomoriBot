import { statRepository } from "@/utils/db/repositories";
import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { log } from "@/utils/misc/logger";
import { loadStoredPersonaAvatarDataUri } from "@/utils/storage/avatarStorage";
import { type Timeframe, resolveWindowFrom } from "@/utils/stats/statsDashboard";
import { extractCardPalette, loadTomoriconDataUri } from "@/utils/stats/cardColor";
import { loadStatsPersonaAvatarDataUri, loadStatsPresetAvatarLookup } from "@/utils/stats/personaAvatar";
import type { PersonalCardData, PersonalFavoritePersona } from "@/utils/stats/statsInfographic";

export interface GatherPersonalCardArgs {
  userId: number;
  serverId?: number;
  guildDiscId: string;
  username: string;
  userAvatarUrl?: string | null;
  locale: string;
  timeframe: Timeframe;
}

export async function gatherPersonalCardData(args: GatherPersonalCardArgs): Promise<PersonalCardData> {
  // Card generation is a low-frequency snapshot, so include current-process
  // telemetry that may still be buffered from a just-completed interaction.
  await statRepository.flush();
  const { userId, serverId, guildDiscId, username, userAvatarUrl, locale, timeframe } = args;
  const windowFrom = resolveWindowFrom(timeframe);
  const windowArg = windowFrom ? { from: windowFrom } : {};

  const [totalTriggers, tokenTotals, estimatedCost, personaTokenCosts, modelBreakdown] = await Promise.all([
    statRepository.getMetricTotal({ metric: "message_sent", userId, serverId, ...windowArg }),
    statRepository.getTokenTotals({ userId, serverId, ...windowArg }),
    statRepository.getEstimatedCost({ userId, serverId, ...windowArg }),
    statRepository.getPersonaTokenCostBreakdown({ userId, serverId, ...windowArg }),
    statRepository.getModelBreakdown({ userId, serverId, ...windowArg }),
  ]);

  let favoritePersonas: PersonalFavoritePersona[] = [];
  try {
    const [personas, presetAvatars] = await Promise.all([
      getCachedAllPersonas(guildDiscId),
      loadStatsPresetAvatarLookup(),
    ]);
    // Ranked by total tokens (desc) so the list order matches the card's
    // Tokens/Spent columns. `getPersonaTokenCostBreakdown` already orders the
    // whole population by tokens, so the top five are the genuine token leaders.
    favoritePersonas = await Promise.all(
      personaTokenCosts.slice(0, 5).map(async (entry) => {
        const persona = personas.find((candidate) => candidate.persona_lineage_id === entry.lineageId);
        const avatarDataUri = persona ? await loadStatsPersonaAvatarDataUri(persona, presetAvatars) : null;
        return {
          name: persona?.persona_nickname ?? `Persona #${entry.lineageId}`,
          avatarDataUri,
          totalTokens: entry.inputTokens + entry.outputTokens,
          estimatedCost: entry.cost,
        };
      }),
    );
  } catch (error) {
    log.warn("personalCardGatherer: persona resolution failed", error as Error);
  }

  let userAvatarDataUri: string | null = null;
  if (userAvatarUrl) {
    try {
      userAvatarDataUri = await loadStoredPersonaAvatarDataUri(userAvatarUrl);
    } catch (error) {
      log.warn("personalCardGatherer: user avatar resolution failed", error as Error);
    }
  }

  const leadingAvatarDataUri = favoritePersonas[0]?.avatarDataUri ?? null;
  const palette = await extractCardPalette(leadingAvatarDataUri);

  return {
    locale,
    timeframe,
    username,
    userAvatarDataUri,
    tomoriconDataUri: await loadTomoriconDataUri(palette.ink),
    palette,
    totalTokens: tokenTotals.inputTokens + tokenTotals.outputTokens,
    totalTriggers,
    estimatedCost,
    favoritePersonas,
    favoriteModelName: modelBreakdown[0] ? modelBreakdown[0].model : null,
  };
}
