# KCL editors

This package adds KCL syntax to Code views and a Modeling mode to project-owned
editors. Code and Modeling work on the same live document: editing either
presentation updates the buffer, and execution uses its current contents without
waiting for a save. These contributions require `zds_project_shell_refactor`.

Each Modeling view has its own model and camera. Two views of one document share
text while keeping their engine connections and native contexts independent.

## From a document to a model

The registry contribution connects three parts:

1. **Capture sources.** The project source service captures the entrypoint and
   open imported buffers, including unsaved edits. Project sessions supply byte
   reads for other files. KCL declares its supported import types.
2. **Execute.** The executor runs that snapshot through the view's native KCL
   runtime. Changes to the buffer, imported buffers, project contents, or opted-in
   settings invalidate the previous run. External storage updates enter through
   the project/editor services before they become execution input.
3. **Present.** `KclScene` attaches the scene and displays its streamed or local
   rendering. Switching tabs or remounting React attaches the existing session.

The [executor guide](../executors/README.md) describes scheduling and output.
[Scene settings](../scene/README.md#shared-execution-settings) explains how a
setting opts into execution refresh.

## Ownership and lifetime

| Owner | Responsibility |
| --- | --- |
| Editor | Working text and undo history shared by its presentations |
| Project source service | Working-document precedence, project membership, captured bytes, and source revisions |
| Modeling view's executor | Run cancellation, results, and scene lifetime |
| `createKclSession` | Connection startup, presentation attachment, resizing, and recovery |
| `createKclRuntime` | Native model memory and serialized execution, export, and disposal |

The session opens a connection once its mounted viewport has a usable size.
Closing the view, editor, or project releases its owned execution resources.
Startup and execution have deadlines; cancellation also releases resources that
finish opening after their owner has closed.

Connection progress uses the shared `Loading` view. A connection failure displays
`ConnectionRecovery` with a Reconnect action. Manual retry and returning focus to
a failed or stale mounted scene use the same recovery path: open a fresh
connection, then refresh that executor from current sources. Each attempt owns
its callbacks, so late failures cannot replace a newer connection. KCL execution
errors are reported separately from connection failures.

## Rendering

Both presentations use the application's `ConnectionManager` and camera controls:

- **Streamed:** the connection supplies video from the engine.
- **Local:** a geometry-only connection supplies native execution output to
  `LocalWebGPUSceneView` through `LocalRendererHost`.

Native execution applies settings declared through `sceneExecution`.
[`presentationPreferences.ts`](presentationPreferences.ts) groups the camera,
appearance, local-renderer, and unit inputs by consumer. Renderer-only updates
leave camera controls and the streamed connection unchanged. Execution, native export, and scene
rebuilds share a queue so disposal can wait for borrowed native memory.
The renderer choice is captured when the scene opens; reopen the Modeling view
after changing it.

The [scene boundary](../scene/README.md) describes the shared host and legacy
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

- [`registry/index.ts`](registry/index.ts): contributes KCL editing and Modeling.
- [`project sources`](../projectSession/next/sources.ts): captures working documents
  and stored bytes for a specific project opening.
- [`executor.ts`](executor.ts): connects an editor executor to its scene session.
- [`session.ts`](session.ts): owns connection and presentation lifetime.
- [`runtime.ts`](runtime.ts): owns native KCL operations.
- [`scene.ts`](scene.ts): assembles a connection, runtime, camera, and renderer host.
- [`KclScene.tsx`](KclScene.tsx): renders the Modeling viewport.
