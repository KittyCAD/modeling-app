# Legacy sketch WebSocket cassettes

`modelingMachine.legacySketch.spec.ts` runs the normal KCL Wasm interpreter,
modeling machine, guards, AST transformations, selection handling, editor updates,
camera transitions, and client-side sketch construction. MSW intercepts the real
WebSocket used by ConnectionManager. Only engine wire responses are replayed;
interpreter values, artifact graphs, source references, and default planes are
produced by real execution. No KCL mock execution is allowed.

The old JavaScript `RustContext.executeMock` redraw facade is redirected in this
test to normal execution of the complete current program. A truncated redraw
statement needs its preceding bindings; the bridge rejects a statement absent
from the current program. This exercises normal interpreter behavior rather than
the deprecated mock interpreter. It does not test that production facade's choice
of execution mode.

Each example has a JSON cassette in `__cassettes__/legacy-sketch`. A startup tape
warms interpreter initialization; each test resets its cache and engine scene
before replay, so examples can run independently or shuffled. Requests match their
complete payload, allowing asynchronous requests to interleave. A bijective UUID
mapping preserves command correlation and geometry references across messages,
including UUID keys in batch responses. Other values, including coordinates, are
matched exactly. Missing, extra, or changed requests fail without live fallback.

MSW handles interception and explicit recording pass-through. Vitest file snapshots
handle persistence and updates. The small engine-specific adapter handles UUID
aliases, request/response correlation, and controlled response gates; unit/property
tests cover these matching rules. Authentication/session and keepalive frames are
synthetic during replay. Credentials and live session metadata are never saved.
Unrelated HTTP traffic is blocked except for a fixed failed user-feature response.

The 82 original examples retain named-dimension, individual-constraint removal,
remove-all, and segment-deletion assertions. Four additional cases gate actual
socket responses to check camera acknowledgement, geometry readiness, camera
rejection, and persistence after rebuilding a named dimension.

`modelingMachine.legacySketch.engine.spec.ts` retains eight live contracts, one per
geometry family. They compare real geometry and source relationships with the
previously verified expectations in `modelingMachine.legacySketch.contracts.json`,
independently of generated IDs. The two swept-face tests in
`modelingMachine.spec.ts` still need a real engine for face selection/orientation
and sketch reload. Replay cannot establish current kernel correctness, live
protocol compatibility, authentication, or WebRTC/rendering behavior.

## Updating cassettes

Record only when example programs or their wire contract intentionally change.
A built Wasm blob and development engine token are required. Use the same Wasm
build for capture and replay. No interpreter results or geometry are synthesized.

From the repository root:

```sh
ZDS_RECORD_ENGINE_CASSETTES=1 npm run test:integration -- \
  src/machines/modelingMachine.legacySketch.spec.ts \
  --retry=0 --maxWorkers=1 --bail=1 --update
```

Inspect the JSON diff, then rerun with recording disabled and without `--update`.
The ordinary replay path only reads committed files. Use Vitest's `-t` option to
refresh one example after an interrupted recording, rather than repeating the
whole matrix. Run the eight live geometry contracts and two swept-face tests
against the engine before accepting intentional protocol changes. Update their
independent geometry expectations only for a separately understood semantic change.
