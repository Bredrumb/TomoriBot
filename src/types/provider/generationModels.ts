export interface GenerationModelSelection {
  source: "server" | "personal";
  kind: "text" | "image" | "image-nai" | "video" | "speech" | "speech-endpoint";
  provider: string;
  modelId: number;
}

export type GenerationModelCapability = "text" | "image" | "image-nai" | "video" | "speech";
