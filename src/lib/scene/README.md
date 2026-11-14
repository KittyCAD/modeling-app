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

## Subsequent local stack

1. Port KCL source loading and execution from `codex/kcl-modeling`, using an owned
   ConnectionManager and app WASM instead of the prototype's SDK worker and DOM
   controls. A new scene must not borrow the legacy route's active manager.
   Preserve the current executor APIs' returned errors when adapting the older
   prototype. Prove both packaged desktop asset loading and web operation.
2. Supply the new execution's artifacts, native exports, and camera resources to
   the local-renderer host. Retain both streamed and local presentations and test
   switching projects, closing views, late completions, and renderer remounts.
3. Port the explicit command/execution bindings and Extrude/Loft examples from
   `codex/stdlib-extrude-proof` and `codex/editor-dialogs`. Keep legacy adapters
   using the same definitions and codemods. This proves the tool host, not full
   modeling parity.
4. If the previous steps are stable, add a small Enter/Edit sketch round trip and
   basic sketch-tool examples. Sketch interaction is not another editor mode.
   Keep full sketch parity and the final reversible UI-hiding pass explicit.

Keep the eventual SDK adapter small: use public connection, command, sizing,
presentation, and disposal behavior. Do not depend on private `rtc` fields, a
`.start` element, or worker asset URLs inferred from `location.origin`.

## Verification

The connection tests cover streamed/local selection, codec failures, cancellation
and deadlines during startup, captured ownership, and video attachment cleanup.
The legacy reconnect suite exercises the existing hook through this boundary.
The local-renderer suite exercises its real export/GLTF parsing path through the
legacy adapter; a presentation test mounts without app or modeling providers.
These tests do not establish live-engine, packaged desktop, or GPU behavior.
Smoke test the existing route with both renderer settings before publishing this
extraction, then repeat the same scenarios against the new KCL host.
