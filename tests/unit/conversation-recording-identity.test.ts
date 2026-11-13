import { describe, expect, it } from "bun:test";
import {
  prepareRecordingBody,
  recordingAttachments,
  recordingIdentityKey,
} from "@/modules/conversation-recording/runtime/identity";
import { buildDiscordUserAliases, buildPersonaAliases } from "@/utils/text/participants/aliases";
import { createDiscordUserKey, createPersonaKey, type ParticipantAlias } from "@/utils/text/participants/identity";
import { resolveUniqueParticipantAliasReferences } from "@/utils/text/participants/referenceDiscovery";
import { createUserRow } from "../helpers/fixtures";

function aliases(id: string, name: string): ParticipantAlias[] {
  return buildDiscordUserAliases({
    owner: createDiscordUserKey(id),
    userRow: createUserRow({ user_disc_id: id, user_nickname: name }),
    identity: { username: name },
    exposeSavedNickname: false,
  });
}
function replace(content: string, catalog: ParticipantAlias[]): string {
  const body = prepareRecordingBody(content, catalog);
  const tokens = new Map(
    body.identities.map((identity) => [
      recordingIdentityKey(identity),
      identity.kind === "participant"
        ? identity.sourceId === "1"
          ? "SELF"
          : `PARTICIPANT_${identity.sourceId.replace("persona:", "")}`
        : `${identity.kind.toUpperCase()}_1`,
    ]),
  );
  return body.render(tokens);
}

describe("recording identity replacement", () => {
  it("replaces repeated original-text spans with Unicode boundaries and longest overlaps", () => {
    const catalog = [
      ...aliases("1", "Mirri"),
      ...aliases("2", "Mirri Vale"),
      ...aliases("3", "Étoile"),
      ...aliases("4", "山田"),
    ];
    const content = "mIRRI mirri VALE @ÉTOILE. 山田、山田さん _Mirri Mirriness x@Mirri Mirri\nMirri";
    const spans = resolveUniqueParticipantAliasReferences(content, catalog, "identity_replacement").spans;
    expect(spans.map((span) => content.slice(span.start, span.end))).toContain("@ÉTOILE");
    expect(replace(content, catalog)).toBe(
      "[SELF] [PARTICIPANT_2] [PARTICIPANT_3]. [PARTICIPANT_4]、山田さん _Mirri Mirriness x@Mirri [SELF]\n[SELF]",
    );
  });

  it("skips shared names across users and personas and leaves arbitrary activation words", () => {
    const persona = buildPersonaAliases({
      owner: createPersonaKey(7),
      nickname: "Juno",
      triggerWords: ["wake up", "Mirri"],
    }).aliases;
    const catalog = [...aliases("1", "Mirri"), ...aliases("2", "shared"), ...aliases("3", "SHARED"), ...persona];
    expect(replace("Mirri shared wake up Juno", catalog)).toBe("[SELF] shared wake up [PARTICIPANT_7]");
    expect(resolveUniqueParticipantAliasReferences("Juno wake up", persona).referencedOwners).toEqual([]);
    expect(replace("Juno", [...catalog, ...aliases("8", "Juno")])).toBe("Juno");
  });

  it("normalizes structured markup without reprocessing tokens, URLs or emoji names", () => {
    const catalog = [...aliases("1", "Mirri"), ...aliases("2", "SELF"), ...aliases("3", "PARTICIPANT_1")];
    const content =
      "Mirri <@1> <@!1> <@&22> <#33> <:Mirri:123456789012345678> <a:Mirri:123456789012345679> 😀 SELF PARTICIPANT_1 :Mirri: https://example.org/Mirri?q=Mirri [Mirri](https://example.org/Mirri)";
    const output = replace(content, catalog);
    expect(output).toContain("[SELF] [SELF] [SELF] [ROLE_1] [CHANNEL_1] :Mirri: :Mirri: 😀 SELF PARTICIPANT_1 :Mirri:");
    expect(output).toContain("https://example.org/Mirri?q=Mirri [[SELF]](https://example.org/Mirri)");
    expect(output).not.toMatch(/12345678901234567/u);
    const url = "https://example.org/Mirri_(Mirri)?q=Mirri";
    expect(replace(`Mirri ${url} [Mirri](${url})`, catalog)).toBe(`[SELF] ${url} [[SELF]](${url})`);
  });

  it("removes Discord message identities in plain, autolink and Markdown jump links", () => {
    for (const domain of ["discord.com", "canary.discord.com", "ptb.discordapp.com", "www.discord.com"]) {
      const url = `https://${domain}/channels/111111111111111111/222222222222222222/333333333333333333?x=1#fragment`;
      const output = replace(`${url} <${url}> [Mirri](${url})`, aliases("1", "Mirri"));
      expect(output.match(/\[message link\]/gu)).toHaveLength(3);
      expect(output).not.toMatch(/111111|222222|333333/u);
    }
  });

  it("normalizes wrapped destinations and closing punctuation while preserving external links", () => {
    const url = "https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333";
    expect(replace(`[link](<${url}>) [link](${url} "title") (${url}) [${url}] \`${url}\` "${url}"`, [])).toBe(
      '[link](<[message link]>) [link]([message link] "title") ([message link]) [[message link]] `[message link]` "[message link]"',
    );
    for (const [before, after] of [
      [`[link]( ${url} )`, "[link]( [message link] )"],
      [`[link]( <${url}> "title")`, '[link]( <[message link]> "title")'],
      [`[link](\n${url}\n)`, "[link](\n[message link]\n)"],
    ]) {
      expect(replace(before, [])).toBe(after);
    }
    for (const delimiter of ["**", "*", "__", "_", "~~", "||"]) {
      expect(replace(`${delimiter}${url}${delimiter}`, [])).toBe(`${delimiter}[message link]${delimiter}`);
    }
    expect(replace(`{${url}}`, [])).toBe("{[message link]}");
    const external = "https://example.org/a_(b)";
    expect(replace(`[link](<${external}> "title") (${external}) [SELF]`, [])).toBe(
      `[link](<${external}> "title") (${external}) [SELF]`,
    );
    expect(replace(`**${external}** ||${external}|| {${external}}`, [])).toBe(
      `**${external}** ||${external}|| {${external}}`,
    );
    expect(replace(`[link]( <${external}> "title")`, [])).toBe(`[link]( <${external}> "title")`);
  });

  it("uses the same canonical persona token for a real mention and its name", () => {
    const catalog = buildPersonaAliases({ owner: createPersonaKey(7), nickname: "Juno" }).aliases;
    const body = prepareRecordingBody("Juno <@99>", catalog, new Map([["99", "persona:7"]]));
    expect(new Set(body.identities.map(recordingIdentityKey)).size).toBe(1);
    expect(body.render(new Map([["participant:persona:7", "PARTICIPANT_4"]]))).toBe("[PARTICIPANT_4] [PARTICIPANT_4]");
  });

  it("replaces exact common-word names without claiming semantic disambiguation", () => {
    expect(replace("Hope is here; hopeless stays", aliases("1", "Hope"))).toBe("[SELF] is here; hopeless stays");
    const output = replace("https://discord.com/channels/111/222/333.", []);
    expect(output).not.toMatch(/111|222|333/u);
  });

  it("keeps user-authored lookalikes literal and protects bracketed placeholders against double wrapping", () => {
    const catalog = [
      ...aliases("1", "Mirri"),
      ...aliases("2", "SELF"),
      ...aliases("3", "PARTICIPANT_1"),
      ...aliases("4", "CHANNEL_1"),
      ...aliases("5", "ROLE_1"),
    ];
    const literal = "[SELF] [PARTICIPANT_1] [CHANNEL_1] [ROLE_1] SELF {SELF} {{SELF}} [[SELF]]";
    const lookalikes = prepareRecordingBody(literal, catalog);
    expect(lookalikes.identities).toHaveLength(0);
    expect(lookalikes.render(new Map())).toBe(literal);
    const body = prepareRecordingBody("Mirri <@1> <#22> <@&33>", catalog);
    const tokens = new Map([
      ["participant:1", "SELF"],
      ["channel:22", "CHANNEL_1"],
      ["role:33", "ROLE_1"],
    ]);
    const rendered = body.render(tokens);
    expect(rendered).toBe("[SELF] [SELF] [CHANNEL_1] [ROLE_1]");
    expect(prepareRecordingBody(rendered, catalog).render(new Map())).toBe(rendered);
    expect(tokens.get("participant:1")).toBe("SELF");
  });

  it("counts metadata types and unknown files without retaining media details", () => {
    const counts = recordingAttachments([
      { contentType: "image/png" },
      { contentType: "IMAGE/jpeg" },
      { contentType: "video/mp4" },
      { contentType: "audio/ogg" },
      { contentType: "application/pdf" },
      { contentType: null },
    ]);
    expect(counts).toEqual({ image: 2, video: 1, audio: 1, file: 2 });
    expect(recordingAttachments([])).toEqual({ image: 0, video: 0, audio: 0, file: 0 });
  });
});
