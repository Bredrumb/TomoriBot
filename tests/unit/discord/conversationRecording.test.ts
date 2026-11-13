import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { MessageFlags, SlashCommandSubcommandBuilder, type ChatInputCommandInteraction, type Client } from "discord.js";
import { configureSubcommand } from "@/commands/record/start";
import { ConversationRecordingRepository } from "@/modules/conversation-recording/db/repositories";
import {
  RECORDING_QUOTA_BYTES,
  type RecordingSession,
  type RecordingSummary,
} from "@/modules/conversation-recording/db/types";
import { recordingRouteId, type RecordingAction } from "@/modules/conversation-recording/discord/catalog";
import {
  buildRecordingModal,
  buildRecordingPanel,
  recordingConsent,
} from "@/modules/conversation-recording/discord/panel";
import { createRecordingController } from "@/modules/conversation-recording/discord/routes";
import { parseInteractionRoute, type GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { validateRawModalLimits } from "@/utils/discord/ui/componentsV2Limits";
import { initializeLocalizer } from "@/utils/text/localizer";
import { log } from "@/utils/misc/logger";
import { createUserRow } from "../../helpers/fixtures";
import { expectForEveryLocale, localizedProse } from "../../helpers/localeCases";
import { collectTextDisplays, expectSafePanelPayload } from "../../helpers/panelLimits";
import {
  createRouteInteraction,
  type RouteInteraction,
  type RouteInteractionOptions,
} from "../../helpers/routeInteraction";

beforeAll(() => initializeLocalizer());
const user = createUserRow({ user_disc_id: "100000000000000001" });
const guildId = "200000000000000001";
const actor = { id: user.user_disc_id, username: "Mirri", displayName: "Mirri", globalName: "Mirri" };
const scope = { ownerUserId: user.user_id as number, serverId: 2 };
const nonce = "a".repeat(32);
const session: RecordingSession = {
  session_id: randomUUID(),
  revision: 1,
  context: "own",
  duration: "24h",
  started_at: new Date(),
  ends_at: new Date(Date.now() + 86_400_000),
  stopped_at: null,
};
function summary(active: RecordingSession | null): RecordingSummary {
  return {
    session: active,
    serverBytes: 1024,
    ownerBytes: 4096,
    quotaBytes: RECORDING_QUOTA_BYTES,
    excerpts: 2,
    retentionDays: null,
    nextExpiry: null,
    evictedExcerpts: 0,
    evictedBytes: 0,
    lastEvictedAt: null,
  };
}
function actionId(payload: unknown, action: RecordingAction): string {
  if (Array.isArray(payload)) {
    for (const child of payload) {
      const found = actionId(child, action);
      if (found) return found;
    }
  } else if (payload && typeof payload === "object") {
    const object = payload as Record<string, unknown>;
    for (const field of ["customId", "custom_id"]) {
      const id = object[field];
      if (typeof id === "string" && id.split(":")[2] === action) return id;
    }
    for (const child of Object.values(object)) {
      const found = actionId(child, action);
      if (found) return found;
    }
  }
  return "";
}
function text(interaction: RouteInteraction): string {
  return collectTextDisplays([...interaction.edits, ...interaction.replies]).join("\n");
}
function harness(initial: RecordingSession | null = null) {
  const repo = new ConversationRecordingRepository();
  let active = initial;
  let now = Date.now();
  const current = spyOn(repo, "getActive").mockImplementation(async () => active);
  const totals = spyOn(repo, "summary").mockImplementation(async () => summary(active));
  spyOn(repo, "getStartToken").mockResolvedValue(null);
  const eligible = spyOn(repo, "eligibleUsers").mockResolvedValue(new Set([user.user_disc_id]));
  const start = spyOn(repo, "start").mockImplementation(async () => {
    active = { ...session };
    return { session: active, created: true };
  });
  const stop = spyOn(repo, "stop").mockImplementation(async () => {
    active = null;
    return true;
  });
  const settings = spyOn(repo, "updateSettings").mockResolvedValue(session);
  const remove = spyOn(repo, "deleteRange").mockResolvedValue(2);
  const read = spyOn(repo, "readRange").mockResolvedValue({
    excerpts: [],
    nextCursor: null,
    bytes: 0,
    oversized: false,
  });
  const selects: Record<string, string[] | undefined> = {
    context: ["surrounding"],
    duration: ["7d"],
    format: ["json"],
    range: ["7d"],
  };
  const showModal = mock(async (_interaction: unknown, _payload: ReturnType<typeof buildRecordingModal>) => {});
  const buildController = () =>
    createRecordingController({
      repository: repo,
      resolveScope: async () => scope,
      showModal,
      takeSelectValues: (_id, field) => selects[field],
      recordAction: async () => {},
      now: () => now,
    });
  let controller = buildController();
  async function command(
    action: "start" | "stop" | "data" = "start",
    input = { context: "surrounding", duration: "7d" },
    commandGuildId: string | null = guildId,
  ) {
    const interaction = createRouteInteraction({
      guildId: commandGuildId,
      overrides: { user: actor },
    });
    await controller.executeCommand(
      interaction as unknown as ChatInputCommandInteraction,
      user,
      "en-US",
      action,
      input,
    );
    return interaction;
  }
  async function press(customId: string, options: Omit<RouteInteractionOptions, "customId"> = {}) {
    expect(customId.length).toBeGreaterThan(0);
    const parsed = parseInteractionRoute(customId);
    if (!parsed) throw new Error("Invalid fixture route");
    const interaction = createRouteInteraction({
      guildId,
      customId,
      ...options,
      overrides: { user: actor, ...options.overrides },
    });
    await controller.route.execute({} as Client, interaction as unknown as GlobalRoutableInteraction, parsed);
    return interaction;
  }
  return {
    command,
    press,
    repo,
    current,
    totals,
    eligible,
    start,
    stop,
    settings,
    remove,
    read,
    showModal,
    selects,
    restart: () => {
      controller = buildController();
    },
    setNow: (value: number) => {
      now = value;
    },
    modalId: () => showModal.mock.calls.at(-1)?.[1].custom_id ?? "",
  };
}

describe("conversation recording controls", () => {
  it("requires both slash choices and makes no recording before consent", async () => {
    const metadata = configureSubcommand(new SlashCommandSubcommandBuilder()).toJSON();
    expect(metadata.options?.every((option) => option.required)).toBe(true);
    expect(metadata.options?.map((option) => option.name)).toContain("context");
    const f = harness();
    const confirmation = await f.command();
    expect(confirmation.calls[0]?.method).toBe("deferReply");
    expect(f.start).not.toHaveBeenCalled();
    expect(text(confirmation)).toMatch(localizedProse("en-US", "commands.record.consent"));
    const summaryReads = f.totals.mock.calls.length;
    const cancelled = await f.press(actionId(confirmation.edits, "cancel"));
    expect(cancelled.calls[0]?.method).toBe("deferUpdate");
    expect(text(cancelled)).toMatch(localizedProse("en-US", "commands.record.cancelled"));
    expect(text(cancelled)).not.toMatch(localizedProse("en-US", "commands.record.concept"));
    expect(actionId(cancelled.edits, "refresh")).toBe("");
    expect(actionId(cancelled.edits, "start")).toBe("");
    expect(f.totals).toHaveBeenCalledTimes(summaryReads);
    const stale = await f.press(actionId(confirmation.edits, "start"));
    expect(f.start).not.toHaveBeenCalled();
    expect(text(stale)).toMatch(localizedProse("en-US", "commands.record.stale"));
    const invalid = await f.command("start", { context: "", duration: "7d" });
    expect(text(invalid)).toMatch(localizedProse("en-US", "commands.record.invalid_settings"));
    expect(actionId(invalid.edits, "start")).toBe("");
  });

  it("consumes activation once before asynchronous work and rejects forged or expired controls", async () => {
    const f = harness();
    const confirmation = await f.command();
    const startId = actionId(confirmation.edits, "start");
    await Promise.all([f.press(startId), f.press(startId)]);
    expect(f.start).toHaveBeenCalledTimes(1);
    expect(f.start).toHaveBeenCalledWith(scope, { context: "surrounding", duration: "7d" }, null);
    await f.press(startId.replace(":start:", ":delete-confirm:"));
    await f.press(recordingRouteId("start", "b".repeat(32)));
    expect(f.remove).not.toHaveBeenCalled();
    const expiringFixture = harness();
    const expiring = await expiringFixture.command();
    expiringFixture.setNow(Date.now() + 16 * 60_000);
    const expired = await expiringFixture.press(actionId(expiring.edits, "start"));
    expect(text(expired)).toMatch(localizedProse("en-US", "commands.record.stale"));
    expect(f.stop).not.toHaveBeenCalled();
  });

  it("reconstructs every data-panel action after restart and timeout while keeping confirmations scoped", async () => {
    for (const action of ["refresh", "settings", "stop", "export", "delete-range"] as const) {
      const f = harness(session);
      const data = await f.command("data");
      const id = actionId(data.edits, action);
      const consentFixture = harness();
      const consent = await consentFixture.command();
      consentFixture.restart();
      const stale = await consentFixture.press(actionId(consent.edits, "start"));
      expect(text(stale)).toMatch(localizedProse("en-US", "commands.record.stale"));
      expect(consentFixture.start).not.toHaveBeenCalled();
      f.restart();
      f.setNow(Date.now() + 16 * 60_000);
      const clicked = await f.press(id);
      expect(text(clicked)).not.toMatch(localizedProse("en-US", "commands.record.stale"));
      if (["settings", "export", "delete-range"].includes(action)) {
        expect(f.showModal).toHaveBeenCalledTimes(1);
        expect(clicked.calls.some((call) => call.method.startsWith("defer"))).toBe(false);
      } else {
        expect(clicked.calls[0]?.method).toBe("deferUpdate");
        if (action === "stop")
          expect(f.stop).toHaveBeenCalledWith(scope, { sessionId: session.session_id, revision: session.revision });
        if (action === "refresh") expect(f.totals).toHaveBeenCalledTimes(2);
      }
    }
  });

  it("opens existing settings without replacing the session and keeps stop distinct from deletion", async () => {
    const f = harness(session);
    const existing = await f.command();
    expect(actionId(existing.edits, "start")).toBe("");
    expect(text(existing)).toMatch(localizedProse("en-US", "commands.record.already_active"));
    expect(f.start).not.toHaveBeenCalled();
    const opened = await f.press(actionId(existing.edits, "settings"));
    expect(opened.calls.some((call) => call.method.startsWith("defer"))).toBe(false);
    expect(f.showModal).toHaveBeenCalled();
    await f.press(f.modalId(), { kind: "modal" });
    expect(f.settings).toHaveBeenCalledWith(
      scope,
      { sessionId: session.session_id, revision: session.revision },
      { context: "surrounding", duration: "7d" },
    );
    await f.command("stop");
    expect(f.stop).toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  });

  it("reports a concurrent stop revision change without claiming collection stopped", async () => {
    const f = harness(session);
    f.stop.mockResolvedValue(false);
    const changed = await f.command("stop");
    expect(text(changed)).toMatch(localizedProse("en-US", "commands.record.stale"));
    expect(actionId(changed.edits, "stop")).not.toBe("");
    expect(f.remove).not.toHaveBeenCalled();
  });

  it("rejects stale settings and missing context without silently using a default", async () => {
    const f = harness(session);
    const data = await f.command("data");
    await f.press(actionId(data.edits, "settings"));
    f.selects.context = undefined;
    const missing = await f.press(f.modalId(), { kind: "modal" });
    expect(text(missing)).toMatch(localizedProse("en-US", "commands.record.invalid_settings"));
    expect(f.settings).not.toHaveBeenCalled();
    await f.press(actionId(missing.edits, "settings"));
    f.selects.context = ["own"];
    f.settings.mockResolvedValue(null);
    const stale = await f.press(f.modalId(), { kind: "modal" });
    expect(text(stale)).toMatch(localizedProse("en-US", "commands.record.stale"));
  });

  it("binds every component and modal to its caller and guild with no manager override", async () => {
    const f = harness();
    const confirmation = await f.command();
    const ids = [actionId(confirmation.edits, "start"), actionId(confirmation.edits, "cancel")];
    const data = await f.command("data");
    for (const action of ["refresh", "export", "delete-range"] as const) ids.push(actionId(data.edits, action));
    for (const action of ["export", "delete-range"] as const) {
      await f.press(actionId(data.edits, action));
      ids.push(f.modalId());
    }
    const deletionData = await f.command("data");
    await f.press(actionId(deletionData.edits, "delete-range"));
    const deletion = await f.press(f.modalId(), { kind: "modal" });
    ids.push(actionId(deletion.edits, "delete-confirm"));
    const active = harness(session);
    const activeData = await active.command("data");
    const activeIds = [actionId(activeData.edits, "settings"), actionId(activeData.edits, "stop")];
    await active.press(activeIds[0] as string);
    activeIds.push(active.modalId());
    for (const [fixture, controls] of [
      [f, ids],
      [active, activeIds],
    ] as const) {
      const reads = fixture.totals.mock.calls.length;
      for (const id of controls) {
        const kind = id.includes("submit") ? "modal" : "button";
        for (const options of [
          { guildId: "200000000000000002", kind },
          { guildId: null, kind },
          {
            kind,
            overrides: { user: { id: "other-user", username: "Juno", displayName: "Juno", globalName: "Juno" } },
          },
        ] satisfies RouteInteractionOptions[]) {
          const denied = await fixture.press(id, options);
          expect(text(denied)).toMatch(localizedProse("en-US", "commands.record.forbidden"));
        }
      }
      expect(fixture.totals.mock.calls).toHaveLength(reads);
      for (const mutation of [fixture.start, fixture.stop, fixture.settings, fixture.remove, fixture.read])
        expect(mutation).not.toHaveBeenCalled();
    }
    await f.press(ids[0] as string);
    expect(f.start).toHaveBeenCalledTimes(1);
  });

  it("requires confirmation for scoped range and all-server deletion, with cancellation and replay protection", async () => {
    const f = harness(session);
    const data = await f.command("data");
    await f.press(actionId(data.edits, "delete-range"));
    f.selects.range = ["invalid"];
    const invalid = await f.press(f.modalId(), { kind: "modal" });
    expect(text(invalid)).toMatch(localizedProse("en-US", "commands.record.invalid_range"));
    expect(f.remove).not.toHaveBeenCalled();
    await f.press(actionId(invalid.edits, "delete-range"));
    const now = Date.parse("2025-03-15T12:34:56.000Z");
    f.setNow(now);
    f.selects.range = ["14d"];
    const preview = await f.press(f.modalId(), { kind: "modal" });
    expect(f.remove).not.toHaveBeenCalled();
    const id = actionId(preview.edits, "delete-confirm");
    f.setNow(now + 1000);
    const deleted = await f.press(id);
    await f.press(id);
    expect(f.remove).toHaveBeenCalledTimes(1);
    expect(f.remove).toHaveBeenLastCalledWith(scope, {
      from: new Date(now - 14 * 86_400_000),
      until: new Date(now),
    });
    f.selects.range = ["all"];
    await f.press(actionId(deleted.edits, "delete-range"));
    const all = await f.press(f.modalId(), { kind: "modal" });
    await f.press(actionId(all.edits, "cancel"));
    await f.press(actionId(all.edits, "delete-confirm"));
    expect(f.remove).toHaveBeenCalledTimes(1);
    const newData = await f.command("data");
    await f.press(actionId(newData.edits, "delete-range"));
    const allAgain = await f.press(f.modalId(), { kind: "modal" });
    await f.press(actionId(allAgain.edits, "delete-confirm"));
    expect(f.remove).toHaveBeenLastCalledWith(scope, { from: new Date(0), until: new Date(now + 1000) });
    const after = await f.command("data");
    await f.press(actionId(after.edits, "delete-range"));
    const pending = await f.press(f.modalId(), { kind: "modal" });
    f.restart();
    const stale = await f.press(actionId(pending.edits, "delete-confirm"));
    expect(text(stale)).toMatch(localizedProse("en-US", "commands.record.stale"));
    expect(f.remove).toHaveBeenCalledTimes(2);
    expect(f.stop).not.toHaveBeenCalled();
  });

  it("resolves export presets at submission and rejects invalid selections", async () => {
    const f = harness();
    const now = Date.parse("2025-03-15T12:34:56.000Z");
    f.setNow(now);
    for (const [value, days] of [
      ["24h", 1],
      ["7d", 7],
      ["14d", 14],
      ["30d", 30],
      ["all", 0],
    ] as const) {
      const data = await f.command("data");
      await f.press(actionId(data.edits, "export"));
      f.selects.range = [value];
      f.setNow(now + 1000);
      await f.press(f.modalId(), { kind: "modal" });
      expect(f.read.mock.calls.at(-1)?.[1]).toEqual({
        from: new Date(days === 0 ? 0 : now + 1000 - days * 86_400_000),
        until: new Date(now + 1000),
      });
    }
    const reads = f.read.mock.calls.length;
    for (const value of [undefined, [], ["7d", "all"], ["toString"], ["invalid"]]) {
      const data = await f.command("data");
      await f.press(actionId(data.edits, "export"));
      f.selects.range = value;
      const invalid = await f.press(f.modalId(), { kind: "modal" });
      expect(text(invalid)).toMatch(localizedProse("en-US", "commands.record.invalid_range"));
    }
    expect(f.read).toHaveBeenCalledTimes(reads);
  });

  it("validates export format and delivers scoped stored data ephemerally without source access checks", async () => {
    const f = harness();
    const data = await f.command("data");
    expect(data.calls[0]?.payload).toMatchObject({ flags: MessageFlags.Ephemeral });
    await f.press(actionId(data.edits, "export"));
    f.selects.format = ["provider-training"];
    const bad = await f.press(f.modalId(), { kind: "modal", fields: { from: "2025-01-01", until: "2025-02-01" } });
    expect(text(bad)).toMatch(localizedProse("en-US", "commands.record.invalid_format"));
    expect(f.read).not.toHaveBeenCalled();
    await f.press(actionId(bad.edits, "export"));
    f.selects.format = ["json"];
    const empty = await f.press(f.modalId(), { kind: "modal", fields: { from: "2025-01-01", until: "2025-02-01" } });
    expect(text(empty)).toMatch(localizedProse("en-US", "commands.record.export_empty"));
    expect(f.read.mock.calls[0]?.[0]).toEqual(scope);
    await f.press(actionId(empty.edits, "export"));
    f.read.mockResolvedValue({
      excerpts: [
        {
          version: 1,
          id: randomUUID(),
          sessionId: randomUUID(),
          context: "own",
          triggeredAt: "2025-01-02T00:00:00.000Z",
          messages: [
            {
              id: randomUUID(),
              timestamp: "2025-01-02T00:00:00.000Z",
              editedTimestamp: null,
              speaker: "SELF",
              channel: "CHANNEL_1",
              body: "[SELF]",
              replyTo: null,
              attachments: { image: 1, video: 0, audio: 0, file: 0 },
            },
          ],
        },
      ],
      nextCursor: null,
      bytes: 1000,
      oversized: false,
    });
    const ready = await f.press(f.modalId(), { kind: "modal", fields: { from: "2025-01-01", until: "2025-02-01" } });
    expect(ready.calls[0]?.method).toBe("deferUpdate");
    expect(text(ready)).toMatch(localizedProse("en-US", "commands.record.export_ready"));
    const payload = ready.edits.at(-1) as ReturnType<typeof buildRecordingPanel>;
    expect(payload.files[0]?.attachment.length).toBeGreaterThan(0);
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(
      f.read.mock.calls.every(
        ([actualScope]) => actualScope.serverId === scope.serverId && actualScope.ownerUserId === scope.ownerUserId,
      ),
    ).toBe(true);
  });

  it("bounds concurrent exports and handles too-small attachments without partial files", async () => {
    const f = harness();
    const data = await f.command("data");
    await f.press(actionId(data.edits, "export"));
    const firstId = f.modalId();
    await f.press(actionId(data.edits, "export"));
    const secondId = f.modalId();
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.read.mockImplementationOnce(async () => {
      await pending;
      return { excerpts: [], nextCursor: null, bytes: 0, oversized: false };
    });
    const fields = { from: "2025-01-01", until: "2025-02-01" };
    const first = f.press(firstId, { kind: "modal", fields });
    await Promise.resolve();
    const busy = await f.press(secondId, { kind: "modal", fields });
    expect(text(busy)).toMatch(localizedProse("en-US", "commands.record.export_busy"));
    release?.();
    await first;
    await f.press(actionId(busy.edits, "export"));
    f.read.mockResolvedValue({ excerpts: [], nextCursor: null, bytes: 0, oversized: true });
    const large = await f.press(f.modalId(), { kind: "modal", fields, attachmentSizeLimit: 10 });
    expect(text(large)).toMatch(localizedProse("en-US", "commands.record.export_too_large"));
    expect((large.edits.at(-1) as ReturnType<typeof buildRecordingPanel>).files).toHaveLength(0);
  });

  it("does not log transcript-bearing failures or return their contents", async () => {
    const f = harness();
    const privateText = "A private fixture transcript";
    f.current.mockRejectedValue(new Error(privateText));
    const errorLog = spyOn(log, "error").mockResolvedValue(undefined);
    try {
      const failed = await f.command("data");
      expect(text(failed)).toMatch(localizedProse("en-US", "commands.record.unavailable"));
      expect(text(failed)).not.toContain(privateText);
      expect(errorLog).toHaveBeenCalled();
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(privateText);
    } finally {
      errorLog.mockRestore();
    }
  });

  it("rejects guildless execution and changed privacy before starting", async () => {
    const f = harness();
    const dm = await f.command("start", undefined, null);
    expect(text(dm)).toMatch(localizedProse("en-US", "commands.record.guild_only"));
    expect(f.current).not.toHaveBeenCalled();
    const confirmation = await f.command();
    f.eligible.mockResolvedValue(new Set());
    const blocked = await f.press(actionId(confirmation.edits, "start"));
    expect(text(blocked)).toMatch(localizedProse("en-US", "commands.record.privacy"));
    expect(f.start).not.toHaveBeenCalled();
  });

  it("keeps all panel states and modals within Discord limits across locales", () => {
    expectForEveryLocale((locale) => {
      for (const active of [null, session])
        for (const days of [null, 30]) {
          const totals = {
            ...summary(active),
            retentionDays: days,
            nextExpiry: days ? new Date() : null,
            evictedExcerpts: 100,
            evictedBytes: RECORDING_QUOTA_BYTES,
            lastEvictedAt: new Date(),
          };
          expectSafePanelPayload(
            buildRecordingPanel({
              locale,
              nonce,
              summary: totals,
              binding: { owner: "1".repeat(20), guild: "2".repeat(20) },
            }),
            `${locale} summary`,
          );
          expectSafePanelPayload(
            buildRecordingPanel({
              locale,
              nonce,
              confirmation: recordingConsent(locale, { context: "surrounding", duration: "unlimited" }, days),
              confirmAction: "start",
            }),
            `${locale} consent`,
          );
        }
      expectSafePanelPayload(
        buildRecordingPanel({
          locale,
          nonce,
          summary: summary(session),
          receipt: { tone: "info", heading: "x".repeat(50), detail: "x".repeat(300) },
          files: Array.from({ length: 10 }, (_, index) => ({
            name: `recording-${index}.json`,
            data: Buffer.from("{}"),
          })),
        }),
        `${locale} attachments`,
      );
      for (const kind of ["settings", "export", "delete-range"] as const)
        expect(validateRawModalLimits(buildRecordingModal(locale, nonce, kind, session)).valid).toBe(true);
    });
  });
});
