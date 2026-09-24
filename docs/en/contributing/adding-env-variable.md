---
title: "Adding an Environment Variable"
---

This guide covers when and how to add an environment variable to TomoriBot, how to choose
its tier in `.env.optional.example`, and the naming and formatting standards required.

## When to Use an Environment Variable

A named code constant is the default. An environment variable represents a deployment boundary: a
value that reasonably differs between installations because of the host, the network, or an
external service. Pick the first row that fits:

| Target Location | Use Case | Examples |
|---|---|---|
| PostgreSQL (Slash Command / Model / Server Setting) | Per-server or per-user configurations that administrators or members change at runtime. | Channel whitelists, persona prompts, temperature overrides. |
| `.env.example` | Core required credentials and endpoints without which the bot cannot boot. | `DISCORD_TOKEN`, `DATABASE_URL`. |
| `.env.optional.example` | Host resources, network behavior, external service credentials or quotas, opt-in integrations, and operator choices that reasonably vary between installations. Every variable here must have a safe working default in code. | `WEB_SEARCH_TIMEOUT_MS`, `MAX_DOCUMENT_SIZE_MB`. |
| Code constant (module-local, or `src/constants/` when shared) | Everything else: internal probabilities, parser lookbacks, UI geometry, algorithm tuning, protocol constraints, and Discord API limits. | Discord interaction token 15-minute window, modal text input limits. |

Promote a constant to a variable only when you can name the deployment that needs a different value.
Give each setting one variable; an engine-specific variable plus a shared fallback for the same value
is two names to document and debug for one knob.

## The Seven-Tier Taxonomy

Optional variables in `.env.optional.example` are organized into seven tiers, ordered by how frequently an administrator tunes them:

1. **Tier 1: Bot Identity and Everyday Behavior**: Knobs that shape what Tomori says or how she behaves without altering infrastructure (e.g. trigger words, the `EMOJI_PENALTY_ENABLED` switch, reaction context).
2. **Tier 2: Optional Features and Integrations**: Opt-in external services where leaving the variable unset disables the whole feature (e.g. Matrix bridge, S3 storage, external search APIs, Documents and RAG, MCP servers).
3. **Tier 3: Self-Hosted Sidecars and Local Services**: Settings for optional local AI containers, TTS sidecars (Fish Audio S2, VoxCPM2, CosyVoice 3, Chatterbox, MOSS, Irodori), Crawl4AI, SearXNG, and ComfyUI.
4. **Tier 4: AI Providers and Models**: Per-provider LLM and image generator tuning (e.g. Gemini max output tokens, provider request timeouts, and the turn timeouts: tool execution, SDK call, and channel lock).
5. **Tier 5: Limits and Quotas**: Caps on counts, sizes, payload lengths, and rates (e.g. memory counts, import archive limits, media attachment byte limits, the command cooldown scale).
6. **Tier 6: Diagnostics and Development Tooling**: Knobs that only matter with a debugger attached, during local testing, or in CI pipelines (e.g. verbose fetch logging, test database credentials, `bun run vl` gate limits).
7. **Tier 7: Production Hosting and Operations**: Sizing, pool recycling, PSI pressure detection, and metrics sinks needed in dedicated 24/7 production hosts, a VPS, or cloud deployments (e.g. Azure, AWS).

## Placement Rule: Tier the Section, Not the Variable

When adding a variable:

1. **Does it belong to an existing subsystem?** Put it in that subsystem's `## Section` block, even if the variable itself is a timeout, limit, or flag. Subsystems stay together in one block because administrators tune features as cohesive units.
2. **Is it a brand-new subsystem or integration?** Pick its tier using the first matching rule from the taxonomy above, create a new `## Section` block in that tier, and add your variable with documentation.

## Naming and Documentation Standards

Follow these rules when defining an environment variable:

- Use `UPPER_SNAKE_CASE` for variable names.
- Embed the unit in the variable name when applicable: `_MS`, `_SECONDS`, `_MINUTES`, `_HOURS`, `_DAYS`, `_MB`, `_BYTES`.
- Always document the unit and working default in the preceding comment unless the section banner already states them.
- Follow the repository comment policy: explain constraints and rationale, avoid restating the obvious, and avoid prose em dashes or en dashes.
- Provide a safe fallback in code so that running without the variable in `.env` works out of the box.

```ts
// Example: a deployment boundary, parsed with a code fallback for a bare checkout
const WEB_SEARCH_TIMEOUT_MS = Number.parseInt(process.env.WEB_SEARCH_TIMEOUT_MS || "15000", 10);

// Example: an opt-in switch whose unset state disables the feature
const FEATURE_ENABLED = process.env.ENABLE_EXAMPLE_FEATURE === "true";
```

## Auditing Variables with `env-doctor`

`bun run env-doctor` is a read-only inventory of every variable: where it is declared, which files
read it (TypeScript, Python, shell, PowerShell, Dockerfiles, Compose, and workflows), its documented
default next to its code fallback, and the Compose or Docker layers that override it.

```bash
bun run env-doctor                     # summary and diagnostics
bun run env-doctor --var MY_VARIABLE   # full evidence for one variable
bun run env-doctor --json              # machine-readable report
bun run env-doctor --no-live-env       # omit your .env names before sharing the output
```

After adding a variable, run `--var` on it and confirm the doctor finds your read and that the code
fallback matches the value in `.env.optional.example`. A mismatch shows up under **Conflicting
defaults**.

The diagnostics list variables declared but unread, read but undocumented, conflicting defaults,
several names feeding one setting, and live `.env` entries nothing reads. The doctor never prints a
live `.env` value, and it redacts every value of a variable whose name marks a credential.

Classification (`deployment`, `runtime-preference`, `algorithmic-invariant`, `dead`, or
`undecided`) is a review aid built from name patterns and `.env.optional.example` tiers. It is not a
removal verdict. `dead` means no file reads the name by any recognized route and every consumer
surface was scanned; deleting the variable still needs its owner's analysis of deployments and
operator docs. When a surface is missing, such as the release-only `deploy/` and `terraform/` trees
with no `release` ref available, the doctor reports `undecided` instead.

Static analysis cannot follow every read. When the report lists an **UNREGISTERED** dynamic read,
either give that read a literal name or register the site with its reason in
`scripts/devtools/envDoctor/policy.ts` (`REGISTERED_DYNAMIC_READS`). A variable read only by a
dependency, such as a cloud SDK, belongs in `LIBRARY_CONSUMERS` there.

## Quality Gate

Run these checks after updating `.env.optional.example` and code:

```bash
bun run check    # TypeScript validation
bun run lint     # Biome lint and formatting
```

## Related Docs

- [`docs/en/contributing/development-tasks.md`](./development-tasks): general coding standards and gate checklist
- [`docs/en/contributing/comment-policy.md`](./comment-policy): durable comment conventions and prose dash prohibition
- [`docs/en/wiki/production-tuning.md`](../wiki/production-tuning): deep operational rationale for Tier 7 production settings
