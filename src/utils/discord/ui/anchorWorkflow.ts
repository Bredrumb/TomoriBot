/**
 * Neutral entry point for the **anchor one-message workflow** engine: the
 * persona-agnostic controller that renders a whole picker → selector → modal → result
 * flow on a single ephemeral message edited in place.
 *
 * New non-persona callers (e.g. the `/model *` command family) import the anchor API
 * from here rather than from `personaWorkflow.ts`, so no caller has to reach into a
 * persona-named module for a generic mechanism. The engine's implementation still lives
 * in `personaWorkflow.ts` alongside `runPersonaPickerWorkflow` (its persona specialization).
 *
 * **Keep it that way.** The persona specialization (`createSelectionPhase`,
 * `normalizeSelectedPersona`, `runPersonaPickerWorkflow`) calls about ten intentionally
 * private engine helpers: `noticePayload`, `awaitWorkflowButton`, `createModalPhase`,
 * `openModalWithBridge`, the `AnchorMessageController` class, the `logWorkflow*` family.
 * Moving the generic half into this file would mean exporting every one of them just so a
 * sibling module could reach it, while `scripts/checks/lib/personaWorkflowBoundary.ts` exists
 * to keep exactly those internals unreachable. This module already provides the neutral
 * import path, which is the point.
 *
 * The persona picker (`runPersonaPickerWorkflow`) is a specialization of this same engine
 * and continues to be imported from `personaWorkflow.ts`.
 */
export {
  beginAnchorPrivateWorkflow,
  buildPersonaWorkflowNotice,
} from "./personaWorkflow";

export type {
  PersonaWorkflowInPlacePhase,
  PersonaWorkflowMessageController,
} from "./personaWorkflow";
/**
 * Neutral names for the engine's generic types.
 *
 * The underlying types still carry the `PersonaWorkflow*` prefix from when the engine was
 * persona-only. Renaming them outright is not worth it, so most occurrences are in persona
 * commands, where the persona-flavoured name is the correct one.
 *
 * **New non-persona callers should prefer these names.** The `PersonaWorkflow*` exports
 * above stay for existing callers and are not deprecated.
 *
 * These are **type-only** aliases on purpose. Re-exporting a runtime value here would add an
 * import edge that every consumer: including unit tests that stub `personaWorkflow`: has to
 * satisfy. Code needing `PersonaWorkflowUpdateError` as a value imports it from
 * `personaWorkflow.ts` directly.
 */
