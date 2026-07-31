---
title: "Code Comment Policy"
---

Comments should explain information that the code cannot express clearly: rationale,
constraints, invariants, compatibility behavior, security boundaries, or surprising
ordering requirements. Do not translate the next statement into English.

## Keep

Keep a comment when removing it would hide useful context, such as:

- why an operation must happen before or after another operation;
- a provider or platform quirk that the implementation works around;
- a security, cache, interaction-timing, or compatibility constraint;
- a non-obvious fallback and the condition that makes it safe;
- a suppression with a concrete reason; or
- an ordered JSDoc procedure whose order is part of the exported contract.

```ts
// Discord rejects a second acknowledgement, so modal branches return before deferral.
if (opensModal) return showModal();
```

## Remove or rewrite

Remove comments that only name the statement below them:

```ts
// Parse and validate composite-key format
const parsedKey = parseCompositeKey(compositeKey);
```

Prefer a clear function or variable name. If important context exists, state that context
instead of narrating the operation.

Also avoid:

- procedural labels such as `// 1. Parse the value` or `// 5c-2. Build the menu`;
- prompt-style scaffolding such as `// Rule 3: Validate input`;
- decorative section banners;
- commented-out code; and
- prose em dashes, en dashes, or spaced double hyphens. Use punctuation that makes the
  relationship explicit.

Numbered JSDoc lists remain valid when they describe a genuinely ordered public contract.
Ordinary line comments should not carry step numbers.

## Maintainer audit

```bash
bun run audit-comments
```

`audit-comments` is an occasional maintainer tool, similar to the locale-pruning audit.
It reports subjective narration candidates across the existing tree without failing.
It is deliberately absent from the validation pipeline and normal test runner, so
contributors do not need to resolve heuristic findings as part of unrelated work.

Maintainers can invoke `scripts/checks/checkCommentPolicy.ts` directly for deterministic
checks or pass `--staged` or `--base <ref>` to focus the narration heuristic on changed
lines. Its focused self-test is also manual:

```bash
bun test scripts/checks/commentPolicy.test.ts
```

## Exceptions

Literal syntax and live-rule references sometimes contain text that resembles a violation.
Record only those narrow cases in
`scripts/checks/comment-policy-exceptions.json`, including the exact comment and a reason.
The checker reports an exception as stale once the matching comment disappears.

Do not use the exception file as a catalogue of comments removed in past cleanups. Git
history is the durable record for those edits; the exception list exists only for current,
intentional violations.
