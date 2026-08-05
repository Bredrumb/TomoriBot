# DuckDuckGo & IAsk MCP server

TomoriBot installs `@oevortex/ddg_search@1.3.0` as a production dependency and starts its
`ddg-search-mcp` executable directly in production. Development uses the package named by
`config.json` through `bunx`.

The package currently provides:

- `web-search`: DuckDuckGo text search
- `iask-search`: AI-generated search fallback
- `monica-search`: an additional upstream function that TomoriBot does not expose

TomoriBot exposes only the built-in `web_search` tool to models. Its dispatcher uses DuckDuckGo
for text search and retries with IAsk when DuckDuckGo is rate-limited or returns no usable results.
The raw MCP function names remain hidden from provider tool schemas.

The executable is referenced by configuration rather than imported by TypeScript, so it must stay
listed in `package.json` and in Knip's `ignoreDependencies`. The Docker build verifies that
`/app/node_modules/.bin/ddg-search-mcp` exists to catch accidental dependency pruning.

The upstream server writes diagnostics to stdout as well as stderr. TomoriBot's stdio transport
admits only JSON-RPC lines to the MCP parser and retains a bounded diagnostic tail for startup and
unexpected-exit logs.
