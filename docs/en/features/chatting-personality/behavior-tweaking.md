---
title: "Behavior Tweaking"
sidebar:
  order: 3
---

TomoriBot's behavior (what she is allowed to do and how she generates) is controlled by
`/config` > Permissions and `/config`, beyond personality ([Multiple Personas](/features/chatting-personality/multiple-personas/))
and knowledge ([Memory](/features/knowledge/memory/)). This page is a curated set of the high-value
knobs; every command is in the [Command Reference](/features/command-reference/).

## Capabilities: What She's Allowed to Do
<!-- anchor: capabilities-what-shes-allowed-to-do -->

`/config` > Plugins controls tools, context additions, and optional response review:

- **Available Tools**: image generation, sticker usage, thread creation, message management, user
  blocking, self-teaching, voice messages, and more. Each toggle is the feature flag that gates the
  matching tool (see [Tools & Extensions](/features/capabilities/tools-and-extensions/)), so turning
  off Tool Use disables all of them at once.
- **Context Additions**: personalization, emojis in replies, and time awareness. These only add
  information to her prompt, so they keep working when Tool Use is off.

Automatic STM summarization is a tool, but its toggle lives with the rest of the short-term memory
settings in `/config` > Behavior > Advanced Memory. Turn something off and she simply can't do it,
no matter what a user asks.

## Response drafting

Open `/config` > `Plugins` > `Response Drafting` to turn review On. It starts Off and applies to
every persona in that workspace, including queued replies and generated scenes. Guild managers
change guild settings; your DM workspace has its own settings.

When On, Tomori holds her reply while a reviewer checks its character voice and scene fit. The
reviewer can ask for one complete revision. Tool requests also enter review before execution;
rejected requests can receive a bounded correction. Successful actions are retained while the
reply is revised. Text still uses the usual persona identity, emoji handling, and formatting.
Review and revisions can increase response time and token cost; the page shows this in both states.

`Choose Reviewer Model` selects an eligible registered text model. `Use current response model`
uses the model and credentials actually answering, including your personal provider or a fallback.
A pinned reviewer uses the workspace's own registration and credentials. Text-only authors and
authors with Tool Use disabled can still use an eligible reviewer. An unsupported inherited model
shows `Unavailable`; choose a supported reviewer to enable detailed review.

`Set Prompt` edits the review instructions, up to 4,000 characters. `Use Default` restores the
persona-aware default. `Choose Rule Checker` selects an already registered compatible MCP checker,
or `None`. Its findings go privately to the reviewer, which decides whether they matter for this
character. The checker has no validated language/profile guarantee in this release.

`Choose Decisions Model` saves a Decision registration from `/providers`. Skipping detailed review
is inactive until each model and review rubric has labeled quality evidence. A saved selection
makes no paid Decision requests in this release. Custom prompts also keep skipping inactive.
Clearing either model restores reviewer inheritance or `None`; turning Off keeps your choices.

Review is optional quality checking. A refusal, unavailable model, timeout, incomplete evidence, or
exhausted review budget lets an otherwise valid reply or independent tool request continue under
ordinary application rules. Previously rejected actions stay blocked. `/kill` and follow-up
interruption discard held text. Files, voice, and remote posts receive review of their proposed tool
arguments; their generated media is outside the held-text review. Hidden generation and user
impersonation keep their existing paths. Provider judgment and checker usefulness still need human
evaluation. See [review data handling](/features/knowledge/data-handling/#response-drafting-selections).

## Expressions

Managers use `/expressions manage` to browse `Emojis`, `Stickers`, and `Customs` in an
ephemeral panel. Native categories include uninitialized assets and distinguish usable
assets from total assets. `/expressions initialize` classifies native assets automatically.
`Edit` changes their description and emotion; `Clear Info` clears that classification while
keeping the Discord asset and its usage history.

In `Customs`, choose `+ Add a custom expression`. Enter a name, description (up to 500
characters), and emotion, with exactly one link or file. Supported files are PNG, JPEG
(`.jpg` or `.jpeg`), WebP, GIF, and MP4, up to 10 MiB and Discord's applicable limit. MP4
requires H.264 video with 8-bit 4:2:0 pixels and optional AAC audio. Tenor share links stay
links; Discord media links are imported into storage. Other direct media links depend on
the external host remaining available. HTML pages other than supported Tenor shares are rejected.

`Edit Expression` opens with the saved name, description, and emotion. Leave both media
fields blank to keep the source, or provide one replacement. A failed replacement preserves
the previous expression and media. Names must be distinct from other customs and native
stickers after case and separator normalization. Native emojis and stickers keep their thumbnails.
The bottom of `Customs` shows a large preview for images and GIFs, or a playable MP4.
Direct media links use their registered URL; uploaded and imported media are attached privately.
Tenor share pages show `Open Link`. If a preview fails, editing and deletion remain available.

Customs initially allow every persona in the server. `Add Persona` restricts access to listed
personas, one member at a time. The persona picker has pages for servers with more than 25
personas. Manually removing the last member restores access for everyone. Deleting the sole
allowed persona leaves the expression restricted with no eligible personas until a manager
adds a member. `Delete Expression` asks for confirmation and deletes its owned media.

The sticker tool offers eligible customs alongside native stickers. When the bot calls it, the
link or attachment posts right away as its own message under the responding identity, so it can
come before, between, or after the reply's text. Each reply sends at most one expression.
Sticker Usage, provider support, roleplay, and impersonation restrictions still apply.
Usage counts credit accepted delivery across all personas and triggering users in this server.
They may lag until statistics flush. Custom counts survive renames; native counts follow
asset names and can change after a rename. Deleting and recreating a custom starts a new history.

## Generation Tuning
<!-- anchor: generation-tuning -->

- `/config` > Models > Text Samplers & Parameters: sampling parameters (temperature, top-p, …): creativity/randomness.
  Higher temperature is more varied.
- `/config` > Engine > General: how human-like her responses read. The optional `scope` option
  applies the degree server-wide (`Global`, the default) or to a single persona
  (`Persona`), handy when one persona should text casually at degree 3 while another texts like a novel. A persona's "Inherit" choice clears its override.
- `/config` > Engine > General: how many recent messages she pulls as context per trigger.
  A useful lever: raise it for more conversational awareness, lower it to cut token cost.

## System Prompt
<!-- anchor: system-prompt -->

The system prompt sits above the persona and shapes overall behavior:

- `/config` > Engine > General: set a custom system instruction (up to 16,000 characters).
- `/config` > Engine > General: choose from preset system prompts.
- `/config` > Engine > General: reset to the default. The confirmation shows the prompt it just
  removed, so you can copy it back out if you cleared it by accident.

When a [SillyTavern preset](/features/integrations/sillytavern-support/) is active, the built-in fallback
system prompt is replaced, but a custom one you set here is still sent.

## Uncensored Output
<!-- anchor: uncensored-output -->

TomoriBot has no content filter of its own: she is not a moderation harness and adds no
safety rails on top of the model. Whatever the underlying provider returns is what she says.
`/nsfw jailbreaks` therefore doesn't "unlock" anything inside TomoriBot; it exists purely to
work around provider-side filters that are stricter than you want.

It toggles three independent techniques (all off by default):

- **Prompt injection**: adds a jailbreak instruction block to the context to steer the model
  away from unnecessary refusals.
- **Unicode spaces**: swaps normal spaces for a look-alike Unicode space so keyword/token
  filters don't match on phrases, on the text sent to the model and on her reply.
- **Sanitize**: obfuscates a set of sensitive words for the same reason, likewise on both
  the request and the response.

None of these change what the model is *capable* of; they only reduce how often an
over-eager provider filter blocks otherwise-normal output. Some of these options are
age-restricted; see
[Age-Restricted Commands](/features/setup-administration/age-restricted-commands/).

## Appearance & Time

- `/config` > Persona > Identity & Personality: what she calls herself.
- `/config` > Engine > General: the server timezone, used for time-aware replies and reminders.

---

Looking for admin/cost controls (quotas, whitelists, BYOK) rather than behavior? Those live
under [Server Moderation](/features/setup-administration/server-moderation/).
