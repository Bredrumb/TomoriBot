import type { Attachment } from "discord.js";
import type { RecordingAttachments, RecordingIdentity } from "@/modules/conversation-recording/db/types";
import { resolveUniqueParticipantAliasReferences } from "@/utils/text/participants/referenceDiscovery";
import { findMarkdownLink } from "@/utils/text/processors/chunkProcessor";
import {
  serializeParticipantKey,
  type ParticipantAlias,
  type ParticipantKey,
} from "@/utils/text/participants/identity";

const PROTECTED_MARKUP =
  /https?:\/\/[^\s<>]+|<a?:[A-Za-z0-9_~]+:\d+>|<@!?\d+>|<@&\d+>|<#\d+>|\[(?:SELF|PARTICIPANT_[1-9]\d*|CHANNEL_[1-9]\d*|ROLE_[1-9]\d*)\]|\b(?:SELF|PARTICIPANT_[1-9]\d*|CHANNEL_[1-9]\d*|ROLE_[1-9]\d*)\b|:[A-Za-z0-9_~]+:/giu;
const MESSAGE_LINK =
  /^https?:\/\/(?:(?:canary|ptb|www)\.)?discord(?:app)?\.com\/channels\/(?:\d+|@me)\/\d+\/\d+(?=$|[/?#.,!?;:])/iu;

export function recordingParticipantSource(key: ParticipantKey): string {
  return key.kind === "discord_user" || key.kind === "bot" ? key.discordId : serializeParticipantKey(key);
}

export function recordingAttachments(attachments: Iterable<Pick<Attachment, "contentType">>): RecordingAttachments {
  const counts: RecordingAttachments = { image: 0, video: 0, audio: 0, file: 0 };
  for (const attachment of attachments) {
    const type = attachment.contentType?.split("/")[0]?.toLowerCase();
    counts[type === "image" || type === "video" || type === "audio" ? type : "file"]++;
  }
  return counts;
}

type BodyPart = { text: string } | { identity: RecordingIdentity };

export function prepareRecordingBody(
  content: string,
  aliases: readonly ParticipantAlias[],
  mentionSources: ReadonlyMap<string, string> = new Map(),
): {
  identities: RecordingIdentity[];
  render: (tokens: ReadonlyMap<string, string>) => string;
} {
  const parts: BodyPart[] = [];
  const destinations = [...content.matchAll(/\[/gu)].flatMap((opener) => {
    const link = findMarkdownLink(content, opener.index);
    if (!link || link.start !== opener.index) return [];
    const start = content.indexOf("](", link.start) + 2;
    const end = link.end - 1;
    const value = content.slice(start, end);
    return [{ start, end, part: { text: MESSAGE_LINK.test(value) ? "[message link]" : value } as BodyPart }];
  });
  const protectedSpans = [...content.matchAll(PROTECTED_MARKUP)]
    .filter(
      (match) => !destinations.some((destination) => match.index >= destination.start && match.index < destination.end),
    )
    .map((match) => {
      const value = match[0];
      const mention = /^<(@!?|@&|#)(\d+)>$/u.exec(value);
      const emoji = /^<a?:([A-Za-z0-9_~]+):\d+>$/u.exec(value);
      let part: BodyPart;
      if (mention) {
        const kind = mention[1] === "#" ? "channel" : mention[1] === "@&" ? "role" : "participant";
        part = {
          identity: {
            kind,
            sourceId: kind === "participant" ? (mentionSources.get(mention[2]) ?? mention[2]) : mention[2],
          },
        };
      } else {
        part = { text: emoji ? `:${emoji[1]}:` : MESSAGE_LINK.test(value) ? "[message link]" : value };
      }
      return { start: match.index, end: match.index + value.length, part };
    })
    .concat(destinations);
  // Exact unique names can also be ordinary words; replacement cannot disambiguate their meaning.
  const { spans } = resolveUniqueParticipantAliasReferences(content, aliases, "identity_replacement");
  const replacements = [
    ...protectedSpans,
    ...spans
      .filter(
        (span) =>
          !protectedSpans.some((protectedSpan) => span.start < protectedSpan.end && span.end > protectedSpan.start),
      )
      .map((span) => ({
        ...span,
        part: { identity: { kind: "participant" as const, sourceId: recordingParticipantSource(span.owner) } },
      })),
  ].sort((a, b) => a.start - b.start || b.end - a.end);
  let cursor = 0;
  for (const replacement of replacements) {
    if (replacement.start < cursor) continue;
    parts.push({ text: content.slice(cursor, replacement.start) }, replacement.part);
    cursor = replacement.end;
  }
  parts.push({ text: content.slice(cursor) });
  const identities = parts.flatMap((part) => ("identity" in part ? [part.identity] : []));
  return {
    identities,
    render: (tokens) =>
      parts
        .map((part) => {
          if ("text" in part) return part.text;
          const token = tokens.get(recordingIdentityKey(part.identity));
          if (!token) throw new Error("Recording body identity token is missing");
          return `[${token}]`;
        })
        .join(""),
  };
}

export function recordingIdentityKey(identity: RecordingIdentity): string {
  return `${identity.kind}:${identity.sourceId}`;
}
