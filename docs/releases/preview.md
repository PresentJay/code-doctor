# Preview release preparation

The maintained source uses Apache-2.0 and an English-first interface with Korean, Japanese and Simplified Chinese support. This preparation does not claim that a registry package or public repository is already available.

Before publishing:

1. Review the exact commit and both Node 22/24 checks. Run `npm pack --ignore-scripts` and install that tarball in a clean directory.
2. Verify LICENSE, NOTICE, THIRD_PARTY_NOTICES.md, the skill, CLI/MCP entry points and all viewer locale assets are present. Exclude local settings, reviewed source, tokens, private logs and node_modules.
3. Decide whether to publish a fresh source snapshot/history or clean the existing Git history and GitHub discussions. A clean current checkout does not sanitize old commits, issues, PRs, tags or release assets. Do not expose the existing private repository before that decision.
4. Confirm public CI uses GitHub-hosted runners, review the security reporting channel and repository protections, then authorize any visibility change separately.
5. Authorize the release and registry publication for the exact artifact. There is no automatic publishing workflow or install hook.

Package metadata can be publish-ready while the repository remains private. A source export built only from tracked files is suitable for review before creating a clean public repository; it does not include Git history. The optional historical native-probe example is an experiment, not proof of host compatibility.
