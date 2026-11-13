import { randomUUID } from "node:crypto";
import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { PanelAction } from "@/constants/panelActions";
import type { UserRow } from "@/types/db/schema";
import type { PanelReceipt } from "@/types/discord/panel";
import { conversationRecordingRepository } from "@/modules/conversation-recording/db/repositories";
import {
  recordingSettingsSchema,
  type RecordingScope,
  type RecordingSession,
  type RecordingSettings,
  type RecordingToken,
  type RecordingRange,
} from "@/modules/conversation-recording/db/types";
import {
  parseRecordingRoute,
  RECORDING_ROUTE_VERSION,
  RECORDING_DATA_ACTIONS,
  type RecordingAction,
} from "@/modules/conversation-recording/discord/catalog";
import {
  buildRecordingModal,
  buildRecordingPanel,
  recordingConsent,
} from "@/modules/conversation-recording/discord/panel";
import { parseRecordingRange } from "@/modules/conversation-recording/export/range";
import { buildRecordingExport, type RecordingExportFile } from "@/modules/conversation-recording/export/transcript";
import { userRepository } from "@/utils/db/repositories/UserRepository";
import type { GlobalInteractionRoute, GlobalRoutableInteraction } from "@/utils/discord/interactions/routeRegistry";
import { deliverGuardedPanel } from "@/utils/discord/ui/interactionCore";
import { buildPanelReceiptMessage, replyPanelReceipt } from "@/utils/discord/ui/panel";
import { showRoutedRawModal, takeRawModalStringSelectValues } from "@/utils/discord/ui/modals";
import { log } from "@/utils/misc/logger";
import { recordPanelActionStat } from "@/utils/stats/panelActionMetrics";
import { localizer } from "@/utils/text/localizer";

// Controls cap at 200 entries because they stay in process memory; sustained eviction needs a shared bounded store.
const CONTROL_TTL_MS = 15 * 60_000;
const MAX_CONTROLS = 200;
const MAX_CONCURRENT_EXPORTS = 2;

type RecordingInteraction = ChatInputCommandInteraction | GlobalRoutableInteraction;
type Repository = Pick<
  typeof conversationRecordingRepository,
  | "summary"
  | "start"
  | "getStartToken"
  | "stop"
  | "getActive"
  | "updateSettings"
  | "deleteRange"
  | "readRange"
  | "eligibleUsers"
>;
interface Control {
  owner: string;
  guild: string;
  scope: RecordingScope;
  locale: string;
  expiresAt: number;
  actions: readonly RecordingAction[];
  session?: RecordingSession;
  consent?: RecordingToken | null;
  settings?: RecordingSettings;
  range?: RecordingRange;
}

async function resolveScope(interaction: RecordingInteraction, userData?: UserRow): Promise<RecordingScope | null> {
  if (!interaction.guildId) return null;
  const [serverId, user] = await Promise.all([
    conversationRecordingRepository.findServerId(interaction.guildId),
    userData ? Promise.resolve(userData) : userRepository.loadByDiscordId(interaction.user.id),
  ]);
  return serverId && user?.user_id && user.user_disc_id === interaction.user.id
    ? { serverId, ownerUserId: user.user_id }
    : null;
}

interface RecordingDependencies {
  repository: Repository;
  resolveScope: typeof resolveScope;
  showModal: typeof showRoutedRawModal;
  takeSelectValues: typeof takeRawModalStringSelectValues;
  recordAction: typeof recordPanelActionStat;
  now(): number;
}
const defaults: RecordingDependencies = {
  repository: conversationRecordingRepository,
  resolveScope,
  showModal: showRoutedRawModal,
  takeSelectValues: takeRawModalStringSelectValues,
  recordAction: recordPanelActionStat,
  now: Date.now,
};

export function createRecordingController(overrides: Partial<RecordingDependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  const controls = new Map<string, Control>();
  const exporting = new Set<number>();
  const token = (session: RecordingSession): RecordingToken => ({
    sessionId: session.session_id,
    revision: session.revision,
  });
  const receipt = (
    locale: string,
    key: string,
    variables: Record<string, string | number> = {},
    warning = false,
  ): PanelReceipt => ({
    tone: warning ? "warning" : "info",
    heading: localizer(locale, "commands.record.notice"),
    detail: localizer(locale, key, variables),
    ...(warning ? { reason: key } : {}),
  });
  const store = (control: Omit<Control, "expiresAt">): string => {
    for (const [key, current] of controls) if (current.expiresAt <= deps.now()) controls.delete(key);
    while (controls.size >= MAX_CONTROLS) controls.delete(controls.keys().next().value as string);
    const nonce = randomUUID().replaceAll("-", "");
    controls.set(nonce, { ...control, expiresAt: deps.now() + CONTROL_TTL_MS });
    return nonce;
  };
  const bind = (interaction: RecordingInteraction, scope: RecordingScope, locale: string) => ({
    owner: interaction.user.id,
    guild: interaction.guildId as string,
    scope,
    locale,
  });
  async function paint(
    interaction: RecordingInteraction,
    control: Pick<Control, "scope" | "locale" | "owner" | "guild">,
    notice?: PanelReceipt,
    files?: RecordingExportFile[],
  ) {
    const summary = await deps.repository.summary(control.scope);
    await deliverGuardedPanel(
      interaction,
      buildRecordingPanel({ locale: control.locale, nonce: "", binding: control, summary, receipt: notice, files }),
      { method: "editReply", locale: control.locale, receipt: notice },
    );
  }
  async function fail(interaction: RecordingInteraction, locale: string) {
    await noticeReply(interaction, receipt(locale, "commands.record.unavailable", {}, true), locale);
  }
  async function noticeReply(interaction: RecordingInteraction, notice: PanelReceipt, locale: string) {
    if (interaction.deferred) {
      await deliverGuardedPanel(interaction, buildRecordingPanel({ locale, nonce: "", receipt: notice }), {
        method: "editReply",
        locale,
        receipt: notice,
      });
    } else await replyPanelReceipt(interaction, notice);
  }
  async function reportFailure(interaction: RecordingInteraction, locale: string, action: string) {
    // Database and validation errors can contain transcript text, so only the operation name reaches logs.
    await log.error("Conversation recording operation failed", undefined, {
      errorType: "RecordingOperationError",
      metadata: { action },
    });
    await fail(interaction, locale);
  }
  function stat(control: Control | Omit<Control, "expiresAt" | "actions">, action: PanelAction) {
    void deps.recordAction({ action, serverId: control.scope.serverId, userDiscId: control.owner });
  }
  async function confirmDeletion(interaction: RecordingInteraction, control: Control, range: RecordingRange) {
    const nonce = store({ ...control, range, actions: ["delete-confirm", "cancel"] });
    const confirmation = localizer(control.locale, "commands.record.delete_confirmation", {
      from: range.from.toISOString(),
      until: range.until.toISOString(),
    });
    await deliverGuardedPanel(
      interaction,
      buildRecordingPanel({ locale: control.locale, nonce, confirmation, confirmAction: "delete-confirm" }),
      { method: "editReply", locale: control.locale },
    );
  }

  async function executeCommand(
    interaction: ChatInputCommandInteraction,
    userData: UserRow,
    locale: string,
    action: "start" | "stop" | "data",
    input?: { context: string | null; duration: string | null },
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guildId)
      return noticeReply(interaction, receipt(locale, "commands.record.guild_only", {}, true), locale);
    try {
      const scope = await deps.resolveScope(interaction, userData);
      if (!scope) return fail(interaction, locale);
      const binding = bind(interaction, scope, locale);
      const active = await deps.repository.getActive(scope);
      if (action === "stop") {
        const stopped = active ? await deps.repository.stop(scope, token(active)) : false;
        if (stopped) stat(binding, "record.personal.collection.stop");
        return paint(
          interaction,
          binding,
          receipt(
            locale,
            stopped ? "commands.record.stopped" : active ? "commands.record.stale" : "commands.record.not_active",
            {},
            Boolean(active && !stopped),
          ),
        );
      }
      if (action === "data" || active)
        return paint(
          interaction,
          binding,
          active && action === "start" ? receipt(locale, "commands.record.already_active") : undefined,
        );
      const settings = recordingSettingsSchema.safeParse(input);
      if (!settings.success)
        return noticeReply(interaction, receipt(locale, "commands.record.invalid_settings", {}, true), locale);
      if (!(await deps.repository.eligibleUsers(scope.serverId, [interaction.user.id])).has(interaction.user.id)) {
        return noticeReply(interaction, receipt(locale, "commands.record.privacy", {}, true), locale);
      }
      const consent = await deps.repository.getStartToken(scope);
      const summary = await deps.repository.summary(scope);
      if (summary.session) return paint(interaction, binding, receipt(locale, "commands.record.already_active"));
      const nonce = store({ ...binding, settings: settings.data, consent, actions: ["start", "cancel"] });
      await deliverGuardedPanel(
        interaction,
        buildRecordingPanel({
          locale,
          nonce,
          confirmation: recordingConsent(locale, settings.data, summary.retentionDays),
          confirmAction: "start",
        }),
        { method: "editReply", locale },
      );
    } catch {
      await reportFailure(interaction, locale, action);
    }
  }

  const route: GlobalInteractionRoute = {
    namespace: "record",
    version: RECORDING_ROUTE_VERSION,
    async execute(_client, interaction, parsed) {
      const route = parseRecordingRoute(parsed);
      let control = route ? controls.get(route.nonce) : undefined;
      if (route?.panel) {
        const panel = route.panel;
        if (!interaction.guildId || panel.owner !== interaction.user.id || panel.guild !== interaction.guildId) {
          await replyPanelReceipt(interaction, receipt(interaction.locale, "commands.record.forbidden", {}, true));
          return;
        }
        if (!interaction.isButton()) {
          await replyPanelReceipt(interaction, receipt(panel.locale, "commands.record.stale", {}, true));
          return;
        }
        const modal = ["settings", "export", "delete-range"].includes(route.action);
        if (!modal) await interaction.deferUpdate();
        try {
          const scope = await deps.resolveScope(interaction);
          if (!scope) return fail(interaction, panel.locale);
          control = {
            ...panel,
            scope,
            actions: RECORDING_DATA_ACTIONS,
            expiresAt: Number.POSITIVE_INFINITY,
            session:
              route.action === "settings" || route.action === "stop"
                ? ((await deps.repository.getActive(scope)) ?? undefined)
                : undefined,
          };
        } catch {
          await reportFailure(interaction, panel.locale, route.action);
          return;
        }
      }
      const locale =
        control && control.owner === interaction.user.id && control.guild === interaction.guildId
          ? control.locale
          : interaction.locale;
      if (!control || control.expiresAt <= deps.now() || !route || !control.actions.includes(route.action)) {
        await replyPanelReceipt(interaction, receipt(locale, "commands.record.stale", {}, true));
        return;
      }
      if (!interaction.guildId || control.owner !== interaction.user.id || control.guild !== interaction.guildId) {
        await replyPanelReceipt(interaction, receipt(locale, "commands.record.forbidden", {}, true));
        return;
      }
      const { action } = route;
      const submit = ["settings-submit", "export-submit", "delete-submit"].includes(action);
      if (submit ? !interaction.isModalSubmit() : !interaction.isButton()) {
        await replyPanelReceipt(interaction, receipt(locale, "commands.record.stale", {}, true));
        return;
      }
      try {
        if (action === "settings" || action === "export" || action === "delete-range") {
          if (action === "settings" && !control.session) {
            await replyPanelReceipt(interaction, receipt(locale, "commands.record.stale", {}, true));
            return;
          }
          const nonce = store({
            ...control,
            actions: [
              action === "settings" ? "settings-submit" : action === "export" ? "export-submit" : "delete-submit",
            ],
          });
          await deps.showModal(
            interaction as Parameters<typeof showRoutedRawModal>[0],
            buildRecordingModal(locale, nonce, action, control.session),
          );
          return;
        }
        controls.delete(route.nonce);
        if (!interaction.deferred) await interaction.deferUpdate();
        if (action === "cancel") {
          const notice = receipt(locale, "commands.record.cancelled");
          return control.actions.includes("start")
            ? deliverGuardedPanel(interaction, buildPanelReceiptMessage(notice), {
                method: "editReply",
                locale,
                receipt: notice,
              })
            : paint(interaction, control, notice);
        }
        if (action === "refresh") return paint(interaction, control);
        if (action === "start") {
          if (!control.settings || control.consent === undefined)
            return paint(interaction, control, receipt(locale, "commands.record.stale", {}, true));
          if (!(await deps.repository.eligibleUsers(control.scope.serverId, [control.owner])).has(control.owner)) {
            return paint(interaction, control, receipt(locale, "commands.record.privacy", {}, true));
          }
          const result = await deps.repository.start(control.scope, control.settings, control.consent);
          if (result?.created) stat(control, "record.personal.collection.start");
          return paint(
            interaction,
            control,
            receipt(
              locale,
              !result
                ? "commands.record.stale"
                : result.created
                  ? "commands.record.started"
                  : "commands.record.already_active",
              {},
              !result,
            ),
          );
        }
        if (action === "stop") {
          const stopped = control.session ? await deps.repository.stop(control.scope, token(control.session)) : false;
          if (stopped) stat(control, "record.personal.collection.stop");
          return paint(
            interaction,
            control,
            receipt(locale, stopped ? "commands.record.stopped" : "commands.record.stale", {}, !stopped),
          );
        }
        if (action === "delete-confirm") {
          if (control.range === undefined)
            return paint(interaction, control, receipt(locale, "commands.record.stale", {}, true));
          const count = await deps.repository.deleteRange(control.scope, control.range);
          stat(control, "record.personal.excerpts.remove");
          return paint(interaction, control, receipt(locale, "commands.record.deleted", { count }));
        }
        if (!interaction.isModalSubmit()) return;
        if (action === "settings-submit") {
          const context = deps.takeSelectValues(interaction.id, "context");
          const duration = deps.takeSelectValues(interaction.id, "duration");
          const settings = recordingSettingsSchema.safeParse({
            context: context?.length === 1 ? context[0] : undefined,
            duration: duration?.length === 1 ? duration[0] : undefined,
          });
          if (!settings.success || !control.session)
            return paint(interaction, control, receipt(locale, "commands.record.invalid_settings", {}, true));
          const saved = await deps.repository.updateSettings(control.scope, token(control.session), settings.data);
          if (saved) stat(control, "record.personal.collection.set");
          return paint(
            interaction,
            control,
            receipt(locale, saved ? "commands.record.saved" : "commands.record.stale", {}, !saved),
          );
        }
        const selected = deps.takeSelectValues(interaction.id, "range");
        const range = selected?.length === 1 ? parseRecordingRange(selected[0], deps.now()) : null;
        if (!range) return paint(interaction, control, receipt(locale, "commands.record.invalid_range", {}, true));
        if (action === "delete-submit") return confirmDeletion(interaction, control, range);
        const format = deps.takeSelectValues(interaction.id, "format");
        if (format?.length !== 1 || (format[0] !== "markdown" && format[0] !== "json"))
          return paint(interaction, control, receipt(locale, "commands.record.invalid_format", {}, true));
        if (exporting.size >= MAX_CONCURRENT_EXPORTS || exporting.has(control.scope.ownerUserId))
          return paint(interaction, control, receipt(locale, "commands.record.export_busy", {}, true));
        exporting.add(control.scope.ownerUserId);
        try {
          const result = await buildRecordingExport({
            scope: control.scope,
            range,
            format: format[0],
            locale,
            attachmentSizeLimit: interaction.attachmentSizeLimit,
            readRange: (scope, selectedRange, cursor) => deps.repository.readRange(scope, selectedRange, cursor),
          });
          await paint(
            interaction,
            control,
            receipt(
              locale,
              result.status === "ready"
                ? "commands.record.export_ready"
                : result.status === "empty"
                  ? "commands.record.export_empty"
                  : "commands.record.export_too_large",
              {},
              result.status === "too-large",
            ),
            result.status === "ready" ? result.files : undefined,
          );
        } finally {
          exporting.delete(control.scope.ownerUserId);
        }
      } catch {
        await reportFailure(interaction, locale, action);
      }
    },
  };
  return { route, executeCommand };
}

const controller = createRecordingController();
export const recordingInteractionRoute = controller.route;
export const executeRecordingCommand = controller.executeCommand;
