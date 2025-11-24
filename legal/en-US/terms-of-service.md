# TomoriBot Terms of Service
Last updated: 2025-11-24

These Terms apply to the official hosted TomoriBot instance on Discord. If you run your own copy from this open-source repository, you are not bound by these Terms; your use is governed by the AGPLv3 license in `LICENSE`, and you alone control data handling in your self-hosted environment.

## 1) Acceptance & Eligibility
- By adding or interacting with TomoriBot, you accept these Terms and Discord's Terms of Service and Community Guidelines.
- You must be at least 13 years old (or the minimum age required by your jurisdiction) and legally allowed to use Discord.

## 2) Scope of Service
- TomoriBot is an AI-powered assistant that responds to Discord interactions, stores optional persona/memory data, and can use external AI/search providers you configure.
- The bot may change, suspend, or end features at any time for maintenance, safety, or legal reasons.

## 3) Your Responsibilities
- Do not use TomoriBot for unlawful, harmful, or platform-disallowed content, harassment, or unauthorized access attempts.
- You remain responsible for content you or your server members provide (messages, memories, persona data, uploads). Ensure you have rights to share it and avoid sensitive data you do not want processed by AI providers.
- Respect rate limits and avoid spam or abuse that degrades the service.

## 4) Third-Party Providers & Models
- You may connect TomoriBot to AI or search providers (e.g., Anthropic, Google Gemini, OpenAI/OpenRouter, NovelAI, Brave Search). Their terms, privacy policies, safety filters, and billing apply to any content you send through them.
- We cannot control the behavior, retention, or safety policies of those providers. Review their terms before sending sensitive or regulated data.
- AI-generated content may be inaccurate, biased, or inappropriate despite safety filters. TomoriBot does not verify or endorse AI outputs.
- Server administrators are responsible for monitoring bot interactions and configuring appropriate channel permissions, safety features, and content filters.
- You acknowledge that AI providers may use your prompts to train or improve their models unless you opt out through their respective settings. Check each provider's data usage policies.

## 5) API Keys and Billing
- If you supply API keys for AI/search providers, you authorize TomoriBot to store and use them to fulfill your requests. Keys are encrypted at rest using the configured `CRYPTO_SECRET`, but you are responsible for provider-side costs and account usage.

## 6) Data Handling Summary
- Data collected and usage purposes are described in the Privacy Policy. Key examples include Discord IDs, server configurations, optional memories/persona data, reminders, and error diagnostics.
- You can export or delete data using in-bot commands where available; some records may persist where required by law or for security.

## 7) Self-Hosted Use & Source Code Access
- Running TomoriBot yourself from this repository is treated as separate from the hosted service. You are responsible for complying with the AGPLv3 license, Discord rules, and any provider terms you enable.
- Under the AGPLv3 license, if you modify and host TomoriBot publicly, you must make your modified source code available to users interacting with your bot over the network (see AGPLv3 Section 13).
- The hosted Terms and Privacy Policy act only as a reference template for self-hosts.

## 8) Availability, Support, and Changes
- Service availability is not guaranteed. Outages, maintenance, or rate limits may interrupt responses.
- We may update these Terms at any time. Material changes will be announced with at least 30 days' notice through the support Discord or project GitHub, and will be reflected by updating the "Last updated" date. Continuing to use the bot after changes means you accept the revised Terms.

## 9) Termination
- We may suspend or remove access for violations of these Terms, legal requirements, or safety/security concerns. You may remove the bot at any time; consider using the `/data delete` command to remove stored data before removal.

## 10) Disclaimers and Liability
- The service is provided "AS IS" and "AS AVAILABLE" without warranties of any kind. We disclaim implied warranties of merchantability, fitness for a particular purpose, non-infringement, and uninterrupted availability.
- To the maximum extent permitted by law, we are not liable for indirect, incidental, consequential, or punitive damages, or for actions of third-party providers or users. Our total liability is limited to the greater of (a) amounts you paid us for the service (typically $0) or (b) $10.

## 11) Contact
- For hosted-instance questions or concerns, reach out via the project GitHub issues or the support Discord linked in the `/support discord` command.
