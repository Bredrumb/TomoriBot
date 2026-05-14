import type { StreamContext } from "@/types/stream/interfaces";
import type { TextProcessingConfig } from "@/types/stream/types";
import { replaceMentionHandles } from "@/utils/text/processors/mentionProcessor";

function extractMentionCandidates(text: string): {
  handles: Set<string>;
  idCandidates: Set<string>;
} {
  const handles = new Set<string>();
  const idCandidates = new Set<string>();

  if (!text.includes("@")) {
    return { handles, idCandidates };
  }

  let codeBlockIndex = 0;
  let inlineCodeIndex = 0;

  let processedText = text.replace(/```[\s\S]*?```/g, () => `__CODE_BLOCK_${codeBlockIndex++}__`);
  processedText = processedText.replace(/`[^`]*`/g, () => `__INLINE_CODE_${inlineCodeIndex++}__`);

  processedText.replace(/@\{([^}]+)\}/g, (_match, rawHandle) => {
    const handle = (rawHandle as string).trim();
    if (!handle) return _match;

    const pipeIndex = handle.lastIndexOf("|");
    if (pipeIndex > -1) {
      const idPart = handle.slice(pipeIndex + 1).trim();
      const namePart = handle.slice(0, pipeIndex).trim();
      if (/^\d{17,20}$/.test(idPart)) {
        idCandidates.add(idPart);
      } else if (namePart) {
        handles.add(namePart);
      }
      return _match;
    }

    if (/^\d{17,20}$/.test(handle)) {
      idCandidates.add(handle);
      return _match;
    }

    handles.add(handle);
    return _match;
  });

  processedText.replace(
    /(^|[^\p{L}\p{N}_<])@(?!(?:\{|everyone\b|here\b))([\p{L}\p{N}_][\p{L}\p{N}_-]{0,31})/giu,
    (_match, _prefix, rawHandle) => {
      const handle = (rawHandle as string).trim();
      if (handle) handles.add(handle);
      return _match;
    },
  );

  return { handles, idCandidates };
}

export async function resolveGuildMentions(
  text: string,
  context: StreamContext,
  textConfig: TextProcessingConfig,
): Promise<string> {
  if (!text.includes("@")) return text;
  if (!("guild" in context.channel)) return text;

  const guild = context.channel.guild;
  const mentionMap = textConfig.mentionMap ?? new Map<string, string[]>();
  const mentionIdSet = textConfig.mentionIdSet ?? new Set<string>();
  textConfig.mentionMap = mentionMap;
  textConfig.mentionIdSet = mentionIdSet;

  const { handles, idCandidates } = extractMentionCandidates(text);
  if (handles.size === 0 && idCandidates.size === 0) return text;

  for (const idCandidate of idCandidates) {
    if (mentionIdSet.has(idCandidate)) continue;
    const member = guild.members.cache.get(idCandidate) || (await guild.members.fetch(idCandidate).catch(() => null));
    if (member) {
      mentionIdSet.add(member.id);
    }
  }

  for (const handle of handles) {
    const normalizedHandle = handle.toLowerCase();
    const existing = mentionMap.get(normalizedHandle);
    if (existing?.length === 1) continue;
    if (existing && existing.length > 1) continue;

    const results = await guild.members.search({ query: handle, limit: 5 }).catch(() => null);
    if (!results || results.size === 0) continue;

    const exactUsernameMatches = results.filter((member) => member.user.username.toLowerCase() === normalizedHandle);
    if (exactUsernameMatches.size === 1) {
      const member = exactUsernameMatches.first();
      if (member) {
        mentionMap.set(normalizedHandle, [member.id]);
        mentionIdSet.add(member.id);
      }
      continue;
    }

    const exactGlobalMatches = results.filter((member) => member.user.globalName?.toLowerCase() === normalizedHandle);
    if (exactGlobalMatches.size === 1) {
      const member = exactGlobalMatches.first();
      if (member) {
        mentionMap.set(normalizedHandle, [member.id]);
        mentionIdSet.add(member.id);
      }
      continue;
    }

    const exactNicknameMatches = results.filter((member) => member.nickname?.toLowerCase() === normalizedHandle);
    if (exactNicknameMatches.size === 1) {
      const member = exactNicknameMatches.first();
      if (member) {
        mentionMap.set(normalizedHandle, [member.id]);
        mentionIdSet.add(member.id);
      }
    }
  }

  return replaceMentionHandles(text, mentionMap, mentionIdSet);
}
