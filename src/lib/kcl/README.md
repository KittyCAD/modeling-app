# KCL Modeling in the project shell

The KCL registry contribution supplies syntax, an executor capability, and the
Modeling editor presentation. It is gated with the new project shell. Each
Modeling view creates its own executor; two views of the same document share text
but own separate engine connections, native contexts, cameras, and models.

The executor captures the entrypoint and unsaved imported buffers before file
reads. Other relevant project files are read as bytes, including binary imports.
A project replacement or cancelled run invalidates the snapshot. The capability's
revision observes project contents, open buffers, and the shared scene-execution
settings revision. Settings opt in beside their definitions through
`SettingProps.sceneExecution`; the KCL registry has no separate setting list.
External storage changes must first be adopted by the project/editor services,
as on other executor-backed surfaces.

The scene session starts only after a mounted presentation has a usable size.
React remounts attach the existing scene; closing the view/editor/project closes
the executor scope. Startup and execution have deadlines, disconnects surface an
error, and closing during startup disposes late resources. Returning focus to a
mounted view recreates a failed or stale connection and refreshes only its owning
executor. That refresh reloads the current editor/import snapshots and clears old
execution errors; it does not replay a saved document snapshot or restart healthy
sibling views. Each opening has its own readiness, cancellation, and camera-frame
state so late callbacks cannot affect a replacement connection.

The session uses `connectScene` with an independent ConnectionManager. Streamed
presentation attaches its video and uses the application's camera controls. Local
presentation uses a geometry-only connection and supplies execution events,
artifacts, generations, native GLB export, and the same camera to
LocalWebGPUSceneView. Native execution owns edge/grid/backface settings; the host
updates camera, theme, and connection presentation without replaying those native
settings after execution. Streamed backface changes rebuild the native scene
before re-execution; the local renderer applies its color directly. Native
exports, rebuilds, and executions share a queue; disposing waits
for borrowed native memory before freeing it. The renderer setting is captured
when the scene opens; reopen the Modeling view after changing it.

The WASM promise comes from the app registry, with the app's asset-relative loader
as a fallback. There is no SDK worker, `file://` rejection, `location.origin`
assumption, private RTC access, or SDK DOM selector. Zoo-web-view remains the
intended presentation adapter; project storage, executor ownership, and native
execution stay outside that integration. See
[the scene-host decision](../../dev-docs/adr/0001-app-owned-scene-host.md).

This is execution/presentation proof, not full modeling-tool parity. Selection,
command tools, dialogs, and Enter/Edit sketch are subsequent work; local picking
and default planes remain disabled in this inspection view.

## Smoke testing before publishing

Open a project through the new shell in a web build and packaged desktop build.
With each renderer setting, open a KCL file in Modeling alongside Code; change
geometry and an imported module without saving. Check the model updates, camera
orbit/pan/zoom, resizing, switching tabs, syntax-error recovery, project switching,
and closing one of two Modeling views without disturbing the other. Test a binary
import and a disconnected engine, then reopen the view to reconnect.

Unit tests exercise presentation choice, captured source bytes, ownership,
deadlines, cancellation, remounts, and dependency invalidation. Native WASM tests
execute KCL with imports, independent contexts, error recovery, and serialized
exports/disposal using mocked engine acknowledgements. Existing local-renderer
tests cover GLB loading. These checks do not prove live-engine geometry, GPU
output, or packaged-desktop behavior.
