## Summary
_What does this change and why? Link to issues/discussions for deeper context if possible._

Closes # <!-- Replace # with issue number, or remove this line if not applicable -->

## Type(s)
<!-- Mark with an x inside the parens, e.g. (x). Not GFM checkbox syntax on
purpose: keeps this out of GitHub's task-list progress counter, since it's
a single-select classification, not a to-do. -->
- ( ) Bug Fix
- ( ) Feature
- ( ) Refactor / Chore

## Quality Gates
<!-- Mark with an x inside, e.g. (x). -->
- [ ] `bun run vl` output shows no critical failures
- [ ] Manually tested changes on Discord

### Only when relevant
No need to mark if irrelevant
- ( ) No hardcoded operational limits/timeouts (use env vars, document in `.env.optional.example`)
- ( ) Followed command patterns and conventions in [`docs/architecture/subsystems/command-system.md`](../docs/architecture/subsystems/command-system.md) (If adding or modifying a Discord Command) 
- ( ) Updated the matching [`docs/`](../docs/) page(s) (If behavior/flow/schema/config changed) 
- ( ) Used `localizer()` with an en-US key, not a hardcoded string (If adding or changing user-facing text) 

## Testing
_What was manually verified? Include commands run, Discord tests, edge cases hit, etc._

## Reviewer Notes
_Anything subtle, non-obvious, or worth calling out for maintainer review._

#### _Feel free to add more sections if needed_