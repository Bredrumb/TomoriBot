# Contributing to TomoriBot

Thanks for your interest in contributing! This guide covers what you need to know before opening a PR. For local setup (database, providers, Discord token), see [`docs/core/getting-started.md`](../docs/core/getting-started.md).

## Branching

| Branch | Purpose |
|---|---|
| `main` | Default branch, fork from here, target PRs **here** |
| `release` | Deploy gate, maintainers cut this from `main`. Do not target it. |
| `dev` | Maintainer's personal (unstable) development branch, not a contribution target |

## Quality Gates

The project has no strict coding standards other than what `bun run check` and `bun run lint` enforce. Run these locally before pushing (CI will also enforce them on your PR):

```bash
bun run check   # TypeScript strict, no unused vars
bun run lint    # Biome (2-space indent, double quotes)
```

If you touched the database schema, also run these locally before pushing:

```bash
bun run check-schema  # schema drift check
bun run vl-db         # lifecycle validation
```

Again, CI handles them automatically but running them locally saves time.

## Scope of Contributions

Welcome without prior discussion:

- Bug fixes with a clear repro
- Locale corrections or new translations
- New built-in tools or LLM providers that follow the existing adapter pattern
- New top-level slash commands
- Performance improvements (no behavior change)

Please open an issue first to discuss:

- Architecture or schema changes
- Changes to caching, security, or persona-identity behavior
- New external integrations (Matrix, SillyTavern-style imports, etc.)

## License

TomoriBot is licensed under **AGPL-3.0**. By submitting a contribution, you agree it will be licensed under AGPL-3.0. AGPL requires source disclosure to users of network-deployed modified versions — please understand this before contributing or self-hosting a fork.

## Security

Do **not** open public issues for security vulnerabilities. See [`SECURITY.md`](./SECURITY.md) for the private reporting process.
