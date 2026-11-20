---
title: "Code Comment Policy"
sidebar:
  order: 40
aiGenerated: true
---

A comment carries a fact the code cannot state. Before writing one, name the criterion that
justifies it. If none fits, write no comment and improve the name, type, or function boundary
instead.

## Keep criteria

- **a.** External behavior of Discord, an LLM provider, a protocol, or a library.
- **b.** A security, privacy, or redaction reason.
- **c.** A cache, ordering, transaction, or acknowledgement invariant, including anything that must
  happen before slow work.
- **d.** Why a constant has its value, or what a sentinel or dense pattern means. A name already says
  what a constant is for, so a comment that repeats it goes.
- **e.** A measured performance tradeoff.
- **f.** Why a lint or type suppression cannot be removed.
- **g.** A constraint someone could break while simplifying the code.
- **h.** A constraint learned from production or debugging. Write only the constraint; the story of
  finding it belongs in the commit message.

```ts
// Discord rejects a second acknowledgement, so modal branches return before deferral.
if (opensModal) return showModal();
```

When unsure, omit the comment and make the name, type, or function boundary carry the meaning.

## Never write

- The next statement in English: `// Parse and validate composite-key format` above
  `parseCompositeKey(...)`.
- A restated function, type, variable, or parameter name.
- Step numbers (`// 1. Parse the value`, `// 5c-2. Build the menu`) or `// Rule 3:` scaffolding.
- Section banners or dividers; extract a named function instead.
- Commented-out code.
- What the code used to do, a line number, or an old phase or task label.
- Incident history ("added after last quarter's outage"). Git history holds it.
- Point-in-time measurements ("31k entries", "adds ~40 ms"). They read as current and go stale.
- Commentary about the comment ("Two exclusions are load-bearing", "Important:").
- Justification aimed at a reviewer. That belongs in the PR description.

Keep each comment to one sentence. A new comment may wrap over two lines.

```ts
// Never sweep the client's own member: discord.js resolves permissions through it.
```

Examples in docs are illustrative. Deployment sizes, record counts, and host details do not belong in
this public repository (see [Docs Authoring](/contributing/localization/docs-authoring/#audience)).

## No JSDoc

Use TypeScript types and names to describe declarations. Preserve a constraint that protects against
an actual bug in a single `//` sentence. The single-line `/** @public <caller> */` directive is
allowed for Knip exemptions on release-only or dynamically imported exports.

## Dashes

Em dashes, en dashes, and spaced double hyphens are not allowed in authored prose: comments, JSDoc,
pages under `docs/`, and user-facing strings in `src/locales/`. Replace each with punctuation that
names the relationship between the two halves:

| Relationship | Use | Example |
|---|---|---|
| Second half explains the first | Colon | `Retirement is process-local: a restart refetches every guild's stickers.` |
| Cause | `, so` or `because` | `Discord rejects a second acknowledgement, so modal branches return early.` |
| Aside | Parentheses | `The probe caches its own failure (until the next restart).` |
| Independent clauses | Period or semicolon | `The webhook send failed. The bot path is the fallback.` |
| Term and definition | Colon | `` `large-v3`: ~4-5 GB VRAM `` |
| Numeric range | Plain hyphen | `1-5 minutes` |

If none fits, the sentence is doing two things; split it. Japanese text uses `：`, `。`, and `（）`.
A dash that is data stays: a CLI flag (`--no-build-isolation`), Discord's `-# ` marker, a URL, or
quoted output from another system.

## The checker

```bash
bun run audit-comments                  # full-tree audit, plus the new-comment rules on your uncommitted work
bun run audit-comments --docs [paths]   # prose audit of Markdown, default docs/en/contributing
bun test ./scripts/checks/commentPolicy.test.ts
```

`scripts/checks/checkCommentPolicy.ts` runs deterministic rules that fail in any mode, and heuristic
rules that warn. `--staged` or `--base <ref>` also judges changed lines: `--base` covers everything
since the merge base with `<ref>`, including uncommitted and untracked files, and `audit-comments`
passes `--base HEAD`. On changed lines, `obvious-narration` becomes an error and the new-comment rules
apply. A block counts as new when most of its lines changed, so a small edit inside an older block
does not trigger them. Errors fail `bun run vl` (under Documentation); the checker is not part of the
test runner.

| Rule | Kind | Catches |
|---|---|---|
| `prose-dash` | Error | Dashes in comments, `docs/` Markdown, and `src/locales/` string literals. Skips code, URLs, link targets, CLI flags, `-# `, and empty table cells |
| `disallowed-jsdoc` | Error | JSDoc blocks except single-line Knip directives and license headers |
| `numbered-narration` | Error | Step numbers on line comments |
| `rule-scaffolding` | Error | `Rule N:` and `Rule #N` prefixes |
| `obvious-narration` | Warning (error on changed lines) | Action-verb narration and section banners |
| `orphaned-comment` | Error | Cleanup damage: a continuation with no opening line, a bare divider, an empty JSDoc block |
| `duplicate-comment` | Audit warning | Blocks with the same text after normalizing markers, whitespace, and case. Floor: 12 words and 60 characters |
| `long-comment-block` | Audit warning | A non-JSDoc block of 8 lines or more outside `tests/` |
| `long-new-comment` | Error on changed lines | A new comment over 2 lines |
| `new-multi-sentence` | Error on changed lines | A new line-comment block with multiple sentences |
| `unexplained-comment` | Warning on changed lines | A new `//` block with no reason, condition, or unit signal (`because`, `so`, `when`, a colon, and similar) |

A locale tree counts as one identity for `duplicate-comment`, so an English comment copied into every
translated tree reports once. Suppression comments are skipped because each one is a separate lint
decision.

`COMMENT_AUDIT_DUPLICATE_MIN_WORDS`, `COMMENT_AUDIT_DUPLICATE_MIN_CHARS`, and
`COMMENT_AUDIT_LONG_BLOCK_LINES` override the limits for recalibration only. The bot never reads them,
and a value that is not a whole positive number falls back to the default. The limits were chosen so
that the full report stays readable in one sitting. When it stops being readable, re-measure; never
delete rationale to shrink the count.

## Working through findings

Treat a finding as a prompt to review. For each one, read the whole block and
the code it describes. Remove it only when the code already says everything in it; otherwise rewrite
it down to the constraint. Then re-read the surrounding lines for orphaned continuations and empty
JSDoc, and review the diff as prose. Clear most duplicate groups by extracting the code path the
copies share; deleting the copies loses the rationale.

## Exceptions

`scripts/checks/comment-policy-exceptions.json` records current, intentional matches only, such as
literal syntax that resembles a violation, each with the exact comment and a reason. The checker
reports an exception as stale once its comment is gone. It is not a log of past cleanups.
