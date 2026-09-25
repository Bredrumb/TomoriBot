---
name: lint-prose
description: Remove AI writing patterns from TomoriBot prose. Use when writing or reviewing Markdown under docs/, contributor guides, code comments, JSDoc, locale strings, commit messages, or pull request bodies.
---

# Lint prose

This skill does not exist to hide that an AI helped write something. It exists because generated
prose is slow to read: it circles a point, frames it, and restates it before saying it. A contributor
reading a guide or a comment needs the fact, the constraint, or the instruction, stated plainly
enough that someone new to the codebase follows it on the first read.

Edit the prose to that standard. Preserve meaning and the intended tone.

This skill governs how prose reads. What deserves a comment at all is decided by
`docs/en/contributing/policies/comments.md`, and where a page belongs by
`docs/en/contributing/localization/docs-authoring.md`.

## Process

1. For Markdown, run `bun run audit-comments --docs <file>` for a first pass. It runs slop-guard with
   `slop-guard.jsonl` in this folder, which keeps only the rules that proved precise on this
   repository, plus plain-word patterns for rules 6, 11, and 20. Findings cite the rule numbers below.
   It needs `uv` for slop-guard and runs only the repository patterns without it. The slop-guard MCP
   server's `check_slop_file` uses the unfiltered defaults, which also penalize checklists and tables,
   so treat its extra findings as candidates only. The rules below win where they disagree.
2. Scan for the patterns below.
3. Rewrite, then ask what still makes the text read as generated, and fix that.

## Scope

Exempt: persona-voiced locale strings and seed dialogue, where "Of course!" can be correct in
character; quoted output from another system; and text that code must reproduce exactly.

## Patterns

Rule numbers are stable IDs that tools and reviews cite. A removed rule leaves a gap; never renumber.

### Content

1. **Superficial -ing phrases.** "highlighting...", "ensuring...", "reflecting...", "showcasing...".
   Delete, or state the concrete effect.
2. **Vague attributions.** "Experts believe", "It is widely known". Name the source or delete.
3. **Say what it does, not how it feels.** "types that follow your schema" names a feeling; "a column
   rename fails the build" names the mechanism. If a sentence could appear unchanged in another
   project's docs, it says nothing about this one. Cut it.
4. **Generic conclusions and summaries.** Closing sentences that restate the page or assert vague
   value ("This keeps things flexible"). End on a specific fact, or cut the closing entirely.

### Language

5. **AI vocabulary.** Additionally, crucial, delve, enduring, enhance, fostering, garner, interplay,
   intricate, landscape (abstract), pivotal, robust, seamless, showcase, tapestry, testament,
   underscore, vibrant. Use the plain word.
6. **Fancy ways to say "is".** "serves as", "stands as", "boasts", "features". Say "is" or "has".
7. **"Not X" contrasts.** "Not just X, but Y", "not X, it's Y", and "Y, not X". State the rule, then
   decide what the negated half is doing:
   - If no reader would do X, delete it: "Assert on the returned value, not only that the call did
     not throw" becomes "Assert on the returned value."
   - If readers do X, name the consequence in its own sentence: "Assert on the returned value. A test
     that only checks the call did not throw passes when the query returns the wrong rows."
   - If it separates two similar things, define the one you mean with an example: "`apiFamily` names
     the wire protocol, such as `openai-compatible`."
8. **Rule of three.** Forcing items into groups of three. Use the natural number.
9. **Synonym cycling.** Persona, character, bot identity, and avatar for one thing in one paragraph.
   Pick the product term and repeat it.
10. **False ranges.** "from X to Y" where X and Y are not on a scale. List the items.
11. **Plain words.** utilize, leverage, facilitate, numerous, in the event that: use, use, help,
    many, if.
12. **Abstract metaphor nouns.** substrate, wedge, vector, locus, nexus, paradigm, north star,
    flywheel, gold-plating, endgame. Established technical terms are fine where they are literal: a
    test harness, an attack surface, an API.

### Style

13. **Dashes.** Follow the repository dash rule: replace a prose em dash, en dash, or spaced double
    hyphen with the punctuation that names the relationship (colon, `, so`, parentheses, period,
    semicolon). In `ja`, use `：`, `。`, `（）`.
14. **Dramatic colons.** A colon used as a drumroll before a reveal. A colon before a list, an example,
    or an explanation of the first half is correct.
15. **Bold and code spans.** Write a label the user sees on screen as a code span: a button, select
    option, modal field, or Discord setting (`Finish Setup`, `Manage Server`). In a translated page,
    the span holds that locale's UI text, not the English label. Use bold only for a list item's
    lead-in label, never for emphasis or for product names; if a word needs stress, rewrite the
    sentence.
16. **Inline-header lists.** A bold label and colon that restates the line ("**Performance:**
    Performance improved"). Write the line as prose. A bold lead-in that names the item and is followed
    by new detail is fine.
17. **Title case headings.** Use sentence case.
18. **Decorative emojis.** Remove from headings and bullets.
19. **Curly quotes.** Use straight quotes in English and code-adjacent text.

### Filler

20. **Filler phrases.** "In order to" becomes "To". "Due to the fact that" becomes "Because". "It is
    important to note that" is deleted.
21. **Excessive hedging.** "could potentially possibly" becomes "may".
22. **Adverb props.** "significantly improves" becomes the measured delta; "runs quickly" becomes the
    number.

### Readability

23. **Dense sentences.** If the reader has to backtrack, split the sentence. One idea per sentence.
24. **Passive voice.** Name the actor: "the loader parses the file". Passive is fine when the actor is
    unknown or irrelevant.
25. **Figurative descriptions of technical behavior.** Phrases that attribute action or state to
    an abstraction ("the plan holds it", "rides along with the request") hide the real mechanism.
    Rewrite so the sentence names what actually happens.
26. **Over-compression.** Dropped articles, verbless fragments, arrows, and private abbreviations.
    "Parser rejects bad date → exit 2" becomes "The parser rejects a bad date and exits with code 2."
    Tables and checklists may stay terse; running prose may not.

### Plain description

27. **Indirect labels for direct things.** If a term is a borrowed metaphor or jargon name for
    something that has a plain description, use the plain description. "North star" becomes "the
    goal this feature optimizes for". "Deep dive" becomes "detailed explanation". "Happy path"
    becomes "the case where every step succeeds".
28. **Category words instead of specific ones.** Terms like "hook", "boundary", or "layer" stand
    in for something concrete. Name the actual thing: the function Discord calls when a message
    arrives, the point in the call chain where user input is validated, the set of middleware that
    runs before the handler. Don't use a category word where a precise noun fits.
29. **Setup sentences.** Don't announce what you are about to say before saying it. "This section
    explains the caching model" before explaining the caching model is wasted. State the thing,
    then the reason if the reason adds something the thing alone does not.
30. **Project-internal terms.** A term that only makes sense after reading other pages is not
    self-contained. On first use in a page, define it in plain language or link the page that
    defines it.
