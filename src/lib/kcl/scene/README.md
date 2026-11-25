# KCL scenes

This module connects KCL scenes to streamed or local rendering, applies scene
settings, and manages selection for Modeling views. The legacy file route uses
the same connection, viewport, and settings helpers through adapters.

See [KCL editors](../README.md) for source capture, execution, and view lifetime,
and [ADR 0001](../../../dev-docs/adr/0001-app-owned-scene-host.md) for the scene-host
design and planned SDK integration.

## Connections and rendering

[`connectScene`](connection.ts) opens a supplied `ConnectionManager` in one of two
presentations: `streamed` receives rendered video; `local` requests geometry for
the local renderer. It returns a `SceneConnection` handle or an `Error`.

The caller disposes the handle when the scene closes. An abort signal can cancel
startup or close an established connection. The startup timeout includes browser
codec inspection and connection establishment.

Each handle controls the connection it opened. It cannot send commands to, resize,
or close a replacement connection on the same manager. `attachVideo` attaches its
media to a video element and returns a detach callback. Detaching leaves the
connection open, and an old callback cannot detach a newer attachment.

The caller decides when to reconnect and how to report errors. The legacy route
supplies these decisions through
[`useTryConnect`](../../../hooks/network/useTryConnect.tsx); Modeling views use
[`createKclSession`](../modeling/session.ts).

[`LocalRendererHost`](../../../clientSideScene/localRenderer/host.ts) supplies the
local renderer with native export, execution events, artifacts, camera, selection,
and settings. `legacyLocalRendererHost` supplies these inputs from `KclManager`
and the file route. The renderer uses the host's model generations to wait until
geometry and its artifact graph belong to the same execution.

## Viewport and presentation preferences

Both hosts share the resize and pixel-density observers in
[`viewport.ts`](viewport.ts). They also share camera-input preferences and sketch
foreground themes through [`applyPreferences.ts`](applyPreferences.ts).

The hosts decide when to attach and release these helpers. They also retain their
own sketch projection, render-resume, reconnect, and idle behavior. The shared
helpers do not schedule execution or recovery.

## KCL refresh policy

KCL extensions declare settings that require execution through
`kclExecutionInputsFacet`. Each contribution supplies a stable ID, a function
reading the effective setting value, and a refresh rule. The generic `Setting`
type does not need to know about KCL.

For example, edge highlighting requests execution in either renderer:

```ts
provideKclExecutionInput({
  id: 'modeling.highlightEdges',
  read: (settings) => settings.modeling.highlightEdges.currentSignal.value,
  refresh: 'execute',
  legacyRefresh: 'direct',
})
```

The two rules select which Modeling views request execution:

- `execute`: request execution for both presentations. Default units, edge
  highlighting, and scale-grid visibility and size use this rule.
- `execute-streamed`: request execution for streamed scenes. Backface color uses
  this rule because the local renderer applies it directly.

The legacy file route uses `legacyRefresh: 'direct'` for edge highlighting,
scale-grid visibility and size, and backface color. `KclManager` applies these
through engine APIs without executing KCL. Default units and contributed inputs
without this override retain their execution rules in both hosts.

[`createSceneExecutionSettings`](executionSettings.ts) combines the contributed
values into comparison keys and converts settings to native configuration through
`jsAppSettings`. Adding or removing contributions changes the keys. Replacing a
setting with an equivalent value does not. Project overrides keep their normal
precedence.

`kclExecutionSettingsService` publishes these settings to both KCL consumers. The
core contributions remain installed when the project-shell feature is disabled
because the legacy file route needs them too.

For that route,
[`observeLegacySceneExecutionSettings`](legacyExecutionSettings.ts) watches the
legacy comparison keys, which exclude inputs applied directly. It requests
execution when a key changes while the scene is active and connected.
`KclManager.watchSettings` supplies the execution callback and a check that its
file, project, and connection are still current. Changes while inactive or
disconnected update the comparison baseline; opening and reconnecting request
their own initial execution. Rust decides whether to reuse cached geometry and
reapply graphics settings. The observer does not clear the scene or native cache.

Presentation preferences have separate consumers. Theme and camera preferences
update the presentation directly. Viewport-style and SSAO changes restart the
connection rather than becoming KCL execution inputs.

## View selection

[`createSceneSelection`](selection.ts) manages selection for one Modeling view.
Two views of the same editor have independent selections. Each selected reference
records the scene and execution that produced it. Re-execution clears selections,
including when native execution uses its cache. Closing the scene prevents pending
pick or highlight results from updating it.

A click selects one entity; Shift-click toggles its membership. Clicking the
background clears selection, while Shift-clicking the background leaves it
unchanged. Camera drags do not select. Escape and Clear selection clear the view's
selection when no dialog owns picking.

[`sceneSelectionAdapter`](selectionAdapter.ts) uses the shared
[point-query helper](picking.ts) with the clicked view's canvas and connection.
`ConnectionManager` sends the query to the streamed engine or the existing local
GPU picker. The adapter uses the same selection and filter commands for both
renderers. It replaces highlights in one command to avoid a visible clear between
updates, and resends filters when they change or the model re-executes. Hover also
uses the owning view's canvas.

[Entity-reference helpers](entityReference.ts) can be imported without loading AST
or WASM modules. `queryAst` re-exports them for existing callers.

## Dialog picking

A dialog registers its selection fields with `beginPicking`:

```ts
const picking = scene.selection.beginPicking({
  arguments: [profilesArgument],
  seed: 'profiles',
})
if (picking instanceof Error) return picking
picking.activate('profiles')
```

Each field supplies its `id`, allowed entity types (`filter`), whether it accepts
multiple selections (`multiple`), a compatibility check (`accepts`), and its
current value and setter (`value` and `setValue`). Accepted picks update the
field through that setter. The view's selection stays unchanged.

The optional `seed` names the field that receives compatible copies of the view's
initial selection. The active field supplies the scene highlights. With no active
field, selection clicks and hover are disabled; camera navigation remains
available. Closing the session restores highlights from the view's selection.

Re-execution clears the registered fields and invalidates the dialog's model
target. To resume picking, the dialog calls `bindCurrentModel()` and activates a
field again. Before using picked geometry, command adapters call the session's
`validate(values)` during preparation and again at commit, alongside their source
and execution checks. Validation rejects references from a replaced model or a
closed session, including an empty argument whose session is no longer valid.
An engine reference alone does not establish which scene and execution it belongs
to.
