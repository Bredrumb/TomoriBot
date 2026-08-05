import fs from "node:fs";
import path from "node:path";
import { BytePairEncodingCore, type RawBytePairRanks } from "gpt-tokenizer/BytePairEncodingCore";
import { log } from "@/utils/misc/logger";
import { getTokenizerAssetDir } from "@/utils/provider/tokenizerAssetDir";

const LOCAL_LOGIT_BIAS_TOKENIZER_FAMILY_VALUES = [
  "deepseek_v3_r1",
  "qwen3_5",
  "mistral_small3",
  "glm_zai",
  "stepfun_step35",
  "kimi_k2",
  "gemma3",
  "nemotron3",
] as const;

export type LocalLogitBiasTokenizerFamily = (typeof LOCAL_LOGIT_BIAS_TOKENIZER_FAMILY_VALUES)[number];

type LocalTokenizerEncoder = (text: string) => number[];
type LocalTokenizerJsonMode = "byte_level" | "sentencepiece" | "plain";
type LocalTokenizerConfigNode =
  | {
      type?: string;
      pattern?: {
        Regex?: string;
        String?: string;
      };
      pretokenizers?: LocalTokenizerConfigNode[];
      decoders?: LocalTokenizerConfigNode[];
    }
  | null
  | undefined;

interface TokenizerJsonAddedToken {
  id?: number;
  content?: string;
}

interface TokenizerJsonFile {
  model?: {
    vocab?: Record<string, number>;
    byte_fallback?: boolean;
  };
  added_tokens?: TokenizerJsonAddedToken[];
  pre_tokenizer?: LocalTokenizerConfigNode;
  decoder?: LocalTokenizerConfigNode;
}

interface TekkenTokenEntry {
  rank?: number;
  token_bytes?: string;
  token_str?: string;
}

interface TekkenFile {
  config?: {
    pattern?: string;
  };
  vocab?: TekkenTokenEntry[];
  special_tokens?: Record<string, TekkenTokenEntry> | TekkenTokenEntry[];
}

const tokenizerCache = new Map<LocalLogitBiasTokenizerFamily, LocalTokenizerEncoder | null>();
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const byteLevelCharToByte = buildByteLevelCharToByteMap();
const defaultTiktokenRegexByFamily: Record<LocalLogitBiasTokenizerFamily, RegExp | null> = {
  deepseek_v3_r1: null,
  qwen3_5: null,
  mistral_small3: null,
  glm_zai:
    /(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu,
  stepfun_step35: null,
  kimi_k2: new RegExp(
    [
      "[\\p{Script=Han}]+",
      "[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]*[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]+(?i:'s|'t|'re|'ve|'m|'ll|'d)?",
      "[^\\r\\n\\p{L}\\p{N}]?[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]+[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]*(?i:'s|'t|'re|'ve|'m|'ll|'d)?",
      "\\p{N}{1,3}",
      " ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*",
      "\\s*[\\r\\n]+",
      "\\s+(?!\\S)",
      "\\s+",
    ].join("|"),
    "gu",
  ),
  gemma3: null,
  nemotron3: null,
};

export function getLocalLogitBiasTokenizerEncoder(family: LocalLogitBiasTokenizerFamily): LocalTokenizerEncoder | null {
  if (tokenizerCache.has(family)) {
    return tokenizerCache.get(family) ?? null;
  }

  try {
    const assetDir = path.join(getTokenizerAssetDir(), family);
    const encoder = loadTokenizerEncoderFromAssetDir(family, assetDir);
    tokenizerCache.set(family, encoder);
    return encoder;
  } catch (error) {
    tokenizerCache.set(family, null);
    log.warn("Failed to load local logit-bias tokenizer", {
      family,
      tokenizerAssetDir: getTokenizerAssetDir(),
      error,
    });
    return null;
  }
}

export function resolveLocalLogitBiasTokenizerFamily(
  rawTokenizer: string | null | undefined,
  modelCodename: string,
): LocalLogitBiasTokenizerFamily | null {
  const normalizedTokenizer = rawTokenizer?.trim().toLowerCase() ?? "";
  const normalizedModelCodename = modelCodename.trim().toLowerCase();

  if (
    normalizedTokenizer.includes("deepseek") ||
    normalizedModelCodename.includes("deepseek") ||
    normalizedModelCodename.includes("chimera") ||
    normalizedModelCodename.includes("aion-labs/aion-2.0")
  ) {
    return "deepseek_v3_r1";
  }

  if (
    normalizedTokenizer.includes("qwen") ||
    normalizedModelCodename.includes("qwen3.5") ||
    normalizedModelCodename.includes("qwen-3.5")
  ) {
    return "qwen3_5";
  }

  if (
    normalizedTokenizer.includes("tekken") ||
    normalizedTokenizer.includes("mistral") ||
    normalizedModelCodename.includes("mistral-small-3") ||
    normalizedModelCodename.includes("cydonia-24b-v4.1")
  ) {
    return "mistral_small3";
  }

  if (
    normalizedTokenizer.includes("chatglm") ||
    normalizedTokenizer.includes("glm") ||
    normalizedModelCodename.includes("glm-4.6") ||
    normalizedModelCodename.includes("glm-4.7") ||
    normalizedModelCodename.includes("glm-5") ||
    normalizedModelCodename.startsWith("z-ai/") ||
    normalizedModelCodename.startsWith("z.ai/") ||
    normalizedModelCodename.startsWith("zai/")
  ) {
    return "glm_zai";
  }

  if (normalizedTokenizer.includes("step") || normalizedModelCodename.includes("step-3.5")) {
    return "stepfun_step35";
  }

  if (
    normalizedTokenizer.includes("kimi") ||
    normalizedTokenizer.includes("moonshot") ||
    normalizedModelCodename.includes("kimi-k2")
  ) {
    return "kimi_k2";
  }

  if (normalizedTokenizer.includes("gemma") || normalizedModelCodename.includes("gemma-3")) {
    return "gemma3";
  }

  if (normalizedTokenizer.includes("nemotron") || normalizedModelCodename.includes("nemotron-3")) {
    return "nemotron3";
  }

  return null;
}

export function isLocalLogitBiasTokenizerFamily(value: string): value is LocalLogitBiasTokenizerFamily {
  return LOCAL_LOGIT_BIAS_TOKENIZER_FAMILY_VALUES.includes(value as LocalLogitBiasTokenizerFamily);
}

function loadTokenizerEncoderFromAssetDir(
  family: LocalLogitBiasTokenizerFamily,
  assetDir: string,
): LocalTokenizerEncoder {
  const tokenizerJsonPath = path.join(assetDir, "tokenizer.json");
  if (fs.existsSync(tokenizerJsonPath)) {
    const encoder = buildTokenizerJsonEncoder(tokenizerJsonPath);
    return (text) => encoder.encodeNative(text);
  }

  const tekkenPath = path.join(assetDir, "tekken.json");
  if (fs.existsSync(tekkenPath)) {
    const encoder = buildTekkenEncoder(tekkenPath);
    return (text) => encoder.encodeNative(text);
  }

  const tiktokenModelPath = path.join(assetDir, "tiktoken.model");
  if (fs.existsSync(tiktokenModelPath)) {
    const encoder = buildTiktokenEncoder(tiktokenModelPath, defaultTiktokenRegexByFamily[family]);
    return (text) => encoder.encodeNative(text);
  }

  const tokenizerModelPath = path.join(assetDir, "tokenizer.model");
  if (fs.existsSync(tokenizerModelPath)) {
    const encoder = buildTiktokenEncoder(tokenizerModelPath, defaultTiktokenRegexByFamily[family]);
    return (text) => encoder.encodeNative(text);
  }

  throw new Error(`No supported tokenizer asset found in ${assetDir} for ${family}`);
}

function buildTokenizerJsonEncoder(filePath: string): BytePairEncodingCore {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as TokenizerJsonFile;
  const vocab = data.model?.vocab ?? {};
  const tokenizerMode = detectTokenizerJsonMode(data, vocab);
  const bytePairRankDecoder: Array<string | readonly number[]> = [];

  for (const [token, rank] of Object.entries(vocab)) {
    if (!Number.isInteger(rank) || rank < 0) continue;
    bytePairRankDecoder[rank] = decodeTokenizerJsonToken(token, tokenizerMode);
  }

  for (const token of data.added_tokens ?? []) {
    const tokenId = token.id;
    if (
      typeof tokenId !== "number" ||
      !Number.isInteger(tokenId) ||
      tokenId < 0 ||
      typeof token.content !== "string" ||
      token.content.length === 0 ||
      bytePairRankDecoder[tokenId] !== undefined
    ) {
      continue;
    }

    bytePairRankDecoder[tokenId] = token.content;
  }

  return new BytePairEncodingCore({
    bytePairRankDecoder: bytePairRankDecoder as RawBytePairRanks,
    tokenSplitRegex: extractTokenizerJsonRegex(data, tokenizerMode),
  });
}

function buildTekkenEncoder(filePath: string): BytePairEncodingCore {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8")) as TekkenFile;
  const bytePairRankDecoder: Array<string | readonly number[]> = [];

  for (const tokenEntry of data.vocab ?? []) {
    const rank = tokenEntry.rank;
    if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 0) continue;
    bytePairRankDecoder[rank] = decodeTekkenToken(tokenEntry);
  }

  const specialTokens = Array.isArray(data.special_tokens)
    ? data.special_tokens
    : Object.values(data.special_tokens ?? {});
  for (const tokenEntry of specialTokens) {
    const rank = tokenEntry.rank;
    if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 0) continue;
    if (bytePairRankDecoder[rank] !== undefined) continue;
    bytePairRankDecoder[rank] = decodeTekkenToken(tokenEntry);
  }

  const pattern = data.config?.pattern?.trim();
  if (!pattern) {
    throw new Error(`Missing Tekken pattern in ${filePath}`);
  }

  return new BytePairEncodingCore({
    bytePairRankDecoder: bytePairRankDecoder as RawBytePairRanks,
    tokenSplitRegex: new RegExp(pattern, "gu"),
  });
}

function buildTiktokenEncoder(filePath: string, tokenSplitRegex: RegExp | null): BytePairEncodingCore {
  const bytePairRankDecoder: Array<string | readonly number[]> = [];
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const [rawToken, rawRank] = trimmed.split(/\s+/, 2);
    const rank = Number.parseInt(rawRank, 10);
    if (!rawToken || !Number.isInteger(rank) || rank < 0) continue;

    bytePairRankDecoder[rank] = decodeTokenBytes(Buffer.from(rawToken, "base64"));
  }

  if (!tokenSplitRegex) {
    throw new Error(`Missing token split regex for ${filePath}`);
  }

  return new BytePairEncodingCore({
    bytePairRankDecoder: bytePairRankDecoder as RawBytePairRanks,
    tokenSplitRegex,
  });
}

function detectTokenizerJsonMode(data: TokenizerJsonFile, vocab: Record<string, number>): LocalTokenizerJsonMode {
  if (
    containsTokenizerNodeType(data.pre_tokenizer, "ByteLevel") ||
    containsTokenizerNodeType(data.decoder, "ByteLevel")
  ) {
    return "byte_level";
  }

  if (
    data.model?.byte_fallback ||
    Object.keys(vocab).some((token) => token.includes("▁") || /<0x[0-9A-Fa-f]{2}>/.test(token))
  ) {
    return "sentencepiece";
  }

  return "plain";
}

function decodeTokenizerJsonToken(token: string, mode: LocalTokenizerJsonMode): string | readonly number[] {
  switch (mode) {
    case "byte_level":
      return decodeByteLevelToken(token);
    case "sentencepiece":
      return decodeSentencePieceToken(token);
    default:
      return token;
  }
}

function decodeTekkenToken(tokenEntry: TekkenTokenEntry): string | readonly number[] {
  if (typeof tokenEntry.token_bytes === "string") {
    return decodeTokenBytes(Buffer.from(tokenEntry.token_bytes, "base64"));
  }

  if (typeof tokenEntry.token_str === "string") {
    return tokenEntry.token_str;
  }

  throw new Error("Tekken entry is missing token_bytes/token_str");
}

function decodeByteLevelToken(token: string): string | readonly number[] {
  const bytes: number[] = [];

  for (const character of token) {
    const value = byteLevelCharToByte.get(character);
    if (value === undefined) {
      return token;
    }
    bytes.push(value);
  }

  return decodeTokenBytes(bytes);
}

function decodeSentencePieceToken(token: string): string | readonly number[] {
  const source = token.replaceAll("▁", " ");
  const bytes: number[] = [];
  const byteTokenPattern = /<0x([0-9A-Fa-f]{2})>/g;
  let lastIndex = 0;

  for (const match of source.matchAll(byteTokenPattern)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      bytes.push(...utf8Encoder.encode(source.slice(lastIndex, matchIndex)));
    }

    bytes.push(Number.parseInt(match[1], 16));
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < source.length) {
    bytes.push(...utf8Encoder.encode(source.slice(lastIndex)));
  }

  return decodeTokenBytes(bytes);
}

function decodeTokenBytes(bytes: ArrayLike<number>): string | readonly number[] {
  const normalized = Uint8Array.from(bytes);

  try {
    return utf8Decoder.decode(normalized);
  } catch {
    return Array.from(normalized);
  }
}

function extractTokenizerJsonRegex(data: TokenizerJsonFile, mode: LocalTokenizerJsonMode): RegExp {
  const splitRegexSources = collectSplitRegexSources(data.pre_tokenizer);
  if (splitRegexSources.length > 0) {
    return new RegExp(splitRegexSources.map((source) => `(?:${source})`).join("|"), "gu");
  }

  if (mode === "sentencepiece") {
    return / ?[^\s]+|\s+/gu;
  }

  throw new Error("Could not derive tokenizer split regex from tokenizer.json");
}

function collectSplitRegexSources(node: LocalTokenizerConfigNode): string[] {
  if (!node) return [];

  if (node.type === "Sequence") {
    const childNodes = [...(node.pretokenizers ?? []), ...(node.decoders ?? [])];
    return childNodes.flatMap((child) => collectSplitRegexSources(child));
  }

  if (node.type === "Split" && typeof node.pattern?.Regex === "string") {
    return [node.pattern.Regex];
  }

  return [];
}

function containsTokenizerNodeType(node: LocalTokenizerConfigNode, expectedType: string): boolean {
  if (!node) return false;
  if (node.type === expectedType) return true;
  if (node.type !== "Sequence") return false;

  return [...(node.pretokenizers ?? []), ...(node.decoders ?? [])].some((child) =>
    containsTokenizerNodeType(child, expectedType),
  );
}

function buildByteLevelCharToByteMap(): Map<string, number> {
  const bytes: number[] = [];
  for (let value = 33; value <= 126; value++) bytes.push(value);
  for (let value = 161; value <= 172; value++) bytes.push(value);
  for (let value = 174; value <= 255; value++) bytes.push(value);

  const codePoints = [...bytes];
  let extraCodePoint = 256;
  for (let value = 0; value < 256; value++) {
    if (bytes.includes(value)) continue;
    bytes.push(value);
    codePoints.push(extraCodePoint);
    extraCodePoint++;
  }

  return new Map(bytes.map((value, index) => [String.fromCodePoint(codePoints[index]), value]));
}
