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

## View selection and dialog picking

`createSceneSelection` owns ordinary selection for one Modeling view. Its model
identity includes both a scene and a fresh execution identity; every native run,
including a cache hit or a settings refresh, invalidates previous references.
Closing the scene cancels pending picking and highlighting work. Two views of
one buffer have independent selections.

`sceneSelectionAdapter` uses the point-query helper extracted from the legacy
selection module. ConnectionManager sends it to the stream engine or routes it
to the existing LocalRenderer GPU picker. Highlight projection uses the existing
selection/filter commands, including the local renderer's selection sync. The
adapter adds no raycaster or transport. Nonempty highlights use one replacement
command, with no intermediate clear; filters are sent only when they change or
a new execution becomes current. Entity reference identity is extracted
from queryAst and re-exported there for existing consumers.

Click selects one entity, Shift-click toggles membership, and a background click
clears selection (Shift-background leaves it alone). Camera drags do not select.
Clear selection and Escape clear ordinary view selection. Hover uses the
SceneInfra input canvas instead of looking up another view's video element.

A dialog supplies argument accessors pointing at its own values:

```ts
const picking = scene.selection.beginPicking({
  arguments: [profilesArgument],
  seed: 'profiles',
})
if (picking instanceof Error) return picking
picking.activate('profiles')
```

Each argument has `id`, `filter`, `multiple`, `value`, `setValue`, and `accepts`.
Only the explicit seed argument receives compatible copies of the initial view
selection. The session stores no second copy of argument values or restoration
snapshot. Its active argument supplies the highlights; with no active argument,
selection clicks and hover are disabled. Camera navigation remains available.
Closing the session reveals the unchanged underlying selection.

Execution invalidates the model target, clears view selection and registered
argument values, and suspends dialog picking. `bindCurrentModel()` explicitly
binds a fresh result; the caller then activates an argument and picks again.
`validate(values)` on the dialog session rejects stale or closed targets, even
for an empty argument. Command adapters must validate at preparation and commit,
alongside their existing source/execution checks. Raw engine references do not
prove model ownership. Legacy command-selection conversion remains with the
subsequent command integration; it must reuse existing resolution routines.

Tests cover selection histories against an independent model, separate views,
argument ownership/cancellation, stale asynchronous replies, execution changes,
input cleanup, coordinate mapping, and the existing local GPU route. Before
publishing, smoke test stream/local profile picking and highlighting, Shift-click,
background clearing, orbit/pan/zoom, remounts, two views, and re-execution. Live
engine, packaged desktop, and GPU output still need that smoke test.

## KCL consumer

The project-shell KCL consumer now owns its ConnectionManager, native context,
source snapshots, and camera. It connects through this boundary and supplies an
explicit host to the local renderer. See [KCL Modeling](../README.md) for
ownership, renderer choice, tests, and the remaining packaged/web smoke checks.
