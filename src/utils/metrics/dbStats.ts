import { sql } from "@/utils/db/client";

export async function loadVideoModelById(videoModelId: number): Promise<{ codename: string; provider: string } | null> {
  const [row] = await sql<{ codename: string; provider: string }[]>`
    SELECT codename, provider FROM video_generation_models WHERE video_model_id = ${videoModelId} LIMIT 1
  `;
  return row ?? null;
}
