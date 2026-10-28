import type { TomoriState } from "@/types/db/schema";
import { ContextItemTag, type StructuredContextItem } from "@/types/misc/context";
import {
  collectRenderModifierSourceNames,
  matchesRenderModifierName,
  parseLeadingGenericSpeakerLabel,
  parseLeadingRenderModifier,
  normalizeRenderModifierName,
} from "@/utils/discord/renderModifierParser";
import { collectParticipantTargetIndex } from "@/utils/text/participants/targetIndex";
import { findMarkdownCodeRanges } from "@/utils/text/processors/llmOutputProcessor";

export interface NovelAISpeakers {
  ownNames: string[];
  foreignNames: string[];
}

export const NOVELAI_SEPARATOR_STOPS = ["\n---\n", "\n***\n"];

export function resolveNovelAISpeakers(items: StructuredContextItem[], state: TomoriState): NovelAISpeakers {
  const ownNames = collectRenderModifierSourceNames(state.persona_nickname, state.trigger_words);
  const foreignNames = ["User", "Assistant", "System"];
  for (const item of items) {
    if (item.metadataTag !== ContextItemTag.DIALOGUE_HISTORY) continue;
    const label = parseLeadingGenericSpeakerLabel(item.completionText ?? "");
    const names = [item.sender?.name, label?.sourceName].filter((name): name is string => Boolean(name));
    (item.role === "model" ? ownNames : foreignNames).push(...names);
  }
  for (const target of collectParticipantTargetIndex(items).targets) {
    const names = [
      target.displayLabel,
      ...target.aliases.filter((alias) => alias.exposure === "visible").map((alias) => alias.value),
    ];
    (target.key.kind === "persona" && target.key.personaId === state.persona_id ? ownNames : foreignNames).push(
      ...names,
    );
  }
  return {
    ownNames: collectRenderModifierSourceNames("", ownNames),
    foreignNames: collectRenderModifierSourceNames("", foreignNames).filter(
      (name) => !matchesRenderModifierName(name, ownNames),
    ),
  };
}

export class NovelAISpeakerGuard {
  private text = "";
  private emitted = 0;
  private stopped = false;

  constructor(private readonly speakers: NovelAISpeakers) {}

  push(text: string): { text: string; stopped: boolean } {
    if (this.stopped) return { text: "", stopped: true };
    this.text += text;
    const codeRanges = [
      ...findMarkdownCodeRanges(this.text),
      ...Array.from(this.text.matchAll(/~~~[\s\S]*?(?:~~~|$)/gu), (match) => ({
        start: match.index,
        end: match.index + match[0].length,
      })),
    ];
    let safeEnd = this.text.length;
    for (const match of this.text.matchAll(/(^|\n)([^\n]*)/gu)) {
      const lineStart = match.index + match[1].length;
      const line = match[2];
      if (lineStart + line.length < this.emitted) continue;
      const labelStart = lineStart + line.length - line.trimStart().length;
      if (codeRanges.some((range) => labelStart >= range.start && labelStart < range.end)) continue;
      const boundary = lineStart > 0 ? lineStart - 1 : 0;
      if (lineStart + line.length < this.text.length && /^(?:---|\*\*\*)[ \t\r]*$/u.test(line.trimStart())) {
        this.stopped = true;
        safeEnd = Math.max(this.emitted, boundary);
        break;
      }
      if (lineStart + line.length === this.text.length && /^[ \t]*(?:-{1,3}|\*{1,3})[ \t\r]*$/u.test(line)) {
        safeEnd = Math.max(this.emitted, boundary);
      }
      const candidate = line
        .trimStart()
        .replace(/^[*_]{1,3}/u, "")
        .replace(/[*_]{1,3}(?=[:：]|$)/gu, "");
      const label =
        parseLeadingRenderModifier(candidate, this.speakers.foreignNames) ?? parseLeadingGenericSpeakerLabel(candidate);
      if (
        label &&
        matchesRenderModifierName(label.sourceName, this.speakers.foreignNames) &&
        !matchesRenderModifierName(label.sourceName, this.speakers.ownNames)
      ) {
        this.stopped = true;
        safeEnd = Math.max(this.emitted, boundary);
        break;
      }
      if (lineStart + line.length === this.text.length && this.isPartialForeignLabel(candidate)) {
        safeEnd = Math.max(this.emitted, boundary);
      }
    }
    const result = this.text.slice(this.emitted, safeEnd);
    this.emitted = safeEnd;
    return { text: result, stopped: this.stopped };
  }

  flush(): { text: string; stopped: boolean } {
    if (this.stopped) return { text: "", stopped: true };
    const text = this.text.slice(this.emitted);
    this.emitted = this.text.length;
    if (/^\s*(?:---|\*\*\*)\s*$/u.test(text)) {
      this.stopped = true;
      return { text: "", stopped: true };
    }
    return {
      text:
        text.startsWith("\n") && text.trim() && this.isPartialForeignLabel(text.trim().replace(/^[*_]{1,3}/u, ""))
          ? ""
          : text,
      stopped: false,
    };
  }

  private isPartialForeignLabel(line: string): boolean {
    const candidate = normalizeRenderModifierName(line);
    return this.speakers.foreignNames.some((name) => {
      const normalized = normalizeRenderModifierName(name);
      if (normalized.startsWith(candidate)) return true;
      if (!candidate.startsWith(normalized)) return false;
      const modifier = candidate.slice(normalized.length).trimStart();
      if (!/^[（(]/u.test(modifier)) return false;
      let depth = 0;
      for (let index = 0; index < modifier.length; index++) {
        const char = modifier[index];
        if (/[（(]/u.test(char)) {
          if (++depth > 2) return false;
        } else if (/[）)]/u.test(char)) {
          if (--depth === 0) return modifier.slice(index + 1).trim().length === 0;
        } else if (/[:：\r\n]/u.test(char)) return false;
      }
      return depth > 0;
    });
  }
}
