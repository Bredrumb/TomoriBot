import path from "node:path";

const DEFAULT_TOKENIZER_ASSET_DIR = "./tokenizers";

export function getTokenizerAssetDir(): string {
  const configuredDir = process.env.TOKENIZER_ASSET_DIR?.trim();
  if (!configuredDir) {
    return path.resolve(process.cwd(), DEFAULT_TOKENIZER_ASSET_DIR);
  }

  return path.resolve(process.cwd(), configuredDir);
}
