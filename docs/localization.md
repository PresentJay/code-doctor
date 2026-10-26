# Language support

English is the source language for maintained documentation, source comments, CLI help and protocol fields. Getting-started guides are available in Korean, Japanese and Simplified Chinese.

The optional web viewer supports `en`, `ko`, `ja` and `zh-CN`. It starts in English unless its URL fragment selects another supported language. The language control updates labels in place and remembers the selection in the fragment, without a model/API call or page reload. It preserves the token, selected block, unsaved input, code, agent explanations, review identity and saved opinions.

`web/messages.mjs` contains interface copy only. `web/i18n.mjs` resolves locales, substitutes numbered placeholders as text and updates declared text/attribute labels. Add every message to all four locales and keep the same placeholders. English is the fallback for unsupported languages. Chinese support currently means Simplified Chinese, not a claim of Traditional Chinese localization.

Agent explanations follow the person's language through the skill. We do not machine-translate their source code, paths, IDs, references, agent-authored explanations or original feedback. Server diagnostics and protocol names remain English. The copied feedback instruction may be localized, while its IDs, source version and original opinions remain exact.

Run `node --test test/i18n.test.mjs test/viewer-ui.test.mjs` and check the real viewer with long CJK text, a narrow viewport, errors, unsaved drafts, navigation and feedback copying. Translations have not received independent native-speaker review.
