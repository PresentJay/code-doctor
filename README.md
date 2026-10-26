# Code Doctor

Read agent-made changes in context, then steer the work with a short instruction.

[한국어](docs/i18n/README.ko.md) · [日本語](docs/i18n/README.ja.md) · [简体中文](docs/i18n/README.zh-CN.md)

Code Doctor helps Claude Code and Codex prepare a complete reading guide: what changed, why it relates to the request, which code matters first, and what remains outside each excerpt. The person reads in the existing conversation or diff, collects several comments, and asks for the corrections together. Moving between prepared blocks does not require another model turn.

This is an early preview. It uses local Git and the agent you already run; it does not add a model service or require a new API key. A skill or MCP connection does not create a native panel, custom next/highlight controls or automatic chat delivery. [Verified capabilities and limits](docs/validation.md).

## Install from source

Requires Node.js 22 or newer and Git. On macOS/Linux, install once for your user:

```sh
git clone https://github.com/PresentJay/code-doctor.git
cd code-doctor
npm ci --ignore-scripts --no-fund
node bin/code-doctor.mjs install --host both
```

Use `--host codex` or `--host claude` for one agent. The installer adds a `UserPromptSubmit` hook and a discoverable skill to each selected host's user settings, preserving unrelated configuration. Keep the checkout and dependencies in place. Re-running installation updates managed entries without duplicating hooks or resetting opt-outs; edited entries and existing unowned skills require a manual merge.

Open a new session. **Codex requires one initial hook review/trust through `/hooks`.** Installation cannot grant that trust. Claude may require a restart to load changed settings. After activation, ordinary development prompts in Git repositories receive guidance automatically; you do not have to name Code Doctor or configure each repository. When a conversation starts outside Git, the hook supplies discovery instructions; the agent checks the actual task repository and session preferences before applying guidance. Unrelated questions stay quiet. No background model process or browser is started.

The hook treats the host's working directory as a starting hint, not the task repository. The agent confirms the task's target before editing, reads relevant request/roadmap context, and prepares the reading guide when work finishes. Before responding, the agent checks that the complete guide is included in the same response. This is an agent instruction, not proof of delivery or a Stop hook that starts another model turn. Review storage is locally excluded from Git; installation adds no project files. See [Codex hooks](https://learn.chatgpt.com/docs/hooks) and [Claude hooks](https://code.claude.com/docs/en/hooks).

Conductor and other wrappers work automatically only when they load the selected engine's user hooks. A host that ignores those settings needs its own supported integration; this installer cannot manufacture one. Windows automatic installation is not yet supported.

### Turn guidance off or on

Say “turn Code Doctor off for this repository,” “turn it off for this conversation,” or “turn it off everywhere.” The agent saves the matching preference. “Skip it for this task” only changes the current conversation's task behavior. Ask to turn it on again at the same scope. Direct controls are available even when guidance is off:

```sh
PROJECT="/absolute/path/to/your-project"
node bin/code-doctor.mjs disable --repo "$PROJECT"
node bin/code-doctor.mjs enable --repo "$PROJECT"
node bin/code-doctor.mjs disable --scope global
node bin/code-doctor.mjs enable --scope global
node bin/code-doctor.mjs status --repo "$PROJECT"
```

Session controls add `--scope session --session ID` using the actual session ID supplied by the hook. Repository/session opt-outs retain only control context so the agent can re-enable the exact scope on request and check a different task repository independently; they do not start a reading guide for the disabled target. Global disable suppresses all hook context. Broader opt-outs take precedence: enabling one repository does not override a global disable. Preferences live in `~/.config/code-doctor/settings.json`, outside project source. To remove the installation entirely, remove its hook entry and user skill from each host before removing the checkout; preserve other hooks.

### Optional project MCP connection

If you prefer MCP tools for a particular project, first ignore `/.code-doctor/` in its local Git exclude or `.gitignore`, then run:

```sh
node bin/code-doctor.mjs setup --repo "$PROJECT" --host both
```

Setup adds Code Doctor's MCP entry and project skill, preserving unrelated settings and refusing to overwrite edited managed files. Use `--host claude` or `--host codex` for one host. It creates the files below with machine-specific absolute launch paths; unignored files will appear in the project's Git changes. Do not hide already tracked or shared settings wholesale. Reopen/restart the trusted project and follow the host's MCP approval flow. Creating configuration is not proof of an active connection.

| Host | Project MCP configuration | Project skill |
|---|---|---|
| Claude Code | `.mcp.json` | `.claude/skills/code-doctor/SKILL.md` |
| Codex | `.codex/config.toml` | `.agents/skills/code-doctor/SKILL.md` |

Keep the installation directory in place. Rerun project setup after moving it. Directly edited skills or managed blocks require a manual merge. Setup never installs other services or changes accounts.

## Use it in your normal conversation

Ask for your development work normally, for example:

> Fix the total calculation when the cart is empty.

Once the installed hook is active, the agent applies Code Doctor without a separate invocation. On first use in the conversation it briefly explains that guidance is active and can be turned off.

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
