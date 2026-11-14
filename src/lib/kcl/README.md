# KCL editors

This package adds KCL syntax to Code views and a Modeling mode to project-owned
editors. A Code view edits the live document; a Modeling view executes its current
contents and presents the resulting model without waiting for a save. These
contributions require `zds_project_shell_refactor`.

Modeling views of one editor lease a shared executor. Its KCL output is a captured
source snapshot, including working imports; it contains no connection-specific
geometry or entity IDs. Each view separately owns an engine connection, native
context, camera, and the native execution result for that scene. Thus source
capture is shared, while native KCL execution still runs for each connection.
Consumers can explicitly create independent executors when they need that policy.

## From a document to a model

The registry contribution connects these parts:

1. **Capture sources.** The project source service captures the entrypoint and
   open imported buffers, including unsaved edits. Project sessions supply byte
   reads for other files. KCL declares its supported import types.
2. **Publish shared input.** The shared executor publishes the source snapshot.
   Buffer, imported-buffer, and project changes replace it for all consumers.
   External storage updates enter through project/editor services first.
3. **Execute per scene.** `createKclViewExecution` sends that snapshot to each
   view's native runtime. Execution settings can refresh a scene without
   recapturing sources. Native results and failures remain local to that view;
   source-capture failures are shared.
4. **Present.** `KclScene` attaches the scene and displays its streamed or local
   rendering. Switching tabs or remounting React attaches the existing session. The local
   renderer asks that retained scene whether initial camera framing is still
   needed, so a presentation remount preserves the camera.

The [executor guide](../executors/README.md) describes scheduling and output.
[Scene settings](scene/README.md#kcl-refresh-policy) explains how a
setting opts into execution refresh.

## Ownership and lifetime

| Owner | Responsibility |
| --- | --- |
| Editor | Working text and undo history shared by its presentations |
| Project source service | Working-document precedence, project membership, captured bytes, and source revisions |
| Shared executor | Source-capture cancellation and connection-independent output |
| Modeling view context | Executor lease, scene session, preferences, and native-result observer |
| `createKclSession` | Connection startup, presentation attachment, resizing, and recovery |
| `createKclRuntime` | Native model memory and serialized execution, export, and disposal |

The session opens a connection once its mounted viewport has a usable size.
Closing one view releases its scene and executor lease; sibling views retain
their scenes and the shared executor. Closing the final lease releases that
executor. Explicit executor shutdown also closes its views' scene sessions.
Startup and execution have deadlines; cancellation also releases resources that
finish opening after their owner has closed.

Connection progress uses the shared `Loading` view. A connection failure displays
`ConnectionRecovery` with a Reconnect action. Manual retry and returning focus to
a failed or stale mounted scene use the same recovery path: start opening a fresh
connection and replay the latest shared snapshot in that scene. A healthy sibling
does not rerun, and recovery does not refresh the shared executor. Source capture
can run while connections open; each native execution waits for its own scene.
Each attempt owns its callbacks, so late failures cannot replace a newer
connection. KCL execution errors are reported separately from connection failures.

Unexpected transport closes request automatic recovery, with a bounded retry
budget shared with the legacy WebSocket hook. Terminal failures wait for manual
retry. Browser connectivity and focus events recover only the affected session;
they do not reopen healthy sibling views. Disconnect reports include a view ID,
file, renderer, and the captured connection's diagnostic state.

Streamed sessions honor the stream idle timeout. Input and execution postpone
idling; activity resumes a paused scene. The session retains its last synchronized
camera pose across idle and transient reconnects, restoring it after the next
execution instead of framing the model again. Closing the view discards that pose.
Local rendering is exempt from idle teardown.

## Sharing native execution

The shared executor currently saves source-capture work, including reading imports.
It does not eliminate native execution per view.
[`createKclRuntime`](execution/runtime.ts) creates a WASM context bound to one
engine connection. Execution builds that connection's scene, and its artifact
references address geometry in that scene. An independent streamed view needs
its own scene to render. Local views currently have the same requirement because
they also execute through a geometry-only engine connection.

[`createKclViewExecution`](modeling/viewExecution.ts) bridges that boundary: each
view executes the shared snapshot and retains its own native results and failures.
This accommodates the current engine integration; it is not a requirement that
future executors repeat all native computation for every presentation.

Sharing native execution would require:

1. A reusable geometry and artifact result that does not depend on the producing
   connection or borrow memory freed when its view closes. Its shared owner would
   need to retain it for all consuming views.
2. A way for independent engine connections to present that result, through scene
   installation or shared model references, including any mapping needed for
   connection-specific geometry references. A local-renderer path could instead
   consume reusable geometry directly; that would not by itself solve streaming.
3. A definition of which source and execution-setting revisions identify the same
   reusable result. View-specific presentation settings must remain independent.
4. Per-view camera, selection, and connection lifetimes. Reconnecting a view would
   present the current result in its replacement scene without rerunning healthy
   sibling views or discarding their interaction state.

With those capabilities, the bridge could consume shared native results and
coordinate their presentation. Deleting the bridge alone would not populate the
other connections' scenes. That separation is future work, not an API supplied
by this package today.

## Rendering

Both presentations use the application's `ConnectionManager` and camera controls:

- **Streamed:** the connection supplies video from the engine.
- **Local:** a geometry-only connection supplies native execution output to
  `LocalWebGPUSceneView` through `LocalRendererHost`.

Native execution uses `kclExecutionSettingsService`, the same composed policy
consumed by the legacy file route. The registry resolves it when execution inputs
are observed or a scene session is created, after registry setup.
[`scene/presentationPreferences.ts`](scene/presentationPreferences.ts) groups the camera,
appearance, local-renderer, and unit inputs by consumer. Renderer-only updates
leave camera controls and the streamed connection unchanged. Native execution and
export share a queue so disposal can wait for borrowed native memory. Rust decides when execution requires cache invalidation or graphics
settings to be reapplied.
Changing the renderer preference replaces the connection and native runtime in
existing Modeling views. Geometry-only mode is fixed when an engine connection
opens, so switching renderers requires a new connection. Each view keeps its
shared executor and full camera, including projection, and executes the latest
shared snapshot in its replacement scene. Hidden or detached views release their
old scene immediately and open the replacement once their viewport has a usable
size. Repeated switches discard stale startup results and camera updates.

Each connection keeps its presentation fixed for its lifetime. The refresh policy
follows the intended renderer, and reconnects use that same choice. Restoring a
camera into a local scene also consumes initial framing so a delayed model load
cannot replace the saved viewpoint with zoom-to-fit.

The [scene boundary](scene/README.md) describes the shared host and legacy
adapters. Zoo-web-view remains the intended presentation integration; the
[scene-host ADR](../../dev-docs/adr/0001-app-owned-scene-host.md) records that
boundary and its ownership decisions.

## Selection

Each view owns geometry selection through `resource.selection`, scoped to its
current execution. Both renderers use the existing picking adapters. Opening a
command dialog gives its arguments a separate picking session; cancelling leaves
the underlying view selection intact. Re-execution invalidates old geometry picks.
See [the selection contract](../scene/README.md#view-selection-and-dialog-picking).

## Code map

- `execution/`: source capture, native execution, and native input metadata.
- `scene/`: connection and renderer assembly, viewport presentation, and settings.
- `modeling/`: per-view sessions, snapshot consumption, and React presentation.
- `registry/`: composes KCL capabilities into editor views.

- [`registry/index.ts`](registry/index.ts): contributes KCL editing and Modeling.
- [`project sources`](../projectSession/next/sources.ts): captures working documents
  and stored bytes for a specific project opening.
- [`execution/executor.ts`](execution/executor.ts): contributes shared source capture.
- [`modeling/viewExecution.ts`](modeling/viewExecution.ts): runs shared snapshots in one view's native session.
- [`modeling/session.ts`](modeling/session.ts): owns connection and presentation lifetime.
- [`execution/runtime.ts`](execution/runtime.ts): owns native KCL operations.
- [`scene/open.ts`](scene/open.ts): assembles a connection, runtime, camera, and renderer host.
- [`modeling/KclScene.tsx`](modeling/KclScene.tsx): renders the Modeling viewport.
