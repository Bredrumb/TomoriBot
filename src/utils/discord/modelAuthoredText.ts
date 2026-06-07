import { getCachedAllPersonas } from "@/utils/cache/tomoriStateCache";
import { escapeRegExp } from "@/utils/text/processors/regexUtils";

function normalizeSpeakerName(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildSpeakerPrefixPattern(speakerName: string): RegExp {
  const escapedName = escapeRegExp(speakerName);
  return new RegExp(`^(\\*\\*${escapedName}:\\*\\*|\\*\\*${escapedName}\\*\\*:|${escapedName}:)\\s*`, "i");
}

export async function getKnownPersonaSpeakerNames(
  guildId?: string,
  additionalNames: Array<string | null | undefined> = [],
): Promise<Set<string>> {
  const speakerNames = new Set<string>();

  for (const additionalName of additionalNames) {
    const normalizedName = normalizeSpeakerName(additionalName);
    if (normalizedName) {
      speakerNames.add(normalizedName);
    }
  }

  if (!guildId) {
    return speakerNames;
  }

  const personas = await getCachedAllPersonas(guildId);
  for (const persona of personas) {
    const normalizedName = normalizeSpeakerName(persona.persona_nickname);
    if (normalizedName) {
      speakerNames.add(normalizedName);
    }
  }

  return speakerNames;
}

export function stripLeadingKnownSpeakerPrefixes(text: string, speakerNames: Iterable<string>): string {
  let sanitizedText = text.trim();
  if (!sanitizedText) {
    return "";
  }

  const uniqueSpeakerNames = [
    ...new Set([...speakerNames].map((speakerName) => speakerName.trim()).filter(Boolean)),
  ].sort((left, right) => right.length - left.length);

  let removedPrefix = false;
  do {
    removedPrefix = false;

    for (const speakerName of uniqueSpeakerNames) {
      const nextText = sanitizedText.replace(buildSpeakerPrefixPattern(speakerName), "");
      if (nextText !== sanitizedText) {
        sanitizedText = nextText.trimStart();
        removedPrefix = true;
        break;
      }
    }
  } while (removedPrefix && sanitizedText.length > 0);

  return sanitizedText.trim();
}
