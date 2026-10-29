# Product intent

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who direct coding agents and want to understand and steer the resulting changes in the tools they already use. The primary job is to review consequential code without having to read an entire repository or accept changes blindly. The person can give several specific corrections together and inspect the revised work.

## Product Purpose

Help a person stay aware of what an agent changed, why it matters, and how it relates to the request, with as little interruption to development as possible. Success is better understanding and useful human direction with less effort, not a larger report, a sequence of approval clicks, or a passing test count.

## Positioning

Code Doctor organizes captured Git changes into an agent-prepared reading path: an overall comment followed by prioritized, behavior-based blocks with actual code and the complete inventory. It connects review to the request and relevant project context, and preserves feedback for a combined correction and re-review. It is guidance for a person using an existing agent workflow; it is not an autonomous approver.

## Operating Context

Codex and Claude Code are the initial agents. People may use a native agent app, CLI, IDE, or a wrapper such as Conductor; each host can expose different hooks, code views, and feedback capabilities. Prefer the actual surfaces available in the current host. The web platform described here is an optional local review surface, not a requirement to open a browser for every task.

The agent establishes the task, comparison and relevant repository context before editing. Work may be planned development, a fix, an incident, an experiment, or research. It prepares the reading guide in one pass after work and applies compatible opinions together. Future work may help assess plans against a larger roadmap; automatic roadmap understanding and personalization are not established capabilities.

## Evidence on Hand

The repository's [validation record](validation.md) separates observed Git capture, CLI/MCP, installation and review flows from host behavior and human understanding that have not been established. The [review cycle](review-cycle.md) describes the supported handoff and its limits. Do not infer universal host support, user comprehension, adoption, or approval from an example or a passing check.

## Product Principles

- Fit the person's existing workflow and keep ordinary navigation free of extra model turns.
- Lead with consequential behavior and scope decisions while retaining every supported change.
- Ground explanations in actual code, the request and verified context; make uncertainty visible.
- Preserve original opinions and source identity, then handle compatible corrections together.
- Keep human decisions explicit: viewing, saving, copying or resolving feedback is not permission to merge or deploy.

## Current workflow

Help a person understand agent-made code and steer the work with a short, precise instruction inside the workflow they already use.

Install once at user level and provide guidance automatically for development in Git repositories after host activation. Do not require the user to name Code Doctor or configure every repository. Explain important scope decisions during work and prepare the result afterward. Let the person disable guidance for a task, conversation, repository or globally, and enable it again. Keep unrelated questions quiet. A repository/session opt-out suppresses reading for that target while retaining control context for an explicit re-enable request and independently checking other task repositories. Global disable suppresses all hook context. A conversation may start outside Git; resolve the actual development repository before applying repository/session preferences. Check the complete guide in the same final response; do not treat a successful hook as delivery or force a Stop-triggered model continuation.

Prepare the entire reading guide once: an overall comment, behavior-based blocks, actual code and the complete change inventory. Order consequential changes and scope decisions first, then the context needed to understand them. Scrolling, opening code and choosing another prepared block must not require another model turn. Several comments should lead to one correction and re-review cycle.

Claude Code and Codex are the initial agents. A host app, IDE, CLI or wrapper may expose different native surfaces. Prefer a surface actually documented or supplied in the current session; otherwise provide all blocks together in the conversation. Open the local web viewer only on an explicit request. A skill or MCP installation does not imply a native panel, custom next/highlight controls, reordered host diffs or automatic message delivery.

## Evidence and scope

Read the request, repository instructions and relevant task or roadmap sources before judging scope. Record the work kind: planned development, fix, incident, experiment or research. A supporting change is not automatically overengineering. Keep missing context explicit. Product-specific company services and private workflows are not prerequisites.

Git capture is the source of truth. Keep every supported unit exactly once, including new, deleted, renamed, binary, empty and metadata-only files. Preserve the comparison commit, HEAD, fingerprint and review identity. Unsupported states fail clearly. CLI and MCP share the same service.

Explain the situation and before/after behavior, then connect the mechanism to the request. Use enough actual code to follow the condition, call and consequence. Excerpts are reading entry points. Identify other files, old-side changes and non-line changes outside an excerpt; retrieve their source before claiming their behavior. Shown-line counts are not proof of understanding, safety, completed review or approval.

## Feedback

Use block titles or verified file/side/line context to map feedback to the prepared guide. Preserve the person's exact text, review and code version. Read only delivered comments; do not claim to have read unsent host drafts. Resolve ambiguity together rather than introducing one question per block.

Apply compatible authorized corrections together, verify them, then capture and plan one revised review. Preserve old code and comments, and record evidence for each opinion separately. Reading, saving, copying and resolving an opinion never authorize merge or deployment.

## Language and limits

English is the canonical documentation and interface fallback. The optional viewer supports English, Korean, Japanese and Simplified Chinese. Agent explanations follow the person's language. Code, paths, IDs and original feedback are never translated.

This preview verifies inventory, source identity, communication and feedback mechanics. It does not automatically understand an entire roadmap, prove explanation quality, personalize every reading guide, approve releases or demonstrate that every host exposes native feedback. Judge product value by whether people understand consequential behavior and can remove unwanted scope with less effort—not by report counts or approval clicks.
