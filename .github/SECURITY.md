# Security Policy

TomoriBot is an AI Discord bot that handles API keys, user prompts, persisted memory, and tool-calling integrations. For a detailed breakdown of its known threat model and residual risks, please see [`docs/wiki/threat-models.md`](../docs/wiki/threat-models.md).

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Preferred: use [GitHub's private vulnerability reporting](https://github.com/Bredrumb/TomoriBot/security/advisories/new) on this repository. This gives us a private advisory workflow and supports CVE issuance.

Alternative: email the maintainer at the address listed on the GitHub profile of [@Bredrumb](https://github.com/Bredrumb).

When reporting, please include:
- A description of the vulnerability and its impact
- Steps to reproduce (or a proof-of-concept)
- The version / commit hash you tested against
- Any suggested mitigation, if you have one

## In-Scope
- Discord bot token or API key leakage
- Authorization bypass on slash commands or admin-only operations
- SQL injection or unsafe query construction
- Prompt injection that exfiltrates other users' or other servers' data
- Remote code execution via tool calling, MCP integration, or REST tools
- Path traversal or unsafe file handling in document/image pipelines
- Cache poisoning that leaks data across servers or users

## Out-of-Scope
- Misconfiguration of self-hosted deployments (weak DB passwords, exposed ports, etc.)
- Social engineering of bot personas or jailbreak prompts that only affect the requesting user's session
- Model hallucinations or factual errors
- Rate-limiting or abuse of third-party LLM provider APIs (report to the provider)
- Vulnerabilities in dependencies that have no demonstrated impact on TomoriBot
- Issues requiring a compromised host or Discord account to exploit