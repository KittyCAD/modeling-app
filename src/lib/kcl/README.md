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
leave camera controls and the streamed connection unchanged. Execution, native
export, and scene rebuilds share a queue so disposal can wait for borrowed native
memory.
The renderer choice is captured when the scene opens; reopen the Modeling view
after changing it. Each view's settings revision uses that captured choice,
so an already-open streamed view still receives streamed rebuilds even if the
preference now selects local rendering for new views.

The [scene boundary](scene/README.md) describes the shared host and legacy
adapters. Zoo-web-view remains the intended presentation integration; the
[scene-host ADR](../../dev-docs/adr/0001-app-owned-scene-host.md) records that
boundary and its ownership decisions.

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
