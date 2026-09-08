# Omni-Scout engineering contract

Read README.md, docs/PRODUCT_BRIEF.md, docs/ACCEPTANCE_STATUS.md and docs/TEST_REPORT.md before editing.

## Non-negotiable truthfulness

- 400 fixture players and 11 fixture competition records are SYNTHETIC. No live providers.
- Never report "Codex started", "pushed", "deployed", "tests passed" or "licensed" without observed evidence.
- Preserve DEMO labels everywhere: cards, details, exports, counts and preview. Never disguise fixtures as live data.
- This alpha is SINGLE-CLUB and LOOPBACK-ONLY. A club-name field is not tenant isolation. No public deployment before real auth, tenant scoping, retention controls and audit.
- Unknown values remain null. No zero imputation for missing data; no universal talent score; no global percentile comparing leagues.
- Free-text briefs are stored, not semantically matched by an AI. Do not silently change that claim.
- No external API calls, paid licenses, new credentials, outreach or automatic purchases without authorization.
- No OpenAI API dependency in this release. Obtain the necessary explicit credential decision before introducing one. Never commit keys.
- Sources have purpose-specific rights, timestamps, locator and definitions; self-attestation is not legal verification.
- No medical inference, face analysis, mental-trait scoring or minors in this alpha.

## Workflow

Work on an isolated feature branch. Inspect existing repo state first. Do not overwrite unrelated files. First reproduce tests, then extend features. Keep a single integration owner. Parallel workers must own disjoint packages and pass integration tests before merging. Do not treat a GitHub issue/comment as evidence a remote Codex job is running.

## Commands

- `python -m unittest discover -s tests -v`
- `node --check web/app.js`
- Optional: `python tests/browser_check.py` with Playwright/Chromium.
- `python server.py --demo` for local inspection.
- `python make_preview.py` only generates synthetic data.

## Required next increment

Implement and test real tenant-scoped auth before public hosting. Then a licensed, bounded provider adapter. Preserve source history and evidence/uncertainty. Add strict cross-tenant tests for API, exports, jobs, audit, cache and object storage. Avoid speculative model accuracy or complete-coverage claims.

## Reporting

Maintain commands, logs, exact counts, failures and known limitations in evidence/ and docs/TEST_REPORT.md. Browser DOM tests with a fetch bridge must not be labeled native navigation E2E. Software tests do not prove better talent identification.
