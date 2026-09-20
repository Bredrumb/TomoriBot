---
title: "Adding an Environment Variable"
---

This guide covers when and how to add an environment variable to TomoriBot, how to choose
its tier in `.env.optional.example`, and the naming and formatting standards required.

## When to Use an Environment Variable

Not every configurable setting belongs in an environment file. Use this decision tree before adding a variable:

| Target Location | Use Case | Examples |
|---|---|---|
| PostgreSQL (Slash Command / Model / Server Setting) | Per-server or per-user configurations that administrators or members change at runtime. | Channel whitelists, persona prompts, temperature overrides, server prefixes. |
| `.env.example` | Core required credentials and endpoints without which the bot cannot boot. | `DISCORD_TOKEN`, `DATABASE_URL`. |
| `.env.optional.example` | Global operational limits, timeouts, feature flags, cache lifetimes, and opt-in integrations. Every variable here must have a safe working default in code. | `WEB_SEARCH_TIMEOUT_MS`, `MAX_DOCUMENT_SIZE_MB`. |
| Code Constant (`src/constants/` or module-local) | Fixed architectural invariants, protocol constraints, or Discord API limits that cannot be safely tuned. | Discord interaction token 15-minute window, modal text input limits. |

## The Eight-Tier Taxonomy

Optional variables in `.env.optional.example` are organized into eight tiers, ordered by how frequently an administrator tunes them:

1. **Tier 1: Bot Identity and Everyday Behavior**: Knobs that shape what Tomori says or how she behaves without altering infrastructure (e.g. trigger words, emoji penalty, short-term memory depth).
2. **Tier 2: Optional Features and Integrations**: Opt-in external services where leaving the variable unset disables the whole feature (e.g. Matrix bridge, S3 storage, external search APIs, Documents and RAG, MCP servers).
3. **Tier 3: Self-Hosted Sidecars and Local Services**: Settings for optional local AI containers, TTS sidecars (Fish Audio S2, VoxCPM2, CosyVoice 3, Chatterbox, MOSS, Irodori), Crawl4AI, SearXNG, and ComfyUI.
4. **Tier 4: AI Providers and Models**: Per-provider LLM and image generator tuning (e.g. Gemini max output tokens, OpenRouter safety factors, NovelAI parameters, tool-loop execution bounds).
5. **Tier 5: Limits and Quotas**: Caps on counts, sizes, payload lengths, and rates (e.g. memory counts, import archive limits, cooldowns, media attachment byte limits).
6. **Tier 6: Caches, TTLs, and Component Timeouts**: Cache lifetimes, interactive component expiration, and lock cleanup (e.g. user cache TTL, channel lock timeout, button interactive durations).
7. **Tier 7: Diagnostics and Development Tooling**: Knobs that only matter with a debugger attached, during local testing, or in CI pipelines (e.g. verbose fetch logging, test database credentials, `bun run vl` gate limits).
8. **Tier 8: Production Hosting and Operations**: Sizing, pool recycling, PSI pressure detection, and metrics sinks needed in dedicated 24/7 production hosts, a VPS, or cloud deployments (e.g. Azure, AWS).

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
// Example: parsing an optional integer with fallback
const TIMEOUT_MS = Number.parseInt(process.env.EXAMPLE_TIMEOUT_MS || "5000", 10);

// Example: parsing an optional boolean flag
const FEATURE_ENABLED = process.env.ENABLE_EXAMPLE_FEATURE === "true";
```

## Quality Gate

Run these checks after updating `.env.optional.example` and code:

```bash
bun run check    # TypeScript validation
bun run lint     # Biome lint and formatting
```

## Related Docs

- [`docs/en/contributing/development-tasks.md`](./development-tasks): general coding standards and gate checklist
- [`docs/en/contributing/comment-policy.md`](./comment-policy): durable comment conventions and prose dash prohibition
- [`docs/en/wiki/production-tuning.md`](../wiki/production-tuning): deep operational rationale for Tier 8 production settings
