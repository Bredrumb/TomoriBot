---
title: "Adding a Setup Module"
sidebar:
  label: "Adding a Setup Module"
---

Setup modules live in `scripts/setup/registry.ts` and are exposed through
`bun run setup`.

## When to Add One

Add a setup module when a feature has repeatable local install or configuration
steps that are useful outside normal app startup. Good candidates include:

- creating local venvs or downloading local assets
- writing optional `.env` values
- checking/installing local helper packages
- printing guided OS, Docker, Discord, or external-service steps

Do not move runtime orchestration into setup. `scripts/devtools/launch.ts` starts
already-installed sidecars. Setup should create the local prerequisites that launch
expects.

## Contract

Add an entry to `SETUP_MODULES`:

```ts
{
  id: "web-example",
  label: "Example sidecar",
  category: "web",
  summary: "Configure the local example sidecar.",
  docPath: "docs/self-hosting/example.md",
  async run(ctx) {
    // Do setup work, then return "done", "guided", or "skipped".
    return "done";
  },
}
```

Use the existing categories unless the menu truly needs a new group:

- `database`
- `aitools`
- `voice`
- `web`
- `monitoring`
- `integration`

## Guidelines

- Keep modules idempotent. Re-running setup should not destroy real user values.
- Use `scripts/lib/envFile.ts` for `.env` edits so comments and key order are preserved.
- Use `scripts/lib/prompt.ts` for interactive input.
- Spawn existing scripts when they are CLI-shaped; do not import scripts that call `process.exit()`.
- Print guided fallback commands when automation depends on missing local tools.
- Do not persist temporary access tokens unless the runtime needs them.
- Update `docs/self-hosting/setup-wizard.md` and docs indexes when adding user-visible modules.

Run the relevant validation after changes:

```bash
bun run check
bun run lint
```
