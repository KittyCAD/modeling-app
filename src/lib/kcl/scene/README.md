# KCL scene connections and execution events

This is the first extraction from the existing application, not a second engine
or a replacement for zoo-web-view. The integration goal is recorded in
[ADR 0001](../../../dev-docs/adr/0001-app-owned-scene-host.md).

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

`observeSceneExecutionSettings` contains the refresh and cache-rebuild logic
extracted from KclManager. The legacy adapter supplies scene activity, connection
identity, and the current file and project. A newer execution setting waits for
the latest queued rebuild; closing, deactivating, or replacing the scene prevents
queued work from restarting it. Native execution still applies edge visibility,
grid visibility/scale, and backface settings.

Presentation and connection settings remain explicit: theme, camera controls,
and local rendering update their existing presentation paths; the existing
effective viewport-style/SSAO policy requests a connection restart. A local
backface change updates LocalRenderer without clearing or executing native state.

Keep the eventual SDK adapter small: use public connection, command, sizing,
presentation, and disposal behavior. Do not depend on private `rtc` fields, a
`.start` element, or worker asset URLs inferred from `location.origin`.
