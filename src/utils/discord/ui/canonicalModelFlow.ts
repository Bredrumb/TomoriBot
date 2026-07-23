import type {
  ActionRowData,
  ButtonComponentData,
  ButtonInteraction,
  ComponentInContainerData,
  ContainerComponentData,
} from "discord.js";
import { ButtonStyle, ComponentType, escapeMarkdown, MessageFlags } from "discord.js";
import type { ModalOptions } from "@/types/discord/modal";
import { ColorCode } from "@/utils/misc/logger";
import { localizer } from "@/utils/text/localizer";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { commandRegistry } from "@/utils/discord/commandRegistry";
import {
  buildPersonaWorkflowNotice,
  isCollectorTimeoutError,
  PERSONA_WORKFLOW_COMPONENT_TIMEOUT_MS,
  type CanonicalPrivateWorkflowPhase,
  type PersonaWorkflowComponentsV2Payload,
  type PersonaWorkflowModalPhase,
} from "./personaWorkflow";

/**
 * Shared delivery mechanics for the canonical one-message model-config commands
 * (`/model text|vision|video|image|embedding` and their personal-scope siblings).
 *
 * Each command owns its business logic — which model table, which config field, which
 * terminal copy — and calls these helpers only for the lifecycle: render the provider
 * step on the canonical message, collect the opening button, and open the model modal
 * (routing `>25` options through the canonical range selector automatically). This is
 * what keeps "adding a picker→modal command touches one file": the lifecycle lives here,
 * the intent lives in the command.
 */

/** Minimal shape a saved-provider row needs for the canonical picker. */
export interface CanonicalProviderChoice {
  provider: string;
}

/**
 * Builds the Components V2 provider picker: one Secondary button per provider (4 per row)
 * plus a Danger cancel button. Button ids are `${customIdPrefix}_${index}`; cancel is
 * `${customIdPrefix}_cancel`.
 */
export function buildProviderPickerPayload(
  locale: string,
  customIdPrefix: string,
  providers: readonly string[],
  currentModel: string,
  currentProvider: string,
  options?: { note?: string },
): PersonaWorkflowComponentsV2Payload {
  const components: ComponentInContainerData[] = [
    {
      type: ComponentType.TextDisplay,
      content: `### ${localizer(locale, "commands.model.providerPicker.title")}`,
    },
    {
      type: ComponentType.TextDisplay,
      content: localizer(locale, "commands.model.providerPicker.description"),
    },
    // Muted subtext showing the current selection — matches the footer convention in
    // buildNoticeContainer. Kept as its own TextDisplay (not "\n\n" appended) so the
    // Container's built-in gap doesn't stack into an oversized break.
    {
      type: ComponentType.TextDisplay,
      content: `-# ${localizer(locale, "commands.model.providerPicker.current_selection", {
        model: escapeMarkdown(currentModel),
        provider: escapeMarkdown(currentProvider),
      })}`,
    },
  ];

  // Optional caller guidance (e.g. the NovelAI pipeline note on /model image).
  if (options?.note) {
    components.push({ type: ComponentType.TextDisplay, content: options.note });
  }

  const buttons = providers.map(
    (provider, index): ButtonComponentData => ({
      type: ComponentType.Button,
      customId: `${customIdPrefix}_${index}`,
      label: getProviderDisplayName(provider),
      style: ButtonStyle.Secondary,
    }),
  );
  const buttonRows: ButtonComponentData[][] = [];
  for (let offset = 0; offset < buttons.length; offset += 4) {
    buttonRows.push(buttons.slice(offset, offset + 4));
  }

  const cancelButton: ButtonComponentData = {
    type: ComponentType.Button,
    customId: `${customIdPrefix}_cancel`,
    label: localizer(locale, "general.pagination.cancel"),
    style: ButtonStyle.Danger,
  };
  const lastRow = buttonRows.at(-1);
  if (lastRow && lastRow.length < 5) {
    lastRow.push(cancelButton);
  } else {
    buttonRows.push([cancelButton]);
  }
  for (const row of buttonRows) {
    components.push({
      type: ComponentType.ActionRow,
      components: row,
    } satisfies ActionRowData<ButtonComponentData>);
  }

  const container: ContainerComponentData<ComponentInContainerData> = {
    type: ComponentType.Container,
    accentColor: Number.parseInt(ColorCode.INFO.replace("#", ""), 16),
    components,
  };
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Single "open model selector" button for the single-provider case: no provider picker
 * is shown, but the flow still opens its modal from a button click on the one canonical
 * message. The button's custom id is `openId`.
 */
export function buildOpenSelectorPayload(locale: string, openId: string): PersonaWorkflowComponentsV2Payload {
  return buildPersonaWorkflowNotice({
    locale,
    titleKey: "general.persona_workflow.modal_ready_title",
    descriptionKey: "general.persona_workflow.modal_ready_description",
    color: ColorCode.INFO,
    button: {
      customId: openId,
      labelKey: "general.persona_workflow.open_modal_button",
      style: ButtonStyle.Primary,
    },
  });
}

/**
 * Terminal notice for the legacy OpenRouter "other-model" sentinel, which was moved to
 * `/openrouter model add|remove`. The V2 equivalent of `replyLegacyOpenRouterOtherModelMoved`.
 */
export function buildOpenRouterMovedNotice(locale: string): PersonaWorkflowComponentsV2Payload {
  return buildPersonaWorkflowNotice({
    locale,
    titleKey: "general.openrouter_model_moved_title",
    descriptionKey: "general.openrouter_model_moved_description",
    descriptionVars: {
      add_command: commandRegistry.getCommandMention("openrouter", "model", "add"),
      remove_command: commandRegistry.getCommandMention("openrouter", "model", "remove"),
    },
    color: ColorCode.ERROR,
  });
}

/** The no-saved-providers terminal notice, used as the initial canonical payload. */
export function buildNoProvidersPayload(locale: string): PersonaWorkflowComponentsV2Payload {
  return buildPersonaWorkflowNotice({
    locale,
    titleKey: "commands.model.providerPicker.no_providers_title",
    descriptionKey: "commands.model.providerPicker.no_providers_description",
    color: ColorCode.ERROR,
  });
}

/**
 * Awaits a button click on the canonical message. On timeout it renders the timeout
 * notice in place and returns null; the returned button is left unacknowledged so the
 * caller can open a modal on it via {@link CanonicalPrivateWorkflowPhase.useButton}.
 */
export async function awaitCanonicalButton(
  phase: CanonicalPrivateWorkflowPhase,
  userId: string,
  prefix: string,
  locale: string,
): Promise<ButtonInteraction | null> {
  const message = await phase.message.fetchMessage();
  try {
    return await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (candidate) => candidate.user.id === userId && candidate.customId.startsWith(prefix),
      time: PERSONA_WORKFLOW_COMPONENT_TIMEOUT_MS,
    });
  } catch (error) {
    if (isCollectorTimeoutError(error)) {
      await phase.message
        .replace(
          buildPersonaWorkflowNotice({
            locale,
            titleKey: "general.interaction.timeout_title",
            descriptionKey: "general.pagination.timeout",
            color: ColorCode.WARN,
          }),
        )
        .catch(() => undefined);
      return null;
    }
    throw error;
  }
}

/**
 * Renders the provider-selection step and returns the unacknowledged button the model
 * modal will open from, plus the chosen provider.
 *
 * - 1 provider: the canonical message already shows the "open selector" button; this just
 *   collects the click and returns the lone provider.
 * - 2+ providers: collects the picker click, handling cancel and invalid selection.
 *
 * Returns null when the user cancels/times out — the canonical message already shows the
 * terminal notice in those cases.
 */
export async function acquireModelModalOpener(
  phase: CanonicalPrivateWorkflowPhase,
  userId: string,
  locale: string,
  savedProviders: readonly CanonicalProviderChoice[],
  idRoot: string,
): Promise<{ button: ButtonInteraction; provider: string } | null> {
  // 1. Single provider: the only control is the "open selector" button.
  if (savedProviders.length === 1) {
    const button = await awaitCanonicalButton(phase, userId, `${idRoot}_open`, locale);
    if (!button) return null;
    return { button, provider: savedProviders[0].provider.toLowerCase() };
  }

  // 2. Multiple providers: collect the picker click.
  const button = await awaitCanonicalButton(phase, userId, idRoot, locale);
  if (!button) return null;
  if (button.customId === `${idRoot}_cancel`) {
    await phase.useButton(button).replace(
      buildPersonaWorkflowNotice({
        locale,
        titleKey: "general.interaction.cancel_title",
        descriptionKey: "general.pagination.cancelled",
        color: ColorCode.WARN,
      }),
    );
    return null;
  }
  const index = Number.parseInt(button.customId.replace(`${idRoot}_`, ""), 10);
  const provider = savedProviders[index];
  if (!provider) {
    await phase.useButton(button).replace(
      buildPersonaWorkflowNotice({
        locale,
        titleKey: "general.errors.invalid_option_title",
        descriptionKey: "general.errors.invalid_option_description",
        color: ColorCode.ERROR,
      }),
    );
    return null;
  }
  return { button, provider: provider.provider.toLowerCase() };
}

/**
 * Opens the model-selection modal on the canonical message from `button`, routing the
 * `>25` case through the canonical range selector automatically. Returns the submitted
 * modal phase, or null when the flow ended without a submit — cancel and timeout are
 * rendered in place by the bridge; a transport error renders the generic error notice.
 */
export async function openCanonicalModal(
  phase: CanonicalPrivateWorkflowPhase,
  button: ButtonInteraction,
  locale: string,
  modalOptions: ModalOptions,
): Promise<PersonaWorkflowModalPhase | null> {
  const result = await phase.useButton(button).openModal(modalOptions);
  if (result.outcome === "submitted") return result.phase;
  // Cancel and timeout already rendered a terminal notice; only transport errors need one.
  if (result.outcome === "error" || result.outcome === "fatal") {
    await phase.message
      .replace(
        buildPersonaWorkflowNotice({
          locale,
          titleKey: "general.errors.unknown_error_title",
          descriptionKey: "general.errors.unknown_error_description",
          color: ColorCode.ERROR,
        }),
      )
      .catch(() => undefined);
  }
  return null;
}
