---
name: Bug Report
about: Report a bug or unexpected behavior
title: "[BUG] "
labels: bug
assignees: ''

---

## Bug Description
A clear and concise description of what the bug is.

## Steps to Reproduce
1. Go to '...'
2. Run command '...'
3. See error

## Expected Behavior
A clear and concise description of what you expected to happen.

## Actual Behavior
A clear and concise description of what actually happened.

## Screenshots/Logs
If applicable, add screenshots or error logs to help explain your problem.

**Tip**: Use the `/export` command in Discord to export your server's configuration, which can help diagnose issues:
- `/export server` - Export server configuration (memories, settings, preset)
- `/export personal` - Export your personal configuration (memories, settings)
- Attach the exported JSON files to this issue (make sure to remove any sensitive information first!)

## Environment
- **Deployment Method**: [Self-hosted with Bun / Self-hosted with Docker / Official hosted instance]

If Self-Hosted, state the following as well:
- **TomoriBot Version**: [e.g., v1.0.0 or commit hash]
- **OS**: [e.g., Windows 11, Ubuntu 22.04, macOS 14]
- **Bun Version**: [e.g., 1.0.0] (if self-hosted with Bun)
- **Node.js Version**: [e.g., 20.0.0] (if applicable)
- **PostgreSQL Version**: [e.g., 15.0] (if self-hosted)

## Provider Configuration
- **LLM Provider**: [Google Gemini / NovelAI / OpenRouter / Other]
- **Model**: [e.g., gemini-1.5-pro, kayra-v1, etc.]

## Additional Context
Add any other context about the problem here, such as:
- Does this happen consistently or intermittently?
- Did this work before? If so, when did it break?
- Are there any error messages in the console?
