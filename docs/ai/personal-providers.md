# Personal Providers

Phase 2 of the provider rehaul adds per-user provider routing on top of the server-level provider vault.

## What it does

- Users can save their own provider credentials in `user_saved_provider_configs`.
- Personal capability routing is global per user, not per server.
- Personal capabilities can override server routing for:
  - text
  - embedding
  - image
  - video
  - vision

## Runtime behavior

- `resolveCapabilityCredentials(serverId, capability, { userId })` now checks personal providers first when a user context exists.
- Successful personal resolution returns `source: "personal"`.
- If `server_byok_configs.user_byok_mode = true` and no qualifying personal provider exists for a user-triggered request, runtime raises `PersonalProviderRequiredError`.
- Broken enabled personal credentials hard-fail and do not silently fall back to the server provider.

## Thought logs and privacy

- Thought logs add a personal-provider attribution line when the text turn used personal credentials.
- No thought log is emitted at all for private channels, matching the existing privacy model.

## Commands

- `/config setup` can bootstrap a guild directly into `None (User BYOK)` with no server text provider
- `/personal provider add`
- `/personal provider remove`
- `/personal provider model-text`
- `/personal provider model-embedding`
- `/personal provider model-image`
- `/personal provider model-video`
- `/personal provider model-vision`
- `/personal provider toggle-models`
- `/personal model fallback`
- `/personal samplers`
- `/server user-byok toggle`
- `/help personal-provider`

## Notes

- Server cooldown and text quota checks are bypassed for personal text turns.
- Memory/document embedding commands resolve personal embedding credentials when available.
- `/config provider remove` can remove the active server provider when `user_byok_mode` is enabled.
- A BYOK-only server intentionally has `server_model_configs.llm_id = NULL`; the runtime overlays a real model only when a qualifying personal provider is active for that user.
