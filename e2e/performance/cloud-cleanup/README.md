# Native cloud cleanup lifecycle probe

This never-merge diagnostic exercises the real first-upload resource fixture
copied unchanged from main PR commit `ebc1f257420be002935d02f26b5962d39a6248fa`.
It uses the existing Home creation UI, development API, upload-response hold,
and initial uploaded-file assertions. After observing a successful POST it enters
an unresolved wait, leaving the response held until the original 120-second test
deadline. The fixture, rather than test-body cleanup, must close the page and
delete only this run's uniquely named project.

Run from the repository root with the same development API environment as the
normal web suite:

```sh
npm exec -- playwright test --config=e2e/performance/cloud-cleanup/playwright.config.ts --headed
```

The isolated configuration runs headed Chrome, one worker, no retries, and a
four-minute global deadline. It uses the local checkout and disables diagnostic
spans, traces, screenshots, and video. It does not change the main suite or its
timeouts. The workflow mode `cloud-cleanup` supplies the existing Windows setup,
Wasm, and development API credential.

The test and job are expected to fail with the original test timeout. Inspect
`test-results/cloud-cleanup/result.json`: `cleanupProofValid` is true only for one
original-deadline timeout with no other errors, a successful real POST followed
by the diagnostic wait, and an independent afterAll GET returning 404 after
fixture teardown. An early failure, absent receipt, extra error, or global timeout
is not a valid proof. `cleanup-receipt.json` contains the stage evidence. Neither
artifact contains project identity, credentials, response bodies, or raw errors.

If independent readback finds the exact captured project still present, it
attempts fallback deletion and records both statuses. Fallback cleanup never
counts as proof that fixture teardown succeeded. The probe does not establish
the outcome of a server-side POST that completes after the browser cancels it;
its deliberate timeout starts only after a successful POST response is observed.
