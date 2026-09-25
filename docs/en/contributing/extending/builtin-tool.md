---
title: "Adding a Built-In Tool"
sidebar:
  order: 10
---

How to add a tool the model can call during the tool loop. `toolInitializer.ts` discovers it at
startup, so there is no registration step.

## Steps

1. Create a file in `src/tools/functionCalls/` exporting a class that extends `BaseTool`.
2. Define `name` (unique across all tools), `description` (shown to the model, in English),
   `category`, `parameters` (JSON Schema), and `execute()`.
3. Add optional members as needed: `requiresFeatureFlag` (see
   [Adding a Feature-Flagged Tool](/contributing/extending/feature-flag-tool/)), `requiresPermissions`,
   and `requiresFollowUp` when the result needs another generation turn.
4. Pass `context.abortSignal` to every HTTP call: `signal` for `fetch`, `externalSignal` for
   `safeDownload`, and any helper option that takes an `AbortSignal`. Otherwise `/kill` stops the turn
   but the request keeps running.

## Verify

Run `bun run check` and `bun run lint`, then prompt the bot so it calls the tool and check the
tool-loop logs. How tools are dispatched: [Tool loop](/architecture/pipelines/tool-loop/).
