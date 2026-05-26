# Adding a Feature Flag-Controlled Tool

This guide covers the extra wiring needed to gate a built-in tool behind a server config toggle.
Read [`docs/guides/adding-builtin-tool.md`](./adding-builtin-tool.md) first for the base tool steps.

## Steps

1. Map the config field to a feature flag in `src/utils/tools/featureFlagMapper.ts` (`configToFeatureFlags`):

   ```ts
   my_config_field: [FeatureFlag.MY_TOOL],
   ```

2. Add the tool-to-flag mapping in `BUILTIN_TOOL_FEATURE_FLAGS` (or `MCP_TOOL_FEATURE_FLAGS` for MCP tools):

   ```ts
   [ToolName.MY_TOOL]: FeatureFlag.MY_TOOL,
   ```

3. Set `requiresFeatureFlag` in the tool class:

   ```ts
   override requiresFeatureFlag = FeatureFlag.MY_TOOL;
   ```

4. Ensure a config command can toggle the underlying config field so server admins can enable/disable the tool.

## Quality Gate

```bash
bun run check    # TypeScript strict mode
bun run lint     # Biome formatting
```

Then verify: toggle the config off → tool should not appear in the LLM's available tools. Toggle on → tool appears and executes.

## Related Docs

- [`docs/guides/adding-builtin-tool.md`](./adding-builtin-tool.md) — base tool creation steps
- [`docs/pipelines/tool-loop/`](../pipelines/tool-loop/) — how feature flags are checked before tools are offered to the LLM
