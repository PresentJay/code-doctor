# Contributing

Code Doctor is an early preview. Start an Issue describing the person’s problem, expected behavior and a concrete way to observe success. Keep changes small and tied to that goal.

Use Node.js 22+ and Git. Run `npm ci --ignore-scripts`, then `npm run check`. Open a draft PR with the Issue link, resulting behavior, validation and remaining limits. See [development](docs/development.md) and [agent instructions](AGENTS.md).

Write maintained documentation and code comments in English. Add translations to every supported locale when changing interface copy, preserve placeholders and keep user-authored content unchanged. [Localization](docs/localization.md) explains the scope.

Do not submit private code, review artifacts, credentials, machine-specific settings or employer information. Use a disposable repository to reproduce problems. Report security issues using [SECURITY.md](SECURITY.md).

By submitting a contribution, you agree that it is provided under this repository's Apache-2.0 license. Do not contribute code you are not authorized to share. Dependencies keep their own licenses and notices; record new ones in THIRD_PARTY_NOTICES.md.
