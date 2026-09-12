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
applies the Kclean integration and certified-checkpoint patches idempotently,
and installs the generated JavaScript, WASM, and assets in their Vite locations.

In **Settings → Modeling**:

1. Set **Modeling engine** to **Kclean (experimental)**.
2. Leave **Kclean server** at `http://127.0.0.1:3001`, or enter the reachable
   base URL of another demo server.
3. Reload ZDS.

Kclean receives `{ entrypoint, files, outputFormat: "glb" }` over REST. The
renderer keeps its existing revision check, so a response for an older editor
revision cannot replace a newer model. The Kclean GLB currently has body names
but no Zoo topology extension, so faces render while selection and sketching
remain unavailable in this viewport. The Bevy clear color follows ZDS's resolved
light or dark theme immediately, including changes to the system theme.

Kernel failures can also carry a `certification: "checkpoint"` GLB. Bevy loads
that artifact and ZDS keeps the kernel diagnostic visible, so the last geometry
proved during the current evaluation remains inspectable. A rejected solver
candidate is reported separately and is never presented as certified geometry;
when no current checkpoint solid exists, the renderer leaves the previous model
in place instead of blanking the viewport.
