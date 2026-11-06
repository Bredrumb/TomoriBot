import { z } from "zod";
import { createOpenRouterCatalog, normalizeOpenRouterCodename } from "@/utils/cache/openrouterCatalog";

const catalogEntrySchema = z.object({
  id: z.string().min(1).max(200),
  architecture: z.object({
    output_modalities: z.array(z.string()).refine((values) => values.includes("transcription")),
  }),
});

function parseOpenRouterTranscriptionModelList(payload: unknown): { id: string }[] {
  const envelope = z.object({ data: z.array(z.unknown()) }).parse(payload);
  return envelope.data.flatMap((entry) => {
    const result = catalogEntrySchema.safeParse(entry);
    return result.success ? [{ id: result.data.id }] : [];
  });
}

const transcriptionCatalog = createOpenRouterCatalog({
  label: "transcription",
  url: "https://openrouter.ai/api/v1/models?output_modalities=transcription",
  parse: parseOpenRouterTranscriptionModelList,
  keyOf: (entry) => entry.id,
});

/** Rechecks the live catalogue, because a codename typed at registration is often one published minutes ago. */
export async function validateOpenRouterTranscriptionModel(codename: string): Promise<boolean> {
  try {
    return Boolean(await transcriptionCatalog.getOrFetch(normalizeOpenRouterCodename(codename), { fresh: true }));
  } catch {
    return false;
  }
}
