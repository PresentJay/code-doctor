# Validation and limits

This document records the scope of evidence, not a claim that people understand code better merely because tests pass.

| Area | Verified behavior | Not established |
|---|---|---|
| Git capture | Exact unit coverage, source fingerprints, pinned comparison commits; staged/worktree cancellation, rename/deletion/binary/empty changes; rejected unsupported states | Automatic correctness or scope judgment |
| CLI and MCP | Shared service and real stdio client; complete guides and archived originals; stale feedback rejection; several opinions corrected and resolved against one new review | Every model choosing or following the skill automatically |
| Automatic installation | Both generated host commands receive ordinary prompt events, discover the Git root and respect repository/session/global opt-outs; repeat installation preserves unrelated settings and edited entries fail safely | Every wrapper loading user hooks; automatic trust; Windows installation |
| User-level source skill | Linked CLI launcher runs in two isolated projects; exact first inventory contains only the original application change, without project settings or skills | A running host loading that link; Windows setup; wrapper discovery |
| Setup | Preserve unrelated JSON/TOML, comments, large integers and permissions; refuse edited managed files and unsafe paths; add only this tool | Every client's trust/approval UI |
| Optional viewer | Local navigation, exact batch feedback, stale-state handling, clipboard fallback and no source execution | Automatic delivery to the original chat |
| Languages | English fallback plus Korean/Japanese/Simplified Chinese catalogs, matching placeholders, in-place language changes and unchanged original content | Independent native-speaker review; Traditional Chinese |
| Codex | Prior controlled CLI model fixture captured, planned, explained and corrected changes using the shared skill | Native app feedback round trips across all workspaces |
| Claude | Prior MCP initialization/connection and plugin validation | Actual model execution without an available account |
| Conductor | Host documentation describes line comments; use its comment tool only when supplied | Native Code Doctor UI and comment round trip in this session |

Run `npm run check` for the current source. It covers disposable Git repositories, actual CLI/stdio MCP, source/version validation, setup preservation, the shipped viewer handlers, locale completeness and package assets. Private branches currently use the existing isolated runner; public events must use GitHub-hosted CI. Exact final commit and CI results belong to each PR.

The global-preview viewer check used a disposable two-block repository in the Codex in-app browser, at the default desktop size and 390 × 844. All four languages kept the selected block, source, review ID and multilingual draft intact. Two saved opinions survived language changes, copied together with their original text, and remained after reopening the authenticated link. A Japanese unauthorized state displayed localized recovery guidance. This checks the optional viewer, not Conductor or Claude model execution.

The guide distinguishes a complete inventory from the code included in excerpts. Before/after paths and index/worktree stages stay separate, including when the same line changes twice. Binary and metadata-only units never disappear into a zero-line count. This is presentation evidence, not completed review or approval.

The public preparation removes unrelated service integration and owner-specific operational narratives from the maintained tree. It does not rewrite Git history, redact past GitHub discussions, change repository visibility or publish a registry package. An exported source snapshot excludes Git history and private local artifacts. These limits must be considered before making the existing repository public.

The automatic-guidance check used a clean temporary user installation and an ordinary Codex CLI request to fix an empty-cart total. With the hook enabled, Codex fixed and tested the code, then captured, planned and read the complete guide without the request naming Code Doctor. With a repository opt-out, the same request fixed the code without creating review storage. The inspected test hook ran under Codex's one-invocation trust option; no persistent host trust or personal settings were changed. This establishes the controlled CLI behavior, not every wrapper's hook discovery or the human trust UI. Both host-generated hook commands and an installed package were also exercised directly.

A parent-directory regression check starts Codex outside Git and asks it to fix `./project` without mentioning Code Doctor. The agent resolves that child repository, checks its status with the real session ID, fixes and tests the code, prepares one complete guide, and includes the actual changed code in its final response. With guidance disabled for the child repository, the same fix succeeds without creating review storage. These controlled CLI observations do not establish desktop/Conductor discovery, Claude model behavior, or universal compliance with the same-turn completion instruction. No Stop hook or additional model continuation enforces delivery.
