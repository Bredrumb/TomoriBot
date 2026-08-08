import { describe, expect, it } from "bun:test";
import { createParticipantAlias } from "@/utils/text/participants/aliases";
import type {
  HydratedParticipantProfile,
  ParticipantProfileField,
  PluralKitSystemNote,
} from "@/utils/text/participants/hydration";
import { createBotKey, createDiscordUserKey, type ParticipantKey } from "@/utils/text/participants/identity";
import { renderParticipantPrompt } from "@/utils/text/participants/renderer";

function render(profiles: readonly HydratedParticipantProfile[], pluralKitSystems: PluralKitSystemNote[] = []) {
  return renderParticipantPrompt({
    profiles,
    personaTaskLines: [],
    pluralKitSystems,
    isUserImpersonation: false,
    botName: "Tomori",
    isDMChannel: false,
    channelName: "general",
    channelId: "200000000000000001",
    currentTime: "Aug 2, 2026, 02:00 PM",
    timezoneLabel: "UTC+8",
    timeOfDayPhrase: "afternoon",
  });
}

function visibleField(owner: ParticipantKey, line: string, order: number): ParticipantProfileField {
  return {
    owner,
    kind: "status",
    order,
    visibility: { visible: true, reason: "visible" },
    lines: [line],
  };
}

function humanProfile(
  id: string,
  displayName: string,
  alias: string,
  orderLines: string[],
): HydratedParticipantProfile {
  const key = createDiscordUserKey(id);
  const participantAlias = createParticipantAlias({
    owner: key,
    value: alias,
    source: "username",
    purposes: ["output_mention", "tool_target", "copied_identity"],
    exposure: "visible",
    priority: 10,
  });
  if (!participantAlias) throw new Error("Renderer fixture alias is invalid");
  return {
    key,
    reasons: new Set(["visible_author"]),
    displayName,
    aliases: [participantAlias],
    primaryAlias: alias,
    mentionable: true,
    isBot: false,
    resolvableTargetId: id,
    fields: orderLines.map((line, index) => visibleField(key, line, orderLines.length - index)),
  };
}

describe("pure participant prompt renderer", () => {
  it("renders the deterministic zero-participant shape", () => {
    const rendered = render([]);

    expect(rendered.text).toBe(`[System: The following users are having a conversation:

If Tomori wants to ping any of these users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If there is ambiguity with names, ask for clarification instead of guessing. Use mentions only when the notification matters.

Conversation context: #general (ID: 200000000000000001).
Current time: Aug 2, 2026, 02:00 PM (UTC+8), afternoon.
]`);
    expect(rendered.targetIndex.targets).toEqual([]);
    expect(rendered.conversationUsers).toEqual([]);
  });

  it("renders one participant and sorts owned fields by stable order", () => {
    const key = createBotKey("300000000000000001");
    const rendered = render([
      {
        key,
        reasons: new Set(["active_identity"]),
        displayName: "Tomori",
        aliases: [],
        primaryAlias: null,
        mentionable: false,
        isBot: true,
        fields: [visibleField(key, "- Later", 20), visibleField(key, "- Earlier", 10)],
      },
    ]);

    expect(rendered.text).toBe(`[System: The following users are having a conversation:

If Tomori wants to ping any of these users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If there is ambiguity with names, ask for clarification instead of guessing. Use mentions only when the notification matters.

Tomori (This is you!)
- Earlier
- Later

Conversation context: #general (ID: 200000000000000001).
Current time: Aug 2, 2026, 02:00 PM (UTC+8), afternoon.
]`);
    expect(rendered.targetIndex.targets[0]).toMatchObject({
      serializedKey: "bot:300000000000000001",
      inParticipantContext: true,
    });
  });

  it("renders many participants with exact ambiguity guidance from one target index", () => {
    const first = humanProfile("400000000000000001", "Alice", "shared", ["- First B", "- First A"]);
    const second = humanProfile("400000000000000002", "Bob", "SHARED", ["- Second"]);
    const rendered = render([first, second]);

    expect(rendered.text).toBe(`[System: The following users are having a conversation:

If Tomori wants to ping any of these users, prepend an "@" symbol to a unique mention handle shown below (case-insensitive). If there is ambiguity with names, ask for clarification instead of guessing. Use mentions only when the notification matters.

Alice (Mention requires clarification)
- First A
- First B

Bob (Mention requires clarification)
- Second

Conversation context: #general (ID: 200000000000000001).
Current time: Aug 2, 2026, 02:00 PM (UTC+8), afternoon.
]`);
    expect(rendered.targetIndex.targets.map((target) => target.serializedKey)).toEqual([
      "discord_user:400000000000000001",
      "discord_user:400000000000000002",
    ]);
    expect(rendered.conversationUsers.map((target) => target.targetId)).toEqual([
      "400000000000000001",
      "400000000000000002",
    ]);
  });

  it("renders system notes as their own section, after the participant entries", () => {
    const member = humanProfile("400000000000000001", "Sparrow", "sparrow", [
      '- Member of the "Lighthouse" plural system; its members share one presence here (Jordan, @jordan_h)',
    ]);
    const rendered = render(
      [member],
      [
        {
          systemUuid: "8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d",
          label: 'the "Lighthouse" plural system',
          description: "We are five. Ask before DMing.",
        },
      ],
    );

    expect(rendered.text).toContain(
      "Some of the people above are members of plural systems:\n" +
        '- The "Lighthouse" plural system: We are five. Ask before DMing.',
    );
    expect(rendered.text.indexOf("Sparrow")).toBeLessThan(rendered.text.indexOf("Some of the people above"));
  });

  it("renders no system section at all when no present system has a description", () => {
    const rendered = render([humanProfile("400000000000000001", "Sparrow", "sparrow", ["- A fact"])]);

    expect(rendered.text).not.toContain("plural system");
  });
});
