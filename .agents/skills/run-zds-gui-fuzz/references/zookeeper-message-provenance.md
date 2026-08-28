# Zookeeper message provenance

Use this protocol when a GUI run must explain whether repeated Zookeeper output originated in the browser, transport, or backend.

## Safe probe

1. Create an isolated project and embed a unique generated `probeId` in one harmless prompt.
2. Capture a settled baseline before submission, the immediate submitted state, the first response state, and the final settled state.
3. Run a normal single-submit control before any rapid-click, cancel, retry, navigation, reconnect, or reload seed.
4. Never capture authorization or cookie values. Store payload metadata and hashes by default, not raw payload bodies.

## Required ledgers

Write UTC ISO timestamps and monotonic offsets into every ledger so separate systems can be aligned.

### Outbound request ledger

For each prompt submission or related request/frame, record:

- `probeId`, direction, transport, method or frame type, sanitized URL path;
- browser request ID or locally assigned sequence number;
- client message, conversation, thread, API-call, trace, and idempotency IDs when exposed;
- payload byte count and SHA-256 of normalized non-secret content;
- initiation and completion offsets, status, retry/cancel reason, and stack initiator when available.

### Inbound transport ledger

For each HTTP streaming chunk, SSE event, or WebSocket frame, record:

- direction, transport, sequence, event type, byte count, and normalized-content hash;
- message, response, run, conversation, thread, API-call, trace, span, and checkpoint IDs when exposed;
- receive offset, terminal status, reconnect/replay markers, and close/error metadata.

For Chromium runs, corroborate the Playwright WebSocket events with an
independent Chrome DevTools Protocol ledger. Compare frame direction, socket,
byte count, type, and payload hash. If both instruments observe the same
duplicate frame, it is not a Playwright listener artifact. Persist the two
ledgers separately; never count both copies as two product events.

### Application-state ledger

At each checkpoint, inspect the browser-owned message state when safely accessible and record:

- ordered message IDs, roles, statuses, parent/run IDs, normalized-content hashes, and occurrence counts;
- loading/streaming/retry state and the action that caused the snapshot;
- a hash of the sanitized snapshot rather than full message content.

If no stable store is exposed, say so and keep the transport-to-DOM boundary explicit.

### DOM ledger

At the same checkpoints, record every rendered conversation item:

- DOM order, role, stable data attributes, accessible-label or normalized-text hash, occurrence count, and visibility;
- duplicate React-key warnings, mounts/unmounts if instrumented, and a screenshot filename.

## Diagnosis matrix

| Evidence | Likely boundary |
| --- | --- |
| One user action, two outbound submissions with the same probe or client ID | GUI event/action duplication |
| One outbound submission, two backend runs or distinct response IDs with equivalent content | Backend retry/idempotency or orchestration |
| One inbound event/message ID appears twice after reconnect or replay | Transport/replay deduplication |
| Transport contains one message, application state contains two | Browser reducer/store duplication |
| Application state contains one message, DOM renders two | Rendering/keying duplication |
| Two DOM items have different IDs but equal hashes | Do not infer a frontend duplicate; trace the distinct IDs upstream |

Do not classify on equal text alone. IDs, direction, ordering, retry/replay markers, and the passing single-submit control are required.

## Backend-log handoff

Produce a compact `zookeeper-correlation-summary.json` containing the run
window in UTC, `probeId`, sanitized app URL, outbound submission count, inbound
live terminal-message count, replayed terminal-message count, replay-envelope
count, DOM occurrence count, and every exposed
trace/API-call/conversation/thread ID. Include exact artifact paths and clock
limitations. The standard browser artifacts are:

- `zookeeper-transport-ledger.json`;
- `zookeeper-cdp-transport-ledger.json` when Chromium CDP is available;
- `zookeeper-state-ledger.json`;
- `zookeeper-dom-ledger.json`;
- `zookeeper-correlation-summary.json`.

This is the handoff for separate Opik or backend-log investigations. Do not
claim backend duplication when the browser did not expose the necessary
correlation fields, and do not count replayed history as a new live response.
