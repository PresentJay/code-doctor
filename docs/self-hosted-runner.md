# Private runner operations

The existing private repository may use an isolated runner labeled `self-hosted`, `linux`, `x64`, `code-doctor`. The checked-in service hardening example is [ops/runner-service.conf](../ops/runner-service.conf). Host addresses, credentials, registration tokens and personal operating logs do not belong in this repository.

A public repository must use GitHub-hosted runners for pull requests and ordinary checks. The workflow selects them from the repository's visibility; it never uses `pull_request_target` to execute contributor code. Do not override that boundary to reuse private infrastructure for public contributions.

For the private runner, use a dedicated unprivileged account, a workspace isolated from personal data, no application secrets, and installation with lifecycle scripts disabled. Keep GitHub's runner updates enabled. Before stopping, deregistering, updating its service or restarting the host, verify no job is running. Keep the real machine's service names and removal instructions in a private operations record.

The same `npm ci --ignore-scripts --no-fund` and `npm run check` commands run on both Node 22 and 24. Neither runner type calls a model or publishes a package. Repository visibility changes and publication require a separate owner decision.
