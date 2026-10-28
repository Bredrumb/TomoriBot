---
title: "Personalization"
sidebar:
  order: 3
---

TomoriBot can remember personal details, custom names, and AI provider credentials that
follow you across every server you share with her. You can manage these settings with
the `/personal` commands without altering any server's shared configuration.

## Personal memories

Facts she learns or remembers about you follow you between servers. Managing them (adding,
removing, exporting, or clearing context) is covered on the
[Memory](/features/knowledge/memory/#personal-vs-server-memories) page.

## Profile and names

Configure how TomoriBot addresses and refers to you across servers in `/personal config` >
Profile.

### Profile details

Your profile can include your gender, pronouns, and preferred addressing style. These are independent
settings. Profile details are sent to the AI only when your privacy level is `None`.

You can also set a UTC offset for your local time. It is a fixed offset, so it does not update
automatically for daylight saving time.

### Naming inheritance

You can set a nickname, prefix, and suffix for all personas or for a specific persona across servers.
Persona-specific preferences take priority over global preferences. If you leave your nickname blank,
TomoriBot uses your current Discord display name.

Prefixes and suffixes inherit independently, so preferences from different scopes can combine.
You can also ask a persona in chat to stop using a title it gave you.

Server managers configure server-wide persona defaults under `/config` > Persona >
Identity & Personality. When the User Info Updates capability is enabled, personas can also
update your profile details when requested during conversation.

Restrictive privacy levels prevent automatic additions and edits, but you can still clear existing
data. Server managers control this feature with `User Info Updates` under `/config` > `Permissions`.

## Your own providers
<!-- anchor: your-own-providers -->

Personal providers let your requests use your own API keys and models across servers. Add a provider
with `/personal providers` and choose models in `/personal config`. Your API key is encrypted, and
thought logs attribute requests using it to you. See
[Custom Endpoints](/features/setup-administration/providers-and-models/#custom-endpoints) for private
endpoints.

Saving a provider immediately enables your personal text override with its default model. You can
configure personal providers in any server or in DMs, even where TomoriBot has not been set up.

:::note[BYOK-required servers]
A server can require members to supply their own API keys via User BYOK mode
([Server Moderation](/features/setup-administration/server-moderation/#user-byok-bring-your-own-key)).
When enabled, your messages require a configured personal provider before TomoriBot will respond,
and failed personal routes do not fall back to server credentials.
:::

### Fallbacks

You can choose up to five backup models from your saved providers in `/personal config` > `Models` >
`Fallbacks`. TomoriBot tries them in order if your personal text model fails.

:::tip
Keep at least one fallback on a different provider. Fallbacks can come from any saved provider, so a
second service can answer when one provider has an outage, rate limit, or billing problem.
:::

If all your personal models fail, TomoriBot can use the server's text model. This uses the server's
credentials and quota. Server fallback is enabled by default and can be turned off in `Fallbacks`.

## Other personal settings

Use `/personal config` to customize additional features:

- **Appearance**: save tags used when [image generation](/features/capabilities/media-generation/image-generation/#tag-customization)
  references you.
- **Privacy Controls** (`Privacy` > `Privacy Controls`): choose your visibility level
  (`None`, `Partial`, or `Full`), toggle cross-server short-term memory sharing, or turn off
  [Pings from Personas](/features/chatting-personality/natural-nudges/#ping-user) so personas never
  ping you to start a conversation.
- **Response Modes** (`Advanced` > `Response Modes`): toggle your personal override for
  [Deliberate Trigger Mode](/features/chatting-personality/chatting-and-triggers/#deliberate-trigger-mode).
- **Impersonation** (`Advanced` > `Impersonation`): set a reusable prompt used when someone
  invokes `/impersonate user` for you.

## Personal Spotlight
<!-- anchor: personal-spotlight -->

Personal Spotlight narrows which personas you can trigger in a specific channel, and optionally
assigns a fallback auto-trigger persona for your messages there. It is scoped to you and one
channel: it does not affect anyone else in the server.

Configure it in `/personal config` > `Advanced` > `Personal Spotlight`. Spotlight respects server
persona permissions and restricts persona handoffs to the personas you selected. A timed spotlight
expires automatically.
