# v0.4 independent recovery review

Date: 2026-09-08. Review scope: encrypted envelope boundaries, account-server recovery routes, current owner/session checks, preview and operation limits, workspace source permissions, and late permission checks in the offline server backup implementation. All fixtures were synthetic and all HTTP servers listened on loopback. No operational user backup was created.

## Findings and changes

1. **Oversized passphrase allocation before rejection.** The original Unicode character count expanded the entire supplied string before enforcing its maximum length. Root moved the UTF-16 length and UTF-8 byte bounds ahead of Unicode expansion. The independent regression instruments the string iterator and proves that a 100,000-character invalid passphrase is rejected without expansion. It also proves that an oversized ciphertext is rejected before base64 decoding. Root separately added a 2 MiB passphrase case to the crypto suite.
2. **Offline source-rights checks could use an old clock.** Initial offline create/restore checks used a timestamp captured before encryption/decryption and filesystem staging. A added fresh current-rights validation after encryption, after decryption, and immediately before publishing the staged destination. These checks are visible in `src/backup/server.mjs`. A's dedicated mutable-clock regressions passed as part of its 12-test suite; they are separate from the independent HTTP test counts below.

No additional reproducible authorization or cross-club disclosure defect remained in the reviewed HTTP paths. This is a bounded source review and regression suite, not a cryptographic audit or production certification.

## Independent regressions

`tests/backup-review.test.mjs` contains five cases:

- Oversized passphrase and ciphertext rejection before the avoidable large allocations.
- Four in-flight HTTP operations, including deliberately stalled request bodies; a fifth receives 429, and rejected requests release capacity.
- Four stored previews, response limited to preview metadata and summaries, five-minute expiry, and capacity recovery.
- Owner demotion or session expiry while a request body is still being received prevents the eventual encrypted download.
- Owner demotion while the private recovery-copy write is suspended prevents the HTTP restore commit. The existing file bytes and in-memory state remain exact, the completed recovery copy remains available, and the consumed preview cannot be reused.

The delayed-body and delayed-write cases use actual HTTP requests. The write delay intercepts only a synthetic temporary recovery path and restores the original filesystem function afterward. Account fixture setup calls the auth domain directly; preauth, cross-club route coverage and ordinary recovery flows belong to the account/API suites.

## Executed evidence

- `node --test tests/backup-review.test.mjs`: **5/5 passed**, 0 skipped, 9,013.2475 ms.
- After the final strict field-type checks, `node --test tests/backup-workspace.test.mjs tests/organization-recovery.test.mjs tests/backup-review.test.mjs`: **25/25 passed**, 0 skipped, 19,948.9207 ms.
- Earlier B integration run, `node --test tests/organization-recovery.test.mjs tests/backup-workspace.test.mjs tests/organizations.test.mjs`: **39/39 passed**, 0 skipped, 5,944.1833 ms.
- A's offline suite: **12/12 passed**, 0 skipped, 62,449.4948 ms; the subsequent CLI containment regression also passed **1/1**, 0 skipped, 8,130.0519 ms. Verified against `reports/v0.4/server-backup.txt`; the earlier cleanup failure is preserved separately in `server-backup-initial-failure.txt`.

These results were read from the actual tool output. Full stdout files were not saved for these worker runs; no reconstructed raw logs are supplied. Root's complete release verification provides the separate combined-run record.

The workspace/organization suites additionally cover current export/store rights for rolled-back snapshots and retained failed-job payloads, expiry immediately before commit, stale digests, durable restart, the ten-copy limit, injected write failures, unsafe paths, isolated clubs, and retention preview without starting pending jobs. A rejected restore can leave a private recovery copy and consume a preview; it must not change the active scouting state. That behavior is deliberate and tested.
