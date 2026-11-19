import { getCachedUserRow } from "@/utils/cache/userCache";

// Interaction replies check the presser's saved preference before the message's stored locale because that locale
// belongs to the poster.
export async function resolveUserLocale(interaction: { user: { id: string }; locale: string }): Promise<string> {
  return (await getCachedUserRow(interaction.user.id))?.language_pref ?? interaction.locale;
}
