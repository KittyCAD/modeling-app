# App-owned scene boundary

This is the first extraction from the existing application, not a second engine
or a replacement for zoo-web-view. The integration goal is recorded in
[ADR 0001](../../dev-docs/adr/0001-app-owned-scene-host.md).

`connectScene` starts a supplied ConnectionManager for either streamed video or
geometry-only local rendering. The returned handle captures that connection:
commands, sizing, and disposal cannot target a subsequent connection on the same
manager. An abort signal owns the handle's lifetime after connection as well as
during startup. The deadline includes browser codec inspection. Video attachment
returns a release callback; releasing an older attachment cannot clear a newer
attachment of the same media. The caller disposes its handle when its scene
session closes, rather than when a temporary presentation unmounts.

The legacy `useTryConnect` hook adapts its React state, DOM references, reconnect
policy, and error reporting to this boundary. Those policies remain outside the
transport handle. ConnectionManager still supplies the application's WebSocket,
WebRTC, response correlation, and geometry-only behavior.

`LocalRendererHost` supplies execution events, model generations, artifacts,
native export, camera/selection resources, and settings explicitly.
`LocalWebGPUSceneView` consumes it without application providers.
`legacyLocalRendererHost` and the existing `LocalWebGPUScene` component adapt the
legacy route. Current and published model generations remain separate because
execution can finish before its artifact graph has been published. SceneInfra
and settings-actor types remain application-side inputs to the local renderer;
they are not requirements for zoo-web-view's public API.

## Shared execution settings

Settings that affect native execution declare their behavior on the existing
`Setting` definition:

```ts
sceneExecution: 'execute' // Re-execute with the existing native cache.
sceneExecution: 'rebuild-streamed' // Clear the streamed scene/cache, then execute.
```

`createSceneExecutionSettings` discovers these declarations across all setting
categories. It supplies stable revisions of effective values and a reactive
native configuration using the existing `jsAppSettings` conversion. Project
overrides and replacement Setting instances retain their normal precedence;
unchanged effective inputs do not invalidate execution. Adding another opted-in
setting requires no consumer-specific dependency list.

`observeSceneExecutionSettings` is the refresh/cache-rebuild logic extracted from
KclManager. Its legacy adapter supplies scene activity, connection status, and
captured path/project ownership; queued rebuilds cannot restart a closed or
replaced scene. The new KCL executor consumes the same revision and configuration,
with rebuilds serialized with execution/export by its native runtime. Native
execution applies edge visibility, grid visibility/scale, and backface settings.
The new host does not replay those settings after execution.

Presentation and connection settings remain explicit: theme, camera controls,
and local rendering update their existing presentation paths; the existing
effective viewport-style/SSAO policy requests a connection restart. A local
backface change updates LocalRenderer without clearing or executing native state.

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
selection clicks and hover are disabled unless a host supplies a fallback
accessor. The new command dialogs supply one: compatible empty arguments receive
picks first, followed by temporary dialog-only selection. Focused arguments still
take precedence, and temporary picks are never submitted. Camera navigation remains
available.
Closing the session reveals the unchanged underlying selection.

Execution invalidates the model target, clears view selection and registered
argument values, and suspends dialog picking. `bindCurrentModel()` explicitly
binds a fresh result; the caller then activates an argument and picks again.
`validate(values)` on the dialog session rejects stale or closed targets, even
for an empty argument. Command adapters must validate at preparation and commit,
alongside their existing source/execution checks. Raw engine references do not
prove model ownership. The Extrude/Loft command adapter uses the existing source
reference and region resolution routines, scoped to the dialog target and guarded
at preparation and commit. Its argument document includes entity references but cannot supply geometry
ownership tokens. A picking adapter holds only the current execution receipts.

Tests cover selection histories against an independent model, separate views,
argument ownership/cancellation, stale asynchronous replies, execution changes,
input cleanup, coordinate mapping, and the existing local GPU route. Before
publishing, smoke test stream/local profile picking and highlighting, Shift-click,
background clearing, orbit/pan/zoom, remounts, two views, and re-execution. Live
engine, packaged desktop, and GPU output still need that smoke test.

## KCL consumer

The project-shell KCL consumer now owns its ConnectionManager, native context,
source snapshots, and camera. It connects through this boundary and supplies an
explicit host to the local renderer. See [KCL Modeling](../kcl/README.md) for
ownership, renderer choice, tests, and the remaining packaged/web smoke checks.

The Extrude/Loft creation proofs from `codex/stdlib-extrude-proof` and
`codex/editor-dialogs` are now ported onto dialog-owned picking and the native
scene host. They share argument definitions and codemods with the legacy route.
See [the command/dialog contract](../kcl/README.md#modeling-tools).

Keep the eventual SDK adapter small: use public connection, command, sizing,
presentation, and disposal behavior. Do not depend on private `rtc` fields, a
`.start` element, or worker asset URLs inferred from `location.origin`.


## Rendering API limitation: arbitrary entity styling

The local renderer implements independently owned entity-styling groups through
`EntityStyling`. Each group supplies entity references, sRGB color, fill opacity,
outline opacity, line width, and priority. Higher priority wins when groups share
a rendered target; equal priority uses group creation order (later wins).
Replacing targets or appearance does not change that order. Clearing/disposal
reveals any lower-priority group. A scene reset expires old group handles.

The local renderer's generic compositor owns masks/materials and borrows mesh
geometry. The selection/hover adapter supplies their existing palette and higher
priorities; the compositor knows neither those meanings nor editor-view IDs.
Straight-alpha color conversion makes configured opacity match display blending.
Target resolution covers rendered ID-backed entities and graph-backed bodies;
an unresolved topological edge/vertex reference is not coerced into adjacent faces.

Zoo streaming still does not expose these arbitrary styling groups with color
and opacity controls. `select_entity` takes entity references;
`highlight_set_entities` takes IDs and replaces the shared hover highlight.
Reusing hover would conflict with normal pointer interaction. Streamed scenes
therefore expose no `entityStyling` capability, and their existing correspondence
fallback keeps the selection appearance while maintaining separate app state.

The shared Rendering API supports arbitrarily many independently
replaceable/clearable styling groups, each with entity targets and styling
properties such as color and opacity, plus a defined way to resolve overlapping
styles. Group ownership should be opaque to the renderer. The renderer should
not know about correspondence, source editor views, or interaction modes.

Application adapters can use styling groups for selection, hover, correspondence,
validation results, or other overlays. The application chooses precedence (for
example, selection over a faint correspondence tint) and assigns any stable
source-view OKLCH hues, converting them to renderer RGB colors. The local
renderer implements this capability in app-owned code; Zoo streaming needs
matching protocol/engine support. Do not simulate independent styles by changing
model materials or taking over the hover channel.


### Acquiring an entity-styling group

A local scene exposes `entityStyling`; streamed scenes currently expose
`undefined`. Call `createGroup(style)` and retain the returned handle with the
contributing interaction/view. `set(entities)` replaces only that group's targets;
`clear()` retains its creation order, and `dispose()` releases it. Both creation
and updates can return an Error. A new model invalidates old handles, so acquire
a new group against the current model rather than replaying stale references.
The API never sends selection commands, changes model materials, or owns mesh
geometry.
