import { ContextItemTag } from "@/types/misc/context";
import type { ToolContext } from "@/types/tool/interfaces";
import { localizer } from "@/utils/text/localizer";

type ImageTagSubjectKind = "persona" | "user";

type ImageTagSubject = {
  kind: ImageTagSubjectKind;
  name: string;
};

const MAX_NOTICE_NAMES = 5;

function normalizeDisplayName(line: string): string {
  return line.replace(/\s+\(.+\)$/, "").trim();
}

function formatNoticeNames(names: string[]): string {
  const visibleNames = names.slice(0, MAX_NOTICE_NAMES);
  const remaining = names.length - visibleNames.length;
  return remaining > 0 ? `${visibleNames.join(", ")}, +${remaining}` : visibleNames.join(", ");
}

function subjectKindForName(context: ToolContext, name: string, rawLine: string): ImageTagSubjectKind {
  if (rawLine.includes("(This is you!)")) {
    return "persona";
  }

  const conversationUsers =
    context.contextItems
      ?.flatMap((item) => item.conversationUsers ?? [])
      .filter((user) => user.displayLabel === name) ?? [];
  const matchedUser = conversationUsers.find((user) => user.displayLabel === name);
  if (matchedUser?.targetId.startsWith("persona:")) {
    return "persona";
  }

  return context.tomoriState.persona_nickname === name ? "persona" : "user";
}

export function buildImageTagDetectionNoticeLines(context: ToolContext): string[] {
  const subjects = new Map<string, ImageTagSubject>();

  for (const item of context.contextItems ?? []) {
    if (item.metadataTag !== ContextItemTag.KNOWLEDGE_USERS_IN_CONVERSATION) {
      continue;
    }

    for (const part of item.parts) {
      if (part.type !== "text") {
        continue;
      }

      const sections = part.text.split(/\n{2,}/);
      for (const section of sections) {
        if (!section.includes("- Physical Appearance:")) {
          continue;
        }

        const [rawNameLine] = section.split("\n");
        const name = normalizeDisplayName(rawNameLine ?? "");
        if (!name) {
          continue;
        }

        const kind = subjectKindForName(context, name, rawNameLine ?? "");
        subjects.set(`${kind}:${name}`, { kind, name });
      }
    }
  }

  const personaNames = [...subjects.values()]
    .filter((subject) => subject.kind === "persona")
    .map((subject) => subject.name);
  const userNames = [...subjects.values()].filter((subject) => subject.kind === "user").map((subject) => subject.name);
  const lines: string[] = [];

  if (personaNames.length > 0) {
    lines.push(
      localizer(context.locale, "tools.image.notice_persona_image_tags_detected_line", {
        names: formatNoticeNames(personaNames),
      }),
    );
  }
  if (userNames.length > 0) {
    lines.push(
      localizer(context.locale, "tools.image.notice_user_image_tags_detected_line", {
        names: formatNoticeNames(userNames),
      }),
    );
  }

  return lines;
}
