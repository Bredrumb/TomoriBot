import { z } from "zod";

export const generatedMediaSourceSchema = z.object({
  provider: z.string().min(1).max(256),
  model: z.string().min(1).max(512),
});

export type GeneratedMediaSource = z.infer<typeof generatedMediaSourceSchema>;

export interface GenerationModelSelection {
  source: "server" | "personal";
  kind: "text" | "image" | "image-nai" | "video" | "speech" | "speech-endpoint";
  provider: string;
  modelId: number;
}

export type GenerationModelCapability = "text" | "image" | "image-nai" | "video" | "speech";
