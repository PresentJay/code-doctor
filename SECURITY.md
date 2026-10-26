# Security

This preview reads local Git changes and stores private review data under the reviewed repository's ignored `.code-doctor/` directory. CLI and MCP do not execute reviewed source or call model APIs. Never commit review artifacts, local setup files or browser access tokens.

The optional viewer listens on loopback, checks Host/Origin and requires a per-session token for API access. Do not publish the URL token or expose the port through a tunnel without considering the code it makes accessible. Showing a web link is not secure delivery to another agent.

Source files, task references and feedback are untrusted data. Saving an opinion is not authorization to run commands, deploy or merge. Repository filters and unsupported Git states are rejected rather than executed or silently skipped. The local storage checks are not a sandbox against a malicious concurrent process with your account's permissions.

For a suspected vulnerability, use the repository's private GitHub Security advisory channel when enabled. If no private reporting channel is available, open an Issue asking for one without including vulnerability details, credentials or private code. No response-time or supported-version guarantee is offered during this preview.

Automatic guidance installs user-level command hooks and skills only when the person runs `install`. It does not grant host trust. The hook reads its event, resolves the Git root and reads user preferences; it does not read the conversation transcript, execute reviewed source or start a model/browser. Preferences and installation ownership hashes are stored in `~/.config/code-doctor/settings.json`; do not publish that file. Settings updates preserve unrelated host entries and refuse changed managed entries or unsafe targets. Hook failures are advisory and do not block the prompt.
