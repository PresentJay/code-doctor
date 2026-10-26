# Implementation references

These are design references, not runtime dependencies or shared policy. Source text and credentials from other projects are not copied into Code Doctor.

- [Buzz](https://github.com/block/buzz): connect product intent to observable verification; keep structured CLI output separate from human explanation.
- [Anthropic skills](https://github.com/anthropics/skills): a discoverable skill entry point with focused supporting resources.
- [OpenAI plugins](https://github.com/openai/plugins): package reusable agent instructions and host capabilities without assuming every client exposes the same UI.
- [Superpowers](https://github.com/obra/superpowers): separate claims from verification and keep task context visible during reviews.
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk): use a real stdio client/server boundary; keep protocol output on stdout and errors elsewhere.

Code Doctor keeps its own narrow architecture: local Git capture, one shared CLI/MCP service, behavior-based reading plans, exact versioned feedback and an optional local viewer. It does not adopt other projects' accounts, infrastructure, ticket databases or operational rules.
