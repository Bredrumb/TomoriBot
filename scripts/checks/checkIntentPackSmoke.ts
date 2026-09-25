import { readFileSync } from "node:fs";
import { isDiscordLocaleCode } from "@/constants/locales";
import { hasExplicitLongTermMemoryIntent } from "@/utils/memory/explicitLongTermMemoryIntent";
import { DELIBERATE_TOOL_PACK_KEYS, EXPLICIT_MEMORY_PACK_KEY } from "@/utils/text/localeIntentPacks";
import { getLocaleStringList, getSupportedLocales, initializeLocalizer } from "@/utils/text/localizer";
import {
  getDeliberateToolAllowedNames,
  getToolNamesForDeliberateTriggerTarget,
} from "@/utils/tools/deliberateToolMode";

/**
 * Smoke-tests one locale's intent packs against natural requests a native speaker would type.
 *
 * Pack validation at startup only proves entries are well formed; it cannot tell whether real
 * phrasing reaches a tool. A translated pack in the pilot locale passed validation yet missed 20 of
 * 42 natural requests, so every locale lane runs this with its own request file.
 *
 * Usage: bun run check-intent-packs --locale=<code> --requests=<path.json>
 *
 * The request file maps each deliberate target and `explicit_memory` to natural requests:
 * `{ "deliberate": { "image": ["...", "...", "..."], ... }, "explicit_memory": ["..."] }`
 */

const MIN_REQUESTS_PER_TARGET = 3;

interface SmokeRequests {
  deliberate?: Record<string, string[]>;
  explicit_memory?: string[];
}

interface SmokeMiss {
  target: string;
  request: string;
  detail: string;
}

function readArg(args: string[], name: string): string | undefined {
  return (
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ??
    (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined)
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const locale = readArg(args, "locale");
  const requestsPath = readArg(args, "requests");

  if (!locale || !requestsPath) {
    console.error("Usage: bun run check-intent-packs --locale=<code> --requests=<path.json>");
    process.exit(1);
  }
  if (!isDiscordLocaleCode(locale)) {
    console.error(`Invalid Discord locale code: ${locale}`);
    process.exit(1);
  }

  // Initialization runs the pack validator, so a malformed entry fails here before any request.
  await initializeLocalizer();
  if (!getSupportedLocales().includes(locale)) {
    console.error(`Locale ${locale} is not authored under src/locales/.`);
    process.exit(1);
  }

  const requests = JSON.parse(readFileSync(requestsPath, "utf8")) as SmokeRequests;
  const problems: string[] = [];
  const misses: SmokeMiss[] = [];
  let passed = 0;

  for (const [target, packKey] of Object.entries(DELIBERATE_TOOL_PACK_KEYS)) {
    if ((getLocaleStringList(locale, packKey) ?? []).length === 0) {
      problems.push(`${packKey} is empty for ${locale}`);
    }

    const targetRequests = requests.deliberate?.[target] ?? [];
    if (targetRequests.length < MIN_REQUESTS_PER_TARGET) {
      problems.push(`deliberate.${target} has ${targetRequests.length} request(s); needs ${MIN_REQUESTS_PER_TARGET}`);
    }

    const expectedTools = getToolNamesForDeliberateTriggerTarget(target);
    for (const request of targetRequests) {
      const allowed = getDeliberateToolAllowedNames(request);
      if (expectedTools.some((tool) => allowed.includes(tool))) {
        passed++;
      } else {
        misses.push({
          target,
          request,
          detail: `expected one of [${expectedTools.join(", ")}], got [${allowed.join(", ")}]`,
        });
      }
    }
  }

  if ((getLocaleStringList(locale, EXPLICIT_MEMORY_PACK_KEY) ?? []).length === 0) {
    problems.push(`${EXPLICIT_MEMORY_PACK_KEY} is empty for ${locale}`);
  }
  const memoryRequests = requests.explicit_memory ?? [];
  if (memoryRequests.length < MIN_REQUESTS_PER_TARGET) {
    problems.push(`explicit_memory has ${memoryRequests.length} request(s); needs ${MIN_REQUESTS_PER_TARGET}`);
  }
  for (const request of memoryRequests) {
    if (hasExplicitLongTermMemoryIntent(request)) {
      passed++;
    } else {
      misses.push({ target: "explicit_memory", request, detail: "hasExplicitLongTermMemoryIntent returned false" });
    }
  }

  for (const problem of problems) console.error(`❌ ${problem}`);
  for (const miss of misses) console.error(`❌ [${miss.target}] "${miss.request}": ${miss.detail}`);

  const total = passed + misses.length;
  if (problems.length > 0 || misses.length > 0) {
    console.error(
      `\nIntent pack smoke FAILED for ${locale}: ${passed}/${total} requests matched, ${problems.length} coverage problem(s).`,
    );
    process.exit(1);
  }
  console.log(`✅ Intent pack smoke PASSED for ${locale}: ${passed}/${total} requests matched.`);
}

await main();
