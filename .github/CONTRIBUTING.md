# Contributing to TomoriBot

Thanks for your interest in contributing! This guide covers what you need to know before opening a PR.

## Branching

| Branch | Purpose |
|---|---|
| `main` | Default branch, fork from here, target PRs **here** |
| `release` | Deploy gate, stable versions that reflect the public deployed TomoriBot. |

Cloud deployment code lives on `release` only. Changes belong on `main` and flow forward into `release`. Never merge `release` into `main`.

## Quality Gates

The coding conventions in [Development Tasks](https://docs.tomoribot.app/en/contributing/development-tasks/) apply to all source code. The automated gates enforce part of it; reviewers check the rest. The [Architecture](https://docs.tomoribot.app/en/architecture/) docs explain the flows and invariants behind conventions.

Please refer to the [Pull Request Template](./pull_request_template.md) for the exact list of local checks you should run before submitting a PR. CI handles these automatically, but running them locally and fixing any problems saves time. 

If your PR is too big (around ~1000 lines of changes/additions), please split it up into multiple, smaller PRs instead if possible so it is easier to discuss and test.

### AI-Generated Code
This project accepts code assisted by AI tools, guided by [`AGENTS.md`](../AGENTS.md) with `.agents/skills/` holding project-specific workflows. But just like all tools, the one using it (you) is responsible for it. Please test and review thoroughly before opening a PR, and be ready to discuss and fix problems that the maintainer(s) find, if any.

### Translations
You do not have to keep every user-facing string/locale up to date. Author your strings in `src/locales/en-US/` and you are done: other locales render the English value for any key they do not define, so `en-US` alone is enough to merge. Translating the string yourself is welcome but optional.

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

TomoriBot is licensed under **AGPL-3.0**. By submitting a contribution, you agree it will be licensed under AGPL-3.0. AGPL requires source disclosure to users of network-deployed modified versions. Please understand this before contributing or self-hosting a fork.

## Security

Do **not** open public issues for security vulnerabilities. See [`SECURITY.md`](./SECURITY.md) for the private reporting process.
