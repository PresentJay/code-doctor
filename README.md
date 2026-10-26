# Code Doctor

Read agent-made changes in context, then steer the work with a short instruction.

[한국어](docs/i18n/README.ko.md) · [日本語](docs/i18n/README.ja.md) · [简体中文](docs/i18n/README.zh-CN.md)

Code Doctor helps Claude Code and Codex prepare a complete reading guide: what changed, why it relates to the request, which code matters first, and what remains outside each excerpt. The person reads in the existing conversation or diff, collects several comments, and asks for the corrections together. Moving between prepared blocks does not require another model turn.

This is an early preview. It uses local Git and the agent you already run; it does not add a model service or require a new API key. A skill or MCP connection does not create a native panel, custom next/highlight controls or automatic chat delivery. [Verified capabilities and limits](docs/validation.md).

## Install from source

Requires Node.js 22 or newer and Git. Until a package is published, install from a checkout you trust. For local macOS/Linux use, link the skill once for all projects:

```sh
git clone https://github.com/PresentJay/code-doctor.git
cd code-doctor
npm ci --ignore-scripts --no-fund
CODE_DOCTOR_HOME="$PWD"
mkdir -p "$HOME/.agents/skills" "$HOME/.claude/skills"
ln -s "$CODE_DOCTOR_HOME/skills/code-doctor" "$HOME/.agents/skills/"
ln -s "$CODE_DOCTOR_HOME/skills/code-doctor" "$HOME/.claude/skills/"
```

Use only the link for your host if needed. These commands refuse an existing same-named entry; inspect it instead of replacing it. Keep the checkout and its dependencies in place. Link the whole skill folder: its two-line launcher reuses the CLI from that checkout, so no global executable, project setup or model API key is needed. On Windows, use a directory link or your host's skill manager and retain access to the runtime.

Open your work project and ask for Code Doctor in the normal conversation. The skill verifies the actual Git root, passes it explicitly to the CLI, and protects review data with a local Git exclude entry. It does not add host settings or skills to each project. Restart the host if the skill does not appear; wrappers may expose a different skill-discovery flow. User-level skill locations follow the [Codex](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills) and [Claude Code](https://code.claude.com/docs/en/skills#choose-where-skills-load) documentation. A link is not proof that a running agent loaded the skill.

To verify the CLI against a particular project:

```sh
PROJECT="/absolute/path/to/your-project"
node "$CODE_DOCTOR_HOME/skills/code-doctor/scripts/code-doctor.mjs" doctor --repo "$PROJECT"
```

Verify that `doctor.repo` is the project you intend to review. `doctor` checks the CLI and repository; it does not connect a model or install the skill.

### Optional project MCP connection

If you prefer MCP tools for a particular project, first ignore `/.code-doctor/` in its local Git exclude or `.gitignore`, then run:

```sh
node "$CODE_DOCTOR_HOME/bin/code-doctor.mjs" setup --repo "$PROJECT" --host both
```

Setup adds Code Doctor's MCP entry and project skill, preserving unrelated settings and refusing to overwrite edited managed files. Use `--host claude` or `--host codex` for one host. It creates the files below with machine-specific absolute launch paths; unignored files will appear in the project's Git changes. Do not hide already tracked or shared settings wholesale. Reopen/restart the trusted project and follow the host's MCP approval flow. Creating configuration is not proof of an active connection.

| Host | Project MCP configuration | Project skill |
|---|---|---|
| Claude Code | `.mcp.json` | `.claude/skills/code-doctor/SKILL.md` |
| Codex | `.codex/config.toml` | `.agents/skills/code-doctor/SKILL.md` |

Keep the installation directory in place. Rerun project setup after moving it. Directly edited skills or managed blocks require a manual merge. Setup never installs other services or changes accounts.

## Use it in your normal conversation

> Use Code Doctor to organize these changes so I can read the code and send several comments together.

The agent checks the request, repository instructions and relevant task/roadmap sources; captures all changes; then groups and orders them around behavior or decisions. It prepares the overall comment, code excerpts and complete inventory once. With a supported native host surface it attaches the guidance there. Otherwise it shows all blocks together in the conversation. It does not require a browser or ask you to say “next” for every block.

Leave native line comments and send them together, or name the blocks in one instruction. The agent records your original feedback against the exact review and code version, applies compatible corrections together, tests them, and prepares a revised review. Saving or viewing is never permission to merge or deploy.

Ask for the **web viewer** explicitly if you prefer it. It provides English, Korean, Japanese and Simplified Chinese interface copy. The language control changes labels in place; code, agent text, review identity and drafts stay unchanged. Choose the language of agent explanations in your conversation. Server diagnostics and protocol field names remain English.

## CLI and MCP

All CLI results are JSON, with errors on stderr. These commands are for agents and direct CLI use; people reviewing code do not need to fill out these forms.

| CLI | MCP | Purpose |
|---|---|---|
| `capture` | `capture_review` | Capture Git changes and verified task context |
| `plan` | `plan_review` | Order and explain every existing change unit exactly once |
| `read --view guide` | `read_review(view=guide)` | Get all ordered blocks and verified code in one call |
| `read --view outline` | `read_review(view=outline)` | Resume from the complete inventory without repeating patches |
| `block` | `read_block` | Read one block; `--view full` retrieves all of its patches |
| `feedback` / `feedbacks` | `record_feedback` / `list_feedback` | Record and retrieve exact, versioned opinions |
| `resolve` | `resolve_feedback` | Record the evidence for handling an opinion |
| `serve` | `open_review` | Open an explicitly requested local web review |

```sh
node bin/code-doctor.mjs capture --repo "$PROJECT" --base main \
  --task 'Explain the requested change' --kind fix
# Ask the current agent to read the captured changes and prepare the plan first.
node bin/code-doctor.mjs read --repo "$PROJECT" --view guide
node bin/code-doctor.mjs --help
```

`capture` creates raw inventory, not agent explanations. Ask your current agent to prepare the reading plan before reading the guide; people do not need to write a plan JSON file themselves. See the [capture → plan → guide cycle](docs/review-cycle.md#prepare-and-read).

The first capture pins the comparison commit. Later captures without `--base` keep it, including after commits. `plan` accepts only existing unit IDs and rejects missing, duplicated or fabricated units. Focus ranges come from captured old/new file coordinates, not generated snippets. Each reading block identifies unshown changed ranges and non-line changes; these are presentation boundaries, not a review-completion score. Full patches and archived reviews remain available.

Private data stays in the reviewed repository's ignored `.code-doctor/` directory. The optional server listens on loopback with a per-session token. Do not publish the token or review artifacts. The tool does not automatically send comments or execute reviewed code. See [security](SECURITY.md) and the [review cycle](docs/review-cycle.md).

## Contribute and release

Run `npm run check`. It verifies Git/source identity, coverage, stale feedback, configuration preservation, the real MCP transport, viewer behavior, translations and package contents. [Contributing](CONTRIBUTING.md) · [Development](docs/development.md) · [Product intent](docs/product.md) · [Language support](docs/localization.md) · [Release preparation](docs/releases/preview.md).

The package and source snapshot can be prepared without publishing them. Repository visibility, old history and previous discussions require a separate publication decision. No registry package is claimed to be available by this README.

## License

[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) and [third-party notices](THIRD_PARTY_NOTICES.md). Third-party dependencies retain their own licenses. Code Doctor is an independent project and is not affiliated with the agent vendors it supports.
