/**
 * Neutral entry point for the **canonical one-message workflow** engine — the
 * persona-agnostic controller that renders a whole picker → selector → modal → result
 * flow on a single ephemeral message edited in place.
 *
 * New non-persona callers (e.g. the `/model *` command family) import the canonical API
 * from here rather than from `personaWorkflow.ts`, so no caller has to reach into a
 * persona-named module for a generic mechanism. The engine's implementation still lives
 * in `personaWorkflow.ts` alongside `runPersonaPickerWorkflow` (its persona specialization);
 * a full physical relocation of the generic surface into this file is tracked as a
 * Phase 4.0a follow-up. The class itself is already persona-neutral: `CanonicalMessageController`.
 *
 * The persona picker (`runPersonaPickerWorkflow`) is a specialization of this same engine
 * and continues to be imported from `personaWorkflow.ts`.
 */
export {
  beginCanonicalPrivateWorkflow,
  buildPersonaWorkflowNotice,
  isCollectorTimeoutError,
  PERSONA_WORKFLOW_COMPONENT_TIMEOUT_MS,
  MIGRATED_CANONICAL_CALLERS,
  PRE_CANONICAL_PRIMITIVES,
} from "./personaWorkflow";

export type {
  CanonicalPrivateWorkflowPhase,
  PersonaWorkflowComponentsV2Payload,
  PersonaWorkflowInPlacePhase,
  PersonaWorkflowMessageController,
  PersonaWorkflowModalPhase,
  PersonaWorkflowModalResult,
  PersonaWorkflowNestedButtonPhase,
  PersonaWorkflowUpdateError,
} from "./personaWorkflow";
