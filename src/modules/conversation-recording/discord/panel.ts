import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ComponentInContainerData,
  type ButtonComponentData,
} from "discord.js";
import type { RecordingSession, RecordingSettings, RecordingSummary } from "@/modules/conversation-recording/db/types";
import {
  recordingContextKeys,
  recordingDurationKeys,
  recordingRouteId,
  type RecordingAction,
} from "@/modules/conversation-recording/discord/catalog";
import type { RecordingExportFile } from "@/modules/conversation-recording/export/transcript";
import type { RawModalPayload } from "@/utils/discord/ui/configModals";
import { buildPanelContainer, buildPanelReceiptContainer } from "@/utils/discord/ui/panel";
import type { PanelReceipt } from "@/types/discord/panel";
import type { RawDiscordComponent } from "@/types/discord/rawApiTypes";
import { localizer } from "@/utils/text/localizer";

const mib = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2);
const timestamp = (date: Date) => `<t:${Math.floor(date.getTime() / 1000)}:f>`;

export function buildRecordingPanel(options: {
  locale: string;
  nonce: string;
  summary?: RecordingSummary;
  confirmation?: string;
  confirmAction?: "start" | "delete-confirm";
  receipt?: PanelReceipt;
  files?: RecordingExportFile[];
}) {
  const { locale, nonce, summary, confirmation, confirmAction, receipt, files } = options;
  const t = (key: string, variables: Record<string, string | number> = {}) => localizer(locale, key, variables);
  const button = (action: RecordingAction, key: string, destructive = false): ButtonComponentData => ({
    type: ComponentType.Button as const,
    style: destructive ? ButtonStyle.Danger : ButtonStyle.Secondary,
    customId: recordingRouteId(action, nonce),
    label: t(key),
  });
  const components: ComponentInContainerData[] = [
    { type: ComponentType.TextDisplay, content: `### ${t("commands.record.concept")}` },
  ];
  if (confirmation && confirmAction) {
    components.push(
      { type: ComponentType.TextDisplay, content: confirmation },
      {
        type: ComponentType.ActionRow,
        components: [
          button(
            confirmAction,
            confirmAction === "start" ? "commands.record.start_button" : "commands.record.delete_confirm_button",
            confirmAction === "delete-confirm",
          ),
          button("cancel", "commands.record.cancel_button"),
        ],
      },
    );
  } else if (summary) {
    const session = summary.session;
    const lines = [
      session
        ? t("commands.record.active", { context: t(recordingContextKeys[session.context]) })
        : t("commands.record.inactive"),
      ...(session
        ? [
            t("commands.record.end", {
              end: session.ends_at ? timestamp(session.ends_at) : t("commands.record.until_stopped"),
            }),
          ]
        : []),
      t("commands.record.storage", {
        server: mib(summary.serverBytes),
        count: summary.excerpts,
        used: mib(summary.ownerBytes),
        quota: mib(summary.quotaBytes),
      }),
      summary.retentionDays === null
        ? t("commands.record.expiry_off")
        : t("commands.record.expiry", {
            days: summary.retentionDays,
            next: summary.nextExpiry ? timestamp(summary.nextExpiry) : t("commands.record.no_expiry"),
          }),
      ...(summary.evictedExcerpts
        ? [
            t("commands.record.evictions", {
              count: summary.evictedExcerpts,
              bytes: mib(summary.evictedBytes),
              last: summary.lastEvictedAt ? timestamp(summary.lastEvictedAt) : "",
            }),
          ]
        : []),
    ];
    components.push(
      { type: ComponentType.TextDisplay, content: lines.map((line) => `> ${line}`).join("\n") },
      {
        type: ComponentType.ActionRow,
        components: [
          ...(session
            ? [button("settings", "commands.record.settings_button"), button("stop", "commands.record.stop_button")]
            : []),
          button("refresh", "commands.record.refresh_button"),
          button("export", "commands.record.export_button"),
        ],
      },
      {
        type: ComponentType.ActionRow,
        components: [
          button("delete-range", "commands.record.delete_range_button", true),
          button("delete-all", "commands.record.delete_all_button", true),
        ],
      },
    );
  }
  for (const file of files ?? [])
    components.push({ type: ComponentType.File, file: { url: `attachment://${file.name}` } });
  return {
    components: [...(receipt ? [buildPanelReceiptContainer(receipt)] : []), buildPanelContainer(components)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    attachments: [],
    files: (files ?? []).map((file) => ({ attachment: file.data, name: file.name })),
  };
}

export function recordingConsent(locale: string, settings: RecordingSettings, retentionDays: number | null): string {
  return [
    localizer(locale, "commands.record.consent", {
      context: localizer(locale, recordingContextKeys[settings.context]),
      duration: localizer(locale, recordingDurationKeys[settings.duration]),
    }),
    localizer(locale, "commands.record.limits"),
    localizer(
      locale,
      retentionDays === null ? "commands.record.no_retention_consent" : "commands.record.retention_consent",
      { days: retentionDays ?? 0 },
    ),
  ].join("\n\n");
}

export function buildRecordingModal(
  locale: string,
  nonce: string,
  kind: "settings" | "export" | "delete-range",
  session?: RecordingSession,
): RawModalPayload {
  const t = (key: string) => localizer(locale, key);
  const label = (key: string, component: RawDiscordComponent, description?: string): RawDiscordComponent => ({
    type: 18,
    label: t(key),
    component,
    ...(description ? { description: t(description) } : {}),
  });
  if (kind === "settings")
    return {
      custom_id: recordingRouteId("settings-submit", nonce),
      title: t("commands.record.settings_title"),
      components: [
        label(
          "commands.record.context_label",
          {
            type: 3,
            custom_id: "context",
            min_values: 1,
            max_values: 1,
            required: true,
            options: Object.entries(recordingContextKeys).map(([value, key]) => ({
              value,
              label: t(key),
              default: value === session?.context,
            })),
          },
          "commands.record.context_description",
        ),
        label(
          "commands.record.duration_label",
          {
            type: 3,
            custom_id: "duration",
            min_values: 1,
            max_values: 1,
            required: true,
            options: Object.entries(recordingDurationKeys).map(([value, key]) => ({
              value,
              label: t(key),
              default: value === session?.duration,
            })),
          },
          "commands.record.duration_description",
        ),
      ],
    };
  return {
    custom_id: recordingRouteId(kind === "export" ? "export-submit" : "delete-submit", nonce),
    title: t(kind === "export" ? "commands.record.export_title" : "commands.record.delete_title"),
    components: [
      { type: 10, content: t("commands.record.range_description") },
      ...(
        [
          ["from", "commands.record.from_label"],
          ["until", "commands.record.until_label"],
        ] as const
      ).map(([field, key]) =>
        label(key, {
          type: 4,
          custom_id: field,
          style: 1,
          required: true,
          min_length: 10,
          max_length: 10,
          placeholder: "YYYY-MM-DD",
        }),
      ),
      ...(kind === "export"
        ? [
            label("commands.record.format_label", {
              type: 3,
              custom_id: "format",
              min_values: 1,
              max_values: 1,
              required: true,
              options: [
                { value: "markdown", label: t("commands.record.markdown_option") },
                { value: "json", label: t("commands.record.json_option") },
              ],
            }),
          ]
        : []),
    ],
  };
}
