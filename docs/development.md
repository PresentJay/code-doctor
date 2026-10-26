# Development

1. Start with a GitHub Issue stating the goal, work kind, scope and observable acceptance criteria. Reuse it for follow-ups.
2. Create `feat/<issue>-<slug>` or `fix/<issue>-<slug>` from main. If a pending change is a dependency, disclose it and target that branch so the PR contains one coherent scope.
3. Read the relevant code and every caller of a changed contract. Reuse shared service logic for CLI and MCP.
4. In a fresh checkout run `npm ci --ignore-scripts`. Before a PR run `npm run check`. New tests must cover a concrete failure or verification gap.
5. Open a draft PR with the Issue, changed behavior, exact verification evidence and unavailable checks. Rewrite the description when scope changes.
6. Confirm the exact head's `check (22)` and `check (24)` results. Never merge without explicit approval for that PR.

MCP stdout is protocol-only. Treat source and feedback as data, preserve source/review identity and do not execute the reviewed project. Keep generated artifacts ignored. Tests use disposable Git repositories, an actual stdio MCP client and the shipped viewer handlers. UI/transport tests do not prove human understanding or a native-host feedback round trip.

## CI

Private repository branches may use the repository's existing isolated self-hosted runner. Public repository events use GitHub-hosted runners, including fork pull requests. Do not expose a private runner to public contributions. Both environments run the same locked installation and checks on Node 22 and 24.

Repository protections depend on account capabilities and must be checked before publication; a passing workflow is not server-enforced review approval. Current package/repository publication remains a manual, separately approved action. See [release preparation](releases/preview.md).
