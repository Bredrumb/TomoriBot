import type { Classification, ConsumerRole, DeclarationSite, ScanLanguage } from "./types";

export const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*[A-Z0-9]$/;

export function isEnvName(value: string): boolean {
  return ENV_NAME_PATTERN.test(value) && /[A-Z]{2}/.test(value);
}

const PLATFORM_NAMES = new Set([
  "APPDATA",
  "BASH_REMATCH",
  "BASH_SOURCE",
  "CI",
  "COMSPEC",
  "EUID",
  "FORCE_COLOR",
  "FUNCNAME",
  "HOME",
  "HOSTNAME",
  "IFS",
  "LANG",
  "LC_ALL",
  "LINENO",
  "LOCALAPPDATA",
  "NO_COLOR",
  "OLDPWD",
  "OSTYPE",
  "PATH",
  "PIPESTATUS",
  "PWD",
  "RANDOM",
  "SECONDS",
  "SHELL",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "UID",
  "USER",
  "USERNAME",
  "USERPROFILE",
  "VIRTUAL_ENV",
]);

const PLATFORM_PREFIXES = ["GITHUB_", "RUNNER_", "BUN_INSTALL", "npm_"];

export function isPlatformName(name: string): boolean {
  return PLATFORM_NAMES.has(name) || PLATFORM_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function segments(...phrases: string[]): RegExp {
  return new RegExp(`(^|_)(${phrases.join("|")})(_|$)`);
}

// Secret tokens are anchored to suffixes or SECRET_/PASSWORD_ prefixes because mid-name words such as CHARS_PER_TOKEN
// denote settings rather than secrets.
const SECRET_NAME_PATTERN = new RegExp(
  [
    /(^|_)(TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|CREDENTIALS?|COOKIES(_JSON)?|KEY|KEY_ID|DSN)$/.source,
    /(^|_)(SECRET|PASSWORD)_/.source,
  ].join("|"),
);
const NOT_SECRET_PATTERN = /_PER_TOKEN$/;

export function isSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name) && !NOT_SECRET_PATTERN.test(name);
}

export const REDACTED = "<redacted>";

export function roleForPath(path: string, language: ScanLanguage): ConsumerRole {
  const normalized = path.replaceAll("\\", "/");
  if (/(^|\/)(\.deprecated|archived|\[archive\])\//.test(normalized)) {
    return "inactive";
  }
  if (
    /(^|\/)tests?\//.test(normalized) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized) ||
    /(^|\/)test_[^/]*\.py$/.test(normalized) ||
    /_test\.py$/.test(normalized)
  ) {
    return "test";
  }
  if (["shell", "powershell", "dockerfile", "compose", "terraform"].includes(language)) {
    return "infra";
  }
  if (language === "workflow" || normalized.startsWith("scripts/") || normalized.startsWith(".github/")) {
    return "tooling";
  }
  if (normalized.startsWith("apps/")) {
    return "tooling";
  }
  return "runtime";
}

// Any unregistered unresolved dynamic read downgrades every dead verdict to undecided, so safe external dynamic reads
// must be listed here.
export const REGISTERED_DYNAMIC_READS: { file: string; reason: string }[] = [];

// This list applies only when neither checkout nor release ref has deploy/ or terraform/, because the doctor reads
// them directly and flags drift when available.
export const RELEASE_ONLY_CONSUMERS: Record<string, string> = {
  CONTAINER_MEMORY_LIMIT_MB: "set by deploy/azure/docker-compose.yml on release",
  SEARXNG_BLOCKING_THREADS: "interpolated by deploy/azure/docker-compose.yml on release",
  SEARXNG_MEMORY_LIMIT_MB: "interpolated by deploy/azure/docker-compose.yml on release",
  SEARXNG_PIDS_LIMIT: "interpolated by deploy/azure/docker-compose.yml on release",
  SEARXNG_RSS_SAMPLE_INTERVAL: "interpolated by deploy/azure/docker-compose.yml on release",
  SEARXNG_WORKER_MAX_RSS_MB: "interpolated by deploy/azure/docker-compose.yml on release",
  TOMORIBOT_HEAP_SNAPSHOT_DIR: "interpolated by deploy/azure/docker-compose.yml on release",
  TOMORIBOT_MEMORY_LIMIT_MB: "interpolated by deploy/azure/docker-compose.yml on release",
  TOMORIBOT_MEMORY_SWAP_LIMIT_MB: "interpolated by deploy/azure/docker-compose.yml on release",
  TOMORIBOT_PIDS_LIMIT: "interpolated by deploy/azure/docker-compose.yml on release",
};

export const LIBRARY_CONSUMERS: Record<string, string> = {
  AWS_ACCESS_KEY_ID: "read by the AWS SDK default credential chain",
  AWS_SECRET_ACCESS_KEY: "read by the AWS SDK default credential chain",
  GOOGLE_APPLICATION_CREDENTIALS: "read by Google Application Default Credentials",
};

export const KNOWN_NOTES: Record<string, string> = {
  GRAFANA_PASSWORD: "only docker/compose.monitor.yaml interpolates it, for the Grafana container",
  SEARXNG_SECRET: "Compose and the SearXNG entrypoint pass it to the SearXNG container; the bot never reads it",
};

const ALGORITHMIC_PATTERN = segments(
  "PROBABILITY",
  "LOOKBACK",
  "THRESHOLD",
  "PREFIX_LENGTH",
  "DEPTH",
  "TURNS",
  "RATIO",
  "WEIGHT",
  "MULTIPLIER",
  "FACTOR",
  "JITTER",
  "TOP_P",
  "TEMPERATURE",
  "REPETITION_PENALTY",
  "CFG_VALUE",
  "TIMESTEPS",
);
const DEPLOYMENT_PATTERN = new RegExp(
  [
    /(^|_)(URL|URI|HOST|PORT|ENDPOINT|BUCKET|REGION|DIR|PATH|FILE|DEVICE|IMAGE|MODEL_ID|PROJECT_ID)$/.source,
    /^(POSTGRES|DATABASE|PG)_/.source,
    segments("MEMORY_LIMIT", "SWAP_LIMIT", "PIDS_LIMIT", "CONCURRENCY", "WORKERS", "THREADS", "POOL", "ACCOUNT").source,
    /^(RUN_ENV|NODE_ENV|PORT)$/.source,
  ].join("|"),
);
const FLAG_PATTERN = /(_ENABLED$|^ENABLE_|^DISABLE_|_DISABLED$)/;

const TIER_CANDIDATES: Record<
  number,
  { candidate: Classification["candidate"]; confidence: Classification["confidence"]; reason: string }
> = {
  1: { candidate: "runtime-preference", confidence: "low", reason: "Tier 1 everyday behavior knob" },
  2: { candidate: "deployment", confidence: "medium", reason: "Tier 2 optional integration" },
  3: { candidate: "deployment", confidence: "medium", reason: "Tier 3 local server or local service" },
  4: { candidate: "runtime-preference", confidence: "low", reason: "Tier 4 provider or model tuning" },
  5: { candidate: "runtime-preference", confidence: "low", reason: "Tier 5 limit or quota" },
  6: { candidate: "deployment", confidence: "low", reason: "Tier 6 diagnostics or development tooling" },
  7: { candidate: "deployment", confidence: "medium", reason: "Tier 7 production hosting" },
};

// These rules run after the tier check so documented variables keep the classification chosen by their
// .env.optional.example tier.
const UNTIERED_NAME_RULES: {
  pattern: RegExp;
  candidate: Classification["candidate"];
  confidence: Classification["confidence"];
  reason: string;
}[] = [
  {
    pattern: segments(
      "PRECISION",
      "DTYPE",
      "FP16",
      "COMPILE",
      "FLASH_ATTENTION",
      "LOAD",
      "DEVICE_MAP",
      "OPTIMIZE",
      "HALF",
      "BATCH_SIZE",
      "COMPUTE_TYPE",
    ),
    candidate: "deployment",
    confidence: "medium",
    reason: "name describes a hardware or accelerator choice",
  },
  {
    pattern: /_ID$/,
    candidate: "deployment",
    confidence: "medium",
    reason: "name holds an installation-specific identifier",
  },
  {
    pattern: /^(TOMORI_)?(TESTS?_|VL_)|_TEST_|JUNIT/,
    candidate: "deployment",
    confidence: "low",
    reason: "name belongs to test or gate tooling",
  },
  {
    pattern: segments("STEPS", "CFG", "CFG_SCALE", "DENOISE", "SAMPLER", "SPEED", "SWAY", "SCHEDULE", "FPS", "BADCASE"),
    candidate: "algorithmic-invariant",
    confidence: "low",
    reason: "name describes a generation or sampling parameter",
  },
  {
    pattern: segments(
      "TIMEOUT",
      "TTL",
      "MAX",
      "LIMIT",
      "RESOLUTION",
      "CHARS",
      "LENGTH",
      "RESULTS",
      "SIZE_MB",
      "DURATION",
    ),
    candidate: "runtime-preference",
    confidence: "low",
    reason: "name describes a limit, timeout, or cache lifetime",
  },
];

export function classifyConsumed(
  name: string,
  liveLanguages: Set<ScanLanguage>,
  optionalDeclaration: DeclarationSite | undefined,
): Classification {
  if (isSecretName(name)) {
    return { candidate: "deployment", confidence: "high", reasons: ["name marks a credential"] };
  }
  const infraOnly =
    liveLanguages.size > 0 &&
    [...liveLanguages].every((language) =>
      ["shell", "powershell", "dockerfile", "compose", "terraform"].includes(language),
    );
  if (infraOnly) {
    return {
      candidate: "deployment",
      confidence: "high",
      reasons: ["only deployment, container, or installer files read it"],
    };
  }
  if (DEPLOYMENT_PATTERN.test(name)) {
    return {
      candidate: "deployment",
      confidence: "medium",
      reasons: ["name describes a host, network, path, or resource"],
    };
  }
  if (ALGORITHMIC_PATTERN.test(name)) {
    return {
      candidate: "algorithmic-invariant",
      confidence: "medium",
      reasons: ["name describes internal tuning (probability, lookback, threshold, depth, or sampling)"],
    };
  }
  if (FLAG_PATTERN.test(name)) {
    return { candidate: "runtime-preference", confidence: "medium", reasons: ["boolean feature switch"] };
  }
  const tierNumber = optionalDeclaration?.tier ? Number(/TIER (\d+)/.exec(optionalDeclaration.tier)?.[1]) : Number.NaN;
  const tierRule = TIER_CANDIDATES[tierNumber];
  if (tierRule) {
    return { candidate: tierRule.candidate, confidence: tierRule.confidence, reasons: [tierRule.reason] };
  }
  const nameRule = UNTIERED_NAME_RULES.find((rule) => rule.pattern.test(name));
  if (nameRule) {
    return { candidate: nameRule.candidate, confidence: nameRule.confidence, reasons: [nameRule.reason] };
  }
  return { candidate: "undecided", confidence: "low", reasons: ["no classification rule matched its name or tier"] };
}
