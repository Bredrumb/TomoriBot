---
title: "Adding a Setup Module"
sidebar:
  label: "Adding a Setup Module"
---

Setup modules live in `scripts/setup/registry.ts` and run only as part of
`bun run setup --full`.

## When to Add One

Add a Full Install module only for lightweight, broadly useful prerequisites that
make a normal self-host install better without turning the wizard into an
integration launcher. Good candidates include:

- enabling optional local database extensions
- downloading local assets used by core model behavior
- checking/installing small local helper packages
- printing guided fallback commands when automation cannot finish safely

Do not add heavyweight sidecars, local voice servers, monitoring stacks, or external
service bridges to the setup wizard. Keep those in their dedicated docs and launch
flows.

## Contract

Add an entry to `SETUP_MODULES`, then add its id to `FULL_INSTALL_MODULE_IDS`:

```ts
{
  id: "example-helper",
  label: "Example helper",
  async run(ctx) {
    // Do setup work, then return "done", "guided", or "skipped".
    return "done";
  },
}
```

## Guidelines

- Keep modules idempotent. Re-running setup should not destroy real user values.
- Use `scripts/lib/envFile.ts` for `.env` edits so comments and key order are preserved.
- Use `scripts/lib/prompt.ts` for interactive input.
- Spawn existing scripts when they are CLI-shaped; do not import scripts that call `process.exit()`.
- Print guided fallback commands when automation depends on missing local tools.
- Do not persist temporary access tokens unless the runtime needs them.
- Update `docs/self-hosting/setup-wizard.md` when changing Full Install behavior.

Run the relevant validation after changes:

```bash
bun run check
bun run lint
```
