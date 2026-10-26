# Product intent

Help a person understand agent-made code and steer the work with a short, precise instruction inside the workflow they already use.

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
