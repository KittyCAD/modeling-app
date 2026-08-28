# Architecture

A from-scratch rebuild of Zoo Design Studio, built to a set of principles rather
than refactored toward them. This document is the map; the old runtime is still
readable at `git show main:src/...`.

## The nine principles

| # | Principle | Where it lives | Status |
| --- | --- | --- | --- |
| 1 | Registry for composable capabilities | `src/contracts/`, `src/features/` | done |
| 2 | Preact Signals for reactive state | throughout; no state machines | done |
| 3 | Thin view layer | `packages/ui-kit`, `src/features/*/**.tsx` | partly |
| 4 | CodeMirror owns buffer state; `projectSession` owns the project | `src/contracts/buffers.ts`, `src/features/projectSession/` | done (see below) |
| — | Execution: coordinator-owned, capability-enabled | `src/contracts/execution.ts`, `src/features/execution/` | no engine yet |
| — | Project libraries (ported from main) | `src/contracts/projectLibraries.ts`, `src/features/projectLibraries/` | directory type |
| 5 | The router follows app state | `src/features/navigation/` | done |
| 6 | Point-and-click tools as macro actions | — | not started |
| 7 | Publishable UI building blocks | `packages/ui-kit` | done |
| 8 | Every empty state handled | `EmptyState`, every screen | done |
| 9 | Centralised design system and tokens | `packages/ui-kit/src/tokens/` | done |

Principle 3 says "partly" honestly: the view layer is Preact, chosen over a
custom signals-to-DOM runtime after weighing it. A VDOM and component
re-renders are back, in exchange for JSX, per-element prop typing, and familiar
tooling. Signals passed into props and children are still subscribed directly by
Preact, so the common case patches one attribute without re-rendering.

## Layout of the tree

```
packages/
  registry/          Capability container: value specs, services, slots, plugins
  ui-kit/            Design system + components. Publishable, brand-overridable
  codemirror-*/      KCL language and LSP client, for when buffers land
  ui-components/     Legacy React components, superseded by ui-kit
src/
  app/               Composition root, app context hooks
  contracts/         ValueSpecs and Services only. No implementations
  features/          One directory per capability, discovered by glob
  lib/               Small shared helpers
```

## How composition works

The registry has two composition primitives.

**Value specs** are many-to-one. Any feature contributes; the spec's `combine`
folds every contribution into one resolved value. Commands, top bar items,
status fields, screens, layout areas, keybindings, and URL routes are all value
specs, which is why adding any of them never edits a central file.

**Services** are one-to-many. One feature provides a capability; others depend
on the token, never on the module. Contract modules export only tokens, which
keeps the graph acyclic as it grows and makes a feature's dependencies legible
from its imports.

A feature is a directory under `src/features/` whose `index` default-exports a
registry item. `src/app/registryItems.ts` finds it by glob. Nothing is
registered by hand.

### Two rules the container enforces

Both of these throw, and both cost time to rediscover:

1. **Do not resolve a service in a factory body.** The graph is still being
   flattened. Use a lazy accessor and call it from a computed or a handler:
   ```ts
   const sessions = () => ctx.services.get(projectSessionService)
   const hasProject = computed(() => sessions().current.value !== null)
   ```
2. **Do not start an effect that reads value specs inline.** An effect runs its
   body on creation, which is the same problem. Defer by a microtask — see
   `src/features/navigation/index.ts`.

## The router, inverted

Nothing navigates. Features contribute a `LocationSource` derived from their own
state; the navigation service takes the first one that answers. The URL is then
a rendering of that answer, mirrored into history by an effect.

The consequence is that the URL cannot disagree with the screen: there is no
`navigate()` to forget, no route reachable without the state justifying it, and
no loader rebuilding state the app already had.

`UrlRoute.load` is the only inbound direction, used on boot and on a history
pop. It must reconcile the URL **completely, absences included** — a project URL
with no `?file=` clears the active buffer. Handling only what is present is how
Back leaves the URL and the view disagreeing.

## Signals in Preact: the sharp edge

`useComputed` and `useSignalEffect` memoise on mount and only invalidate when a
**signal** they read changes. Anything derived from a plain prop, or from a
signal whose *identity* can change, must not be memoised that way. This caused
two bugs in the first pass — a rail that would not expand, and pane sizes that
ignored a layout reset.

- Derived from a plain prop → compute in the render body. Prop changes
  re-render, and reading `.value` there subscribes the component.
- Derived from a signal that may be replaced → key it explicitly:
  `useMemo(() => computed(...), [theSignal])`, `useEffect(() => effect(...), [theSignal])`.

## Buffers

Implements KittyCAD/modeling-app#13185 and #13189. Two properties carry the
design, and both are easy to break:

**One dispatch boundary.** A mounted view does not dispatch to itself — its
`dispatchTransactions` is routed into the buffer, which applies the transactions
and *then* pushes them to the view. Typing, a command, an LSP response, a
modelling action, an agent, and filesystem reconciliation all take the same
path, which is what makes versioning, change events, and stale-work rejection
possible. CodeMirror's `updateListener` would have been too late and would have
made the view the owner of the state.

**The document outlives the view.** State lives in the buffer, so unmounting is
not a document operation and `undo` works with nothing on screen. `runCommand`
takes a `StateCommand` and needs no view.

Other invariants, each with a test:

- `id` is generated, never derived from the path. A rename moves a buffer rather
  than replacing it, so background work holding a reference survives the move.
- `pathRevision` and `version` are tracked separately: one guards path-scoped
  async work, the other rejects a save that finished after a newer edit.
  `markSaved` returning false *is* that rejection.
- `dirty` is a content comparison, not a flag, so undoing back to the saved
  content makes a buffer clean again for free.
- Reconciliation never overwrites unsaved edits. A clean buffer adopts; a dirty
  one records a divergence and leaves the document alone.
- A buffer's `path` is **absolute** — the resource capabilities act on.
  Project-relative paths are presentation and live on the session
  (`relativePathFor`, `activeBufferPath`).

### Capabilities

One application-level ValueSpec, combined into a deterministic resolver — not
one registry per buffer. Each buffer evaluates it against its own **structural**
context (path identity, language, file-backed, executing role, read-only) and
applies the result through a single `Compartment`.

The structural/volatile line is the expensive thing to get wrong. Diagnostics,
cursor state, dirty state, execution results, and remote divergence must **not**
be structural: they flow through transactions, state fields, facets, and
signals. A test asserts that typing never rebuilds the bundle.

A capability contributes CodeMirror extensions, a live binding returning a
disposer, or both. The binding shape exists because a `updateListener` cannot
serve a buffer with no view — autosave is exactly that case.

Two CodeMirror details worth remembering:

- `userEvent: undefined` does **not** keep a change out of history. Only
  `Transaction.addToHistory.of(false)` does.
- History groups recent changes by time, so a programmatic replacement that
  should be its own undo step needs `isolateHistory`.

### Snapshots

`captureSnapshot()` reads buffers, not the filesystem, so a commit or an export
sees what the user is looking at. Synchronous and O(1) per buffer — CodeMirror
documents are persistent, so no copy is needed and the capture stays valid while
the user keeps typing. No "save all", and observers never see a mixture of old
and new project state. Each capture carries one operation id.

### Project session

`projectSession` owns the buffer collection and its lifecycle: one path for every
file type plus scratch buffers, lookup by id and by path, and the executing role
pushed into the buffer since capabilities key off it. Viewing and executing are
separate signals on purpose — collapsing them is what turns the active file into
a hidden dependency of every subsystem.

Opening a project opens no buffer: "no active buffer" is a state the UI must
handle anyway, so it is where you land.

## The engine connection

The scene is rendered on the engine and streamed back, so this owns a websocket
(commands and WebRTC signalling) and a peer connection (the video track).

### The wire format

Commands go out as **JSON text**, unwrapped: the Rust side hands over a complete
`WebSocketRequest`, and wrapping it again produces a message the engine accepts
and never answers. Responses arrive as msgpack *or* JSON and are always
re-encoded as msgpack, because the Rust side only deserialises that.

Pending commands correlate on the envelope's `cmd_id` — what the engine echoes as
`request_id` — not on a separately-passed id.

`startNewSession` must **not** reconnect. KCL's runtime calls it at the start of
every execution.

Three further constraints the server enforces by disconnecting rather than
explaining, all of which cost time to find:

- A `success: false` message is **not always a rejection**. The engine sends
  "please send Authorization" the moment the socket opens, before processing the
  headers already in flight. Only auth failures are fatal.
- Stream dimensions must be **multiples of 4**, within [256, 2160]. Merely even
  is not enough.
- The engine **allocates its render target at connect time**, so the viewport
  size must be reported before connecting. A resize needs a reconnect.
- Protocol responses carry a `request_id` too, so they must be matched by
  response *type* before any id-based routing.

State is a status signal plus a *stage* signal rather than a state machine: every
transition is driven by an inbound message, and the stage is what makes a stall
diagnosable — websocket, authenticating, negotiating, or streaming.

Auth is real — see below.

## Authentication, and what "protected" means here

There is no route guard, no `<Auth>` wrapper, and no protected-route concept. The
sign-in screen is a `screensValueSpec` contribution that declares itself active
and wins by order. "Is the app gated?" is therefore **one predicate in one file**.

And it is not gated. Two states are kept apart:

- `status` — a fact: is there a verified token.
- `signInRequested` — an intent: has something asked the user to sign in.

Local libraries, buffers, editing, and KCL diagnostics all work with no account,
so the screen appears only when something genuinely needs one, carrying the
reason. `engine.connect` is the current example; every connect affordance routes
through that one command so none can skip it.

A token is verified by fetching the account — the only way to know a token is
good is to use it, and the answer is the identity the menu needs, so it is one
request. A token that fails verification is discarded rather than kept: keeping
it makes every later request fail confusingly.

Three flows, contributed, because which are possible depends on the platform:

| Flow | Where | Notes |
| --- | --- | --- |
| Device flow | desktop | Token exchange runs in the **main process**; the renderer only sees the code and the final token. Endpoints are on the **API** host, not the site. |
| Web redirect | browser | A full navigation, since that is what makes the site's cookie readable here. |
| Paste a token | everywhere | The fallback. Ordered last: it asks the most of the user. |

## The app menu

Deliberately not "the user menu". It is useful signed out — theme, commands,
libraries — and identity is one section in it.

The **trigger** is a value spec where the first *non-null* contribution wins, so
a feature can replace it and can decline by yielding null. That is what makes
"the app menu becomes a user menu when signed in" a composition fact rather than
a conditional inside a component. Plain first-wins would let a declining
contributor shadow a willing one.

Menu items prefer a `commandId` over a handler, so one declaration is reachable
from the menu, the palette, and a keybinding, and inherits the command's
`enabled` state and shortcut.

The theme control lives here, not in the status bar: the status bar reports state
the app observes, the menu holds preferences someone sets.

## Execution

The coordinator owns everything asynchronous; the adapter is a capability; the
executor is injected. Nothing about a modelling runtime lives in a buffer or an
extension, because an extension that owned one would tie its lifetime to a
mounted view.

**The coordinator** (`src/features/execution/`) owns:

- **supersession** — a newer request for a buffer aborts the older one, queued or
  in flight
- **shared-engine serialization** — one run at a time, since there is one engine;
  other buffers queue, oldest-first so continuous typing in one cannot starve
  another
- **stale-result rejection** — a result applies only if the buffer is still at the
  version the request captured

Requests carry a versioned capture, never live state. Draining starts on a
microtask, not synchronously, so a same-tick resubmit collapses before the
executor is handed work that is already dead.

State is keyed by buffer, so several executing buffers are representable even
though the session UI picks one.

**The adapter** applies only to eligible buffers — KCL, executing, not read-only.
Eligibility is *structural*, so changing which buffer executes reconfigures the
bundle once. Diagnostics come back through `setDiagnostics`: a transaction of
declarative data that never rebuilds the bundle, because diagnostics are
volatile. Re-run is an annotated transaction through the buffer
(`requestExecution`), not a call around it — a re-run changes no text, so it has
to say so explicitly.

**Executors** are contributions with an order, so an engine-backed executor
installs beside the offline one and wins by declaring a lower order. A build with
no executor for a language reports `idle`, not an error.

### Two executors, composed

| Executor | Order | Accepts when | Produces |
| --- | --- | --- | --- |
| `kcl.execution` | 0 | engine connected | geometry, plus diagnostics |
| `kcl.analysis` | 100 | always | diagnostics only |

Signed out or disconnected you get errors in the gutter; connected you get a
model. Neither executor knows about the other, and adding the engine-backed one
changed nothing in the coordinator or the adapter.

The WASM `Context` belongs to the **connection**, not the app: it holds a scene
and a command cache on the engine, so reusing one across a reconnect leaves it
pointing at a scene that no longer exists. It is built lazily and dropped when
the session ends.

`free()` is deliberately never called on it. An execution may still hold a borrow,
and wasm-bindgen throws "attempted to take ownership of Rust value while it was
borrowed" — which then surfaces as a bogus KCL error attributed to the user's
code.

Unmatched engine responses are fed to `context.sendResponse`: fired commands are
answered too, and `kcl-lib` is tracking them.

A KCL error is a *result*, not a run failure. Parse errors short-circuit before
the engine is touched, so the precise message wins over a vaguer one from further
down.

### Framing the model is explicit

`engine.fitView` is a command, not something automatic after execution. KCL
*fires* most geometry commands without awaiting them, so `execute` resolving does
not mean the engine has built the model — fitting then reliably frames an empty
scene. Automatic framing needs an engine-idle signal, which is not built.

Also outstanding:

- `ProjectActionHistory` and the `HistoryCoordinator` (#13353) — local buffer
  undo works; coordinated multi-buffer undo does not exist
- Prepared project mutations (#13354) — the snapshot half is done, the
  `PreparedProjectMutation` half is not
- LSP as a capability, and a filesystem watcher. `reconcileExternalChange` and
  the queue's write tokens are the seams a watcher will use
- `kcl_lint`, for warnings beyond what the parser reports

## Layout is data

The main area is a tree of plain data: `area`, `split`, `rail`, `dock`.
Serialisable, diffable, migratable, contributable — none of which is possible
when an arrangement is nested JSX. `LayoutView` is the only module that turns a
node into DOM.

`sizesFor(nodeId)` hands out the **writable signal itself** rather than a
setter, so a drag, a restored layout, and a command are one path with no private
copy in a component to drift. `dock` exists because rails are sized in pixels
and the centre takes the remainder, which does not express as fractions.

## Design system

Three token layers, in strict order. Components may only read 2 and 3.

1. **Ramps** — `--zds-ramp-*`. Raw OKLCH scales, theme-independent.
2. **Semantics** — `--zds-surface-*`, `--zds-text-*`, `--zds-border-*`,
   `--zds-status-*`. What a colour *means*. Remapped per theme.
3. **Scales** — `--zds-space-*`, `--zds-font-*`, `--zds-radius-*`,
   `--zds-size-*`, `--zds-motion-*`.

The visual thesis is an instrument, not a document, because chrome in a CAD app
should recede behind the geometry:

- **Two type roles.** Sans carries content. Mono, uppercase and tracked
  (`.zds-label`), carries metadata. You can tell at a glance whether text is a
  value or a name for one.
- **Two materials, two radii.** The chassis is machined: square, hairline seams.
  Content is softened at 3px. Never mixed on one element.
- **Seams, not borders** (`.zds-seam-*`): a dark scribe line with a light land,
  so panel edges read as a physical gap at low contrast.
- **Rationed accent.** `.zds-datum`, a 2px stripe from the GD&T datum symbol,
  marks the focused surface and is the only routine accent in the chassis.
- **One motif reused.** `.zds-grid-field` is the construction grid, behind both
  an empty viewport and a project card with no preview.

Theme is one attribute on the root element. Nothing subscribes to it and nothing
re-renders when it changes.

## What is not built yet

- CodeMirror buffers, the dispatch boundary, and editor capabilities (#6836)
- The modelling engine connection and the 3D scene
- Point-and-click tools as LSP or kcl-lib macro actions (principle 6)
- Settings and cloud sync — settings will be signals plus a registry-composed
  schema, not a state machine
- Token storage on desktop uses browser storage; the existing app uses a
  per-environment config file, which survives a cleared profile and supports
  environment switching
- An engine-idle signal, so the view can be framed automatically after execution
- Selection, camera controls, and the feature tree: the viewport is a video
  stream with no interaction wired to it yet
- Cloud and network library types. The type contribution is the seam; nothing in
  the service, Home, or routing should need to change
- Drag-and-drop between libraries, which `main` has and this does not: moving a
  project is a per-card action here
- Storybook for ui-kit; `packages/ui-components` should be deleted once its
  useful components and its Storybook setup are ported over

## Project libraries

Ported from `main`, and the replacement for what was briefly a `ProjectSource`.
A **library** is a configured place projects live. A library **type** is the kind
of place it is — `directory` is the only one so far.

Four properties that matter, all of which have a test:

- **A project is identified by its folder, not by its library.** Two libraries
  whose paths overlap see the same folder; that is one project belonging to both.
- **Library ids derive from type, path, and source**, so they survive renames and
  reloads and are stable enough to appear in a URL. The library at the default
  root keeps a fixed id.
- **Operations route to the owning library's type.** The service knows nothing
  about directories. A move is `moveProjectFrom` plus `moveProjectTo`, so a move
  between differing types is the source handing bytes to the target.
- **Nested library roots are excluded from a parent's discovery.** A library
  inside another library's folder is a library, not a project. Libraries at the
  *same* path still share their projects — that is the intended overlap.

Discovery is kept per library, so refreshing one does not discard the others.

Titles and folder names are deliberately separable: the title lives in
`project.toml` and the folder gets a safe, unique derivative of it.

## Filesystem

One `FileSystem` service, two implementations, so directory libraries work on
both platforms:

- **OPFS** on the web. Real directories, private to the origin, persistent.
- **The preload bridge** on desktop, where every path is confined in the main
  process to a **granted root** — the default projects directory plus anything
  the user picked in an OS dialog. Picking is the grant; grants persist.

## The WASM boundary

`kcl-lib` names two TypeScript modules by path — see `src/wasm/`. wasm-bindgen
resolves them at *Rust compile time*, so deleting one is a `cargo build` failure
with no TypeScript involved. If you move them, update the two
`#[wasm_bindgen(module = ...)]` literals in `rust/kcl-lib/`.

The method shapes are dictated by Rust. Two are easy to get subtly wrong:
`getAllFiles` must resolve to a JSON *string* that Rust parses with serde, not
an array, and `sendModelingCommandFromWasm` must resolve to msgpack bytes as a
`Uint8Array`. Providers are registered on `globalThis`, which is confined to
that directory and explained there.

The file system provider is registered by the filesystem feature. The engine
transport is not, so it still reports that nothing is connected.

## Desktop

`src/desktop/` is the Electron main process and preload. The main process owns
the window, the security policy, and privileged filesystem access — nothing
else; behaviour belongs in the renderer where the registry can compose it.

The trust boundary:

- every filesystem channel is confined to the projects directory by
  `resolveInsideProjects`, which validates the resolved path *and* what it
  really points at, so neither `..` nor a symlink can leave the tree
- `openExternal` accepts only http(s)
- deletes go to the OS trash, not `unlink`
- the preload exposes named methods, never `ipcRenderer` or a caller-chosen
  channel

The desktop app reads and writes real project folders through this, and the KCL
standard library reads imported files through the same service.

## Running it

```
npm start            # web dev server on :3000
make run-desktop     # wasm + desktop bundles + electron
npm run build:wasm   # just the wasm bundle
npx tsc --noEmit     # typecheck
npx vitest run       # unit + integration
npm run fmt          # biome
```

`make run-desktop` depends on `public/kcl_wasm_lib_bg.wasm`, which needs the
Rust toolchain and wasm-pack (`npm run install:rust`, `npm run
install:wasm-pack:sh`).
