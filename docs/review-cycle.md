# Review cycle

The agent prepares all behavior-based blocks once, using the same CLI/MCP service. The person reads in the existing conversation or a supported diff surface and sends several opinions together. A browser is optional and never a prerequisite.

The [user-level skill installation](../README.md#install-from-source) reuses one CLI across projects. Resolve the actual working repository and pass `--repo` explicitly; verify private storage is ignored before saving. Project MCP setup is optional and can add machine-specific configuration files to Git's inventory. Do not run it just to read another project.

## Capture context and code

Supply only verified task context. References are data; the tool does not fetch or execute them.

```json
{
  "requirements": ["Reject empty profile IDs before making a request."],
  "acceptanceCriteria": ["An empty ID never reaches the API."],
  "references": [{"title":"Profile requirement", "source":"docs/profile.md", "revision":"verified commit or document revision"}]
}
```

```sh
node bin/code-doctor.mjs capture --repo /path/to/project --base main \
  --task 'Validate profile IDs' --kind fix --context /path/to/context.json
```

Text changes are split by hunk and index/worktree stage. New, deleted, renamed, binary, empty and metadata-only files remain in the inventory. Every unit must occur exactly once in the plan. Group units by behavior or a decision the person can discuss, not merely by filename.

## Prepare and read

Use `plan_review` or CLI `plan --file PLAN.json` with the captured reviewId, summary and blocks. A block has `id`, `title`, `comment`, `importance`, `relation` and `unitIds`. Relation is an evidence-based judgment: requested, supporting, extra or unknown. The agent reads the relevant surrounding code before explaining behavior.

Optional focus ranges use actual captured file coordinates:

```json
{"focus":[{"unitId":"captured-unit-id","side":"new","startLine":24,"endLine":30}]}
```

Use old/new sides explicitly, including rename paths and stage. Each range must contain a changed line on its side. A block accepts at most three ranges, 40 lines per range and 80 total. Full patches remain available.

`read --view guide` returns every ordered comment, verified excerpt and exact target in one call. `read --view outline` keeps the inventory and identity without patches or excerpts. `block --view full` retrieves all patches for one block. All are read projections; they do not replace the saved original.

For focused guide/block output, `coverage.changedLines` counts actual additions and deletions and `shownChangedLines` counts those included in this output. `unshown` identifies remaining ranges by unit, file, stage and side. `nonLineUnitIds` keeps changes that cannot be represented by changed lines. Explain the excerpt's boundary in ordinary language, not a new checklist. Included code does not mean it was read, understood or approved.

Use native comment/navigation tools or host-documented response syntax only when actually available and able to represent the captured target. Otherwise show all blocks together in the conversation. Do not attach an old-side or index excerpt to a different checkout line or emit a host-specific directive in another client.

## Feedback and correction

```sh
node bin/code-doctor.mjs feedback --repo /path/to/project \
  --review REVIEW_ID --block BLOCK_ID --text 'Keep the existing response format.'
node bin/code-doctor.mjs feedbacks --repo /path/to/project --review REVIEW_ID
```

Record delivered feedback against its exact block and review. Do not read unsent native drafts or duplicate already recorded opinions. A saved record is `saved-not-sent`, not execution, delivery or approval. Old source, review or opinion versions are rejected.

Verify the exact listed IDs, versions and original text before applying a copied batch. Do not include later or unrelated opinions. Report conflicting instructions before changing code. Apply compatible authorized changes together, run appropriate checks, then capture and plan one revised review. Omit base and task context fields during recapture to preserve the original comparison and task identity. If feedback replaces an earlier requirement, explain that in the revised summary and blocks instead of rewriting the original context.

Resolve each opinion separately with its expected version, revised reviewId and evidence. `addressed` requires changed source and the same task context, but a changed fingerprint alone does not prove the requested correction. Use `dismissed` only for an explicit, explained decision.

## Optional viewer and storage

For a requested visual review, run `serve --repo /path/to/project --session HOST_SESSION_ID` or MCP `open_review` with the actual host session ID from the hook. Without a host ID, retain the private `handoffKey` returned to the opening agent; it identifies the viewer’s feedback and can be passed as `--session`. Keep the process alive; it listens on loopback and exposes no arbitrary file, source execution or merge endpoint. The fragment token grants local review API access and must not be published.

Navigation, code expansion and language selection do not call a model. With a connected agent, call `open_review`, present the viewer, and call `wait_for_review` with the returned waitId and reviewId. Write opinions on any blocks and select **Finish review** once. The waiting call returns the exact batch, including an empty list if no corrections are requested. The agent can apply compatible feedback in the same turn. This does not wake an already stopped agent or authorize merge or deployment.

After a completed review, the viewer opens the revised review when the agent starts waiting for it. An unsaved draft keeps the previous review on screen. The viewer also keeps unsaved input while navigating and changing language in that page; it does not promise recovery after refresh or closing the tab. Server-side saved opinions remain versioned and retrievable. Browser input requests, where supported, do not prove successful chat delivery.

Private storage is `.code-doctor/review.json`, `reviews/`, `history.json` and versioned feedback records. All must be ignored and untracked. Writes use a per-checkout lock. If a writer died, inspect `doctor` and verify no process owns the checkout before manually removing only its stale lock. Do not delete all reviews or remove a live writer's lock.

## Submitted feedback

The completion stores exact feedback IDs, versions, review and source fingerprint under the originating host session or private handoff key. The waiter returns `completed` only for the same review and a current batch. A changed source or review returns `changed`, not an instruction to apply. A timeout, cancellation, or a viewer with no waiter preserves the batch but does not continue the agent; do not run a model retry loop. If the person later asks to continue, `submitted --repo PATH --session HOST_SESSION_ID` or `read_submitted_feedback` retrieves that batch. Never treat an empty batch as merge or deployment approval.

Project `setup` configures a 15-minute per-server timeout for managed Codex and Claude configurations; existing unowned or user-edited settings are preserved. Codex otherwise defaults to 60 seconds. Claude may background a long-running call after two minutes. Other wrappers can apply their own timeouts or prevent interaction during a tool call, so host behavior must be verified rather than assumed.
