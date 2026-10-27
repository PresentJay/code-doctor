# Third-party notices

Code Doctor is distributed under Apache-2.0. Its dependencies keep their own licenses and copyright notices. The local viewer bundles shadcn/ui component source and selected React dependencies. Their full notices are included in [web/BUNDLED-LICENSES.txt](web/BUNDLED-LICENSES.txt); other dependencies are installed with their accompanying notices.

| Direct dependency | Version | License | Source |
|---|---|---|---|
| @modelcontextprotocol/server | 2.3.1 | Apache-2.0 | https://github.com/modelcontextprotocol/typescript-sdk |
| @modelcontextprotocol/client (development/test) | 2.3.1 | Apache-2.0 | https://github.com/modelcontextprotocol/typescript-sdk |
| smol-toml | 1.9.1 | BSD-3-Clause | https://github.com/squirrelchat/smol-toml |
| zod | 4.6.7 | MIT | https://github.com/colinhacks/zod |

The exact dependency graph is recorded in package-lock.json. Redistributors who bundle dependencies must preserve the applicable license and notice files from those installed packages, including transitive dependencies. This file does not replace their license texts or relicense their code.

The button and textarea components are adapted from the shadcn/ui New York v4 registry (MIT); their original license is included with the bundled notices. Public implementation references in docs/references.md describe ideas and interfaces.
