# Kclean engine prototype

The first-principles viewport can send its complete virtual KCL project to the
Kclean demo server and render the returned GLB locally with Bevy. Kclean is an
execution engine setting, separate from the renderer preference. Selecting
Kclean always makes Bevy the effective renderer; switching back to Zoo restores
the renderer preference that was already selected.

## Start the Kclean server

From a Kclean checkout, build the kernel bridge and server as described in
`tools/kclean-server/README.md`, then run:

```sh
tools/kclean-server/target/debug/kclean-server
```

It listens on `http://127.0.0.1:3001` by default so it can run beside ZDS's port
3000 development server. The prototype endpoint has permissive CORS for this
local setup and has no authentication; do not expose it publicly without an
authenticated reverse proxy and process isolation.

## Build and run ZDS

From this ZDS checkout:

```sh
npm run build:bevy
npm start
```

The Bevy build script checks out the experimental renderer under `vendor/`,
applies the Kclean integration, certified-checkpoint, persistent-socket, and
latest-wins patches idempotently, then installs the generated JavaScript, WASM,
and assets in their Vite locations.

In **Settings → Modeling**:

1. Set **Modeling engine** to **Kclean (experimental)**.
2. Leave **Kclean server** at `http://127.0.0.1:3001`, or enter the reachable
   base URL of another demo server.
3. Reload ZDS.

Kclean receives `{ entrypoint, files, outputFormat: "glb" }` over one persistent
WebSocket. The first edit opens the connection; later edits reuse it and move
directly to solving. Projects queued in one render frame are coalesced to the
newest revision. If an edit arrives while Kclean is still evaluating, it is
sent on the same socket; the server supersedes the old request and cancels that
request's bridge process group. `superseded` is normal control flow, so Bevy
keeps the last certified model visible and does not show an error toast. If the
socket goes stale, the renderer reconnects and retries the current revision
once. The renderer also keeps its existing revision check, so a response for an
older editor revision cannot replace a newer model.
The Kclean GLB currently has body names but no Zoo topology extension, so faces
render while selection and sketching remain unavailable in this viewport. The
Bevy clear color follows ZDS's resolved light or dark theme immediately,
including changes to the system theme.

The first successfully loaded model is framed as part of renderer startup.
Later GLB revisions preserve the current camera position, orientation, target,
zoom, and projection; they only refresh the bounds used by the explicit
**Zoom to fit** command.

Kernel failures can also carry a `certification: "checkpoint"` GLB. Bevy loads
that artifact and ZDS keeps the kernel diagnostic visible, so the last geometry
proved during the current evaluation remains inspectable. A rejected solver
candidate is reported separately and is never presented as certified geometry;
when no current checkpoint solid exists, the renderer leaves the previous model
in place instead of blanking the viewport.
