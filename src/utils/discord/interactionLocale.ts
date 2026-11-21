import { getCachedUserRow } from "@/utils/cache/userCache";

/**
 * Resolves the presser's language the way slash commands do, saved preference first, so a button
 * reply matches the panels that user already reads; a message's stored locale belongs to its poster.
 */
export async function resolveUserLocale(interaction: { user: { id: string }; locale: string }): Promise<string> {
  return (await getCachedUserRow(interaction.user.id))?.language_pref ?? interaction.locale;
}
