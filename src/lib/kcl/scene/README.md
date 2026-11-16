# KCL scene connections and refresh settings

This module connects KCL scenes to the engine and defines which preference
changes require KCL execution. It uses `ConnectionManager` for transport and
provides the refresh policy consumed by `KclManager` in the file route.

## Connection ownership

`connectScene` opens a supplied `ConnectionManager` in one of two presentations:
`streamed` receives rendered video; `local` requests a geometry-only connection
for the local renderer. It returns a `SceneConnection` handle or an `Error`.

The caller owns the handle and calls `dispose` when the scene closes. An optional
abort signal can also end the connection, including during startup. The startup
timeout covers browser codec inspection and connection establishment.

Each handle captures one connection. Its commands, resizing, and disposal cannot
act on a replacement connection opened on the same manager. `attachVideo` binds
that connection's media to a video element and returns a detach callback.
Detaching releases the presentation without closing the connection; an older
callback cannot detach media attached by a newer handle.

[`useTryConnect`](../../../hooks/network/useTryConnect.tsx) supplies the file route's React
state, DOM references, reconnect policy, and error reporting. Those decisions
remain with the caller of `connectScene`.

## Local renderer inputs

[`LocalRendererHost`](../../../clientSideScene/localRenderer/host.ts) supplies
`LocalWebGPUSceneView` with execution events, artifacts, native export, camera and
selection resources, and settings. The view does not need application providers.
`legacyLocalRendererHost` adapts `KclManager` and the file route's resources to
these inputs.

The host distinguishes the latest native model from the model published with its
artifact graph. Execution can finish before the graph is published; the renderer
uses those model generations to avoid displaying geometry with an older graph.
`SceneExecutionEvents` in this module defines the execution notifications that
presentations consume.

## KCL refresh policy

KCL extensions contribute refresh inputs through
`kclExecutionInputsValueSpec`. Each input has a stable ID, a reader of its
effective value, and a refresh rule. Generic `Setting` definitions do not need to
know which executors consume them.

For example, the core KCL policy includes:

```ts
provideKclExecutionInput({
  id: 'modeling.highlightEdges',
  read: (settings) => settings.modeling.highlightEdges.currentSignal.value,
  refresh: 'execute',
})
```

The two rules describe different operations:

- `execute` reruns KCL with the existing native cache. Default units, edge
  highlighting, and scale-grid visibility and size use this rule.
- `rebuild-streamed` clears the streamed scene and native cache before executing.
  Backface color uses this rule. The local renderer applies that color directly,
  so this input does not request native execution in local rendering.

`createSceneExecutionSettings` in `executionSettings.ts` reads the registry's live contribution signal and
the effective preferences. It provides native configuration through the existing
`jsAppSettings` conversion, plus comparison keys for deciding when to refresh.
Adding or removing a contribution updates those keys. Project overrides retain
their normal precedence, and replacing settings with equivalent values does not
request another execution.

`kclExecutionSettingsService` exposes the composed settings to `KclManager`. The
core contributions remain installed when project-shell editing is disabled,
because the file route also needs them.

## Applying changes to the active scene

`observeLegacySceneExecutionSettings` in `legacyExecutionSettings.ts` watches the
comparison keys.
`KclManager.watchSettings` supplies callbacks bound to the active file, project,
and connection: execute the model, clear its scene/cache, and check whether those
resources are still current.

Cache clears run in order. If an execute-only preference changes while a clear is
pending, execution waits for that clear; otherwise the clear could erase the
newly rendered model. Closing the observer, deactivating the file, or replacing
the connection prevents queued work from starting against stale resources.
Disposal cannot abort a native operation that has already started.

The observer records preference changes while inactive or disconnected without
executing. File opening and reconnecting own their initial execution, so simply
activating the observer does not request another one.

Presentation preferences use their existing consumers: theme and camera controls
update presentation, and viewport-style/SSAO changes request a connection restart.
They do not become KCL refresh inputs merely because they are settings.

The SDK integration direction and adapter constraints are documented in
[ADR 0001](../../../dev-docs/adr/0001-app-owned-scene-host.md).
