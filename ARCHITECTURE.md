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

### Creating, renaming, deleting

The session owns these, not the tree that draws them. Its rule — single-file
edits belong to the buffer, anything spanning files or touching the filesystem
belongs here — is what makes a rename keep the document it renames: the buffer's
identity survives, so an unsaved edit, its undo history and the mounted view are
all still there afterwards. A directory rename carries every buffer underneath.

Two orderings are load-bearing, and both are invisible until they bite:

- **A delete closes buffers first, then waits for their writes.** Disposing a
  buffer *flushes* a pending autosave, deliberately, so closing after the removal
  would write the file back moments after deleting it. Closing first is not
  enough on its own either: a save is queued against the file while a folder
  removal is queued against the folder, and nothing orders the two — so
  `settlePaths` enqueues a no-op on each path as a barrier. The queue's
  submission order does the rest.
- **A name already taken is refused, not made unique.** The caller either typed
  the name, in which case being told is the only useful answer, or generated it,
  in which case it knows the siblings and can pick a free one. `uniqueFileName`
  puts the suffix before the extension, because `part.kcl-2` is not a KCL file.

Removal goes to the OS trash where the platform has one, which is what makes a
single inline confirmation enough.

### What the tree owns

Only its own state: which folders are open, which row is selected, and what is
being typed. That lives in `fileExplorerState` beside the component rather than
inside it, because the panel unmounts every time the code panel is toggled shut —
a tree that forgot its open folders each time you glanced at the model would be
worse than no memory — and because the same state is driven from the rows, the
panel's header actions, and the commands in the palette.

A draft row is placed by the tree, not injected into the file list. `main` adds
placeholder entries with magic names for this; a fake entry has to be filtered
back out of everything that reads the files — the buffers, the URL, the executing
file — and one of those eventually forgets.

Every operation is also a command (`files.newFile`, `files.rename`, …), so the
palette reaches them, and `F2`/`Delete` are bindings scoped to
`projectExplorer.focused` — the scope the tree holds while focus is inside it.

## The engine connection

The scene is rendered on the engine and streamed back, so this owns a websocket
(commands and WebRTC signalling) and a peer connection (the video track).

### The scene

The connection owns a socket; `engineScene` owns what is on the other end of it.
The split matters because the engine starts every scene at its own defaults, so
the app's preferences are not configuration passed once — they are statements
that have to be made again on each new scene.

`sceneEpoch` on the connection is what makes that expressible. It increments
whenever the engine begins a fresh scene, and each consumer keeps one effect keyed
on it plus the values it cares about. Nothing has to know about anyone else's
triggers, and reconnecting restates everything.

The effects are deliberately narrow about what they read. Keying on the whole
connection state re-ran them on every ping, which meant re-sending every scene
command every few seconds forever; they read a `connected` computed instead.

### The stream follows the panel

The engine allocates its render target when the socket opens, so the size has to
be known before anyone clicks connect — which is why it is *reported* to the
connection rather than passed in. But a stream that only ever matches the panel
it was opened at is wrong within seconds of use: a splitter moves, a rail
toggles, the window is maximised.

So a resize while connected sends `reconfigure_stream`, and the connection keeps
two sizes: what the app has asked for, and what the engine is actually rendering.
Keeping both is what lets them be reconciled at any moment — including after a
resize that happened *during* negotiation, when there was nothing yet to tell.
That case was invisible until the two were separated.

Three decisions worth keeping:

- **Leading edge, then a settle.** One discrete change — a pane toggled — is
  answered immediately, because waiting a quarter of a second looks broken. A
  drag reports on every frame, and the engine reallocates its render target per
  reconfigure, so it is answered once at the size it ends on.
- **A collapsed pane is ignored.** Nothing can be seen, so resizing down to the
  minimum costs a round trip now and another when it reopens. The last real size
  is kept.
- **The panel's shape is preserved.** Clamping each axis into [256, 2160] on its
  own is the obvious thing and it is wrong: a wide short panel has its height
  raised to the minimum and its width left alone, so the engine renders a
  differently-shaped scene and the viewport letterboxes it. Both axes scale by
  one ratio instead.

The observer reads the element rather than the entry's `contentRect`, which is a
snapshot from when the observation was queued, and reports on the next frame
rather than synchronously — otherwise anything downstream that reads layout
produces "ResizeObserver loop completed with undelivered notifications".

### Interaction is contributed

Whatever the scene is drawn on is the only surface the model can be touched
through: the camera wants drags and the wheel, selection will want clicks, a
measurement tool will want hovers. `sceneInteractionsValueSpec` is that seam, so
each of those can be built, tested, and turned off on its own — and the stream
component stays what it is, which is a video with a size.

The contract says nothing about *what* the surface is, which is deliberate; see
[The camera](#the-camera) for what that buys.

### Which settings reach the engine, and how

Not one mechanism but three, and the difference is visible to the user:

| Preference | How it travels | When |
| --- | --- | --- |
| Ambient occlusion, scale grid | stream URL parameter | next connection |
| Highlight edges, backface colour, theme | scene command | immediately |
| Projection, orbit | scene command / interaction type | immediately |
| Camera controls | never sent; decides what a gesture means | immediately |

The first row is why those two settings say they wait for the next connection:
the engine builds its render pipeline when the socket opens. They are
*contributed* into the URL rather than read by the connection, which has no
business knowing what a preference is — and the stream dimensions are written
last, so a contribution cannot overwrite them. A dimension the engine refuses
closes the socket with no explanation.

The theme is a scene command too. The background matches the app's, and the
engine's overlay geometry — grid lines, axes — takes the *opposite* theme's
colour, because it is drawn on the background and has to contrast with it. All
four system colours go in one `set_default_system_properties`: the engine takes
them together, so sending the theme's line colour and the backface colour as two
commands has the second drop what the first set.

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

## The camera

The camera is **not** part of the engine scene, and the reason is worth stating
because the first version got it wrong. It began as `engineScene/camera/`, on the
grounds that the camera moves the engine's camera. But that put the engine's
command envelope, the engine's pixel space, and the engine's rate limit inside
the gesture recogniser — so a second renderer would have had to reimplement the
guard table to get a camera at all.

`bevy-zoo` is the concrete case: a Bevy client that still uses the cloud engine to
execute KCL, but renders the resulting glTF locally, native or in a canvas. Every
one of those three couplings is wrong for it. Its camera is in-process, so a
gesture needs no round trip and can be applied every frame. Its canvas is the
size of the element, so there is no second pixel space. And it does not forget its
scene, so there is nothing to restate.

So the split is by *what changes when the renderer changes*:

| Renderer-independent (`features/camera/`) | Renderer-specific (`CameraDriver`) |
| --- | --- |
| Which gesture a button and modifier mean | The command envelope |
| The three preferences | The pixel space |
| Pointer capture through a drag | How often a move can be sent |
| Touch as a one-finger orbit | Whether the scene forgets |
| Suppressing the context menu | |

`cameraDriverService` is the seam. The recogniser reports gestures in the
element's own pixels, with the element's size travelling alongside so a driver can
map into whatever space it needs. The driver is resolved **optionally** and
gestures are dropped while there is none: a viewport with nothing rendering in it
is not broken.

Two consequences that read as design rather than accident:

- **The rate limit lives in the engine driver, not the camera.** Fifteen moves a
  second is the streamed engine's number — each one costs a re-render *and* a
  re-stream. Throttling in the recogniser would impose that cost on a renderer
  that does not have it.
- **Restating is the driver's job.** The camera states the projection preference
  once, and the engine driver re-sends it on `sceneEpoch` because only it knows
  the engine begins each scene blank. A local renderer would simply never
  restate, without the camera feature changing.

The guard table itself is ported from the existing app. "Camera controls" is a
choice between seven other CAD packages' conventions, and the table of predicates
is its entire content — someone switching to this app wants the muscle memory
they have, not our idea of a better default. The gestures appear under the control
in the settings dialog, because "Solidworks" tells you nothing until it tells you
pan is Ctrl and a right drag.

A system is named by its stored id (`trackpad_friendly`) with the display name in
the table. The existing app keeps the display name as the value and converts at
the file boundary, which needs two mapping functions and a comment about where the
underscores went.

`sceneInteractionsValueSpec` lives in `contracts/scene.ts` for the same reason —
input over the surface the scene is drawn on is not a fact about video. Only
`streamParamsValueSpec` stayed in `contracts/engineScene.ts`, because query
parameters on a stream URL genuinely are.

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
the app observes, the menu holds preferences someone sets. Both it and the
settings dialog write the same user-level setting, so neither is the real one.

## Settings

Three layers, resolved in one direction: the app's compiled defaults, then the
user's overrides, then the open project's. Nothing merges downward and nothing
writes to a lower layer, so "why is this value what it is" always has a
three-line answer — which the dialog prints under every row.

A setting is **data contributed by the feature whose behaviour it changes**
(`src/contracts/settings.ts`). The camera owns the camera settings, the theme
owns the theme; the settings feature owns no setting at all, only the cascade and
the surface that draws it. Adding a preference never touches
`src/features/settings/`.

```ts
export const highlightEdgesSetting = booleanSetting({
  id: 'modeling.highlightEdges',
  section: 'modeling',
  title: 'Highlight edges',
  defaultValue: true,
  toml: ['settings', 'modeling', 'highlight_edges'],
})
```

The handle is both the contribution and the accessor: `provide(settingsValueSpec,
highlightEdgesSetting)` registers it, `settings.value(highlightEdgesSetting)`
reads it as a typed signal. A consumer in another feature imports the handle, so
a rename is a compile error rather than a silently dead string key. KCL execution
does exactly that with two of them — the same preference reaches the engine as a
command and the executor as a config field, declared once.

Definitions are static and never mutated. The only state is two override maps,
one per level, and every value is a `computed` over them. That is the difference
from `main`, where a settings tree of stateful `Setting` objects keeps the current
value and its declaration in the same place and every consumer needs the whole
tree.

### Levels come from the schema, not from taste

`levels: ['user']` means a project cannot override it. That is not a UI
preference: `rust/kcl-lib/src/settings/types` has no project field for the camera
projection or the theme, so an override there would write a key nothing reads.
Files are not allowed to promise what the app will not honour, so a project-level
value for a user-only setting is ignored on read as well as hidden on write.

The same reasoning fixes the section list: a section with no settings at the
current level is dropped from the sidebar rather than shown empty, because an
"Appearance" group with nothing in it on the project tab reads as a bug.

### The files are the ones the schema describes

Each setting declares its TOML path, matching the Rust schema — `user.toml` in
the app's configuration directory, `project.toml` at the project root. Writes
round-trip through the existing file, so keys this app does not own (a project
title, cloud metadata, a field a newer release added) survive. Comments do not:
a TOML parser drops them, which the generated header says out loud.

Refusing to write is deliberate when the existing file will not parse. Losing
someone's half-finished hand edit is worse than failing to save, and the value
stays live for the session either way.

`project.toml` is now shared between the settings cascade and the project title,
so writing the title merges rather than replaces. Before, a rename would have
silently reset the project's preferences.

### The dialog is a route, not a screen

`/settings/:section` is addressable, and the location source sits at the front of
the queue while the dialog is open — a copied URL reopens the dialog, not the
screen behind it. Closing it steps out of the way and the underlying screen owns
the URL again.

Its route is also ordered ahead of every other one, because it has to notice URLs
that are *not* settings: a Back out of the dialog arrives as a plain URL, and
something has to close what the URL no longer describes. It closes, returns
false, and the real route claims it.

The level being edited is *not* in the URL. A link to settings should open
settings someone can act on, not resume a tab they were poking at.

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

### The viewport is the centre; code is a panel

The modelling preset docks the **code panel** on the start rail and gives the
whole centre to the viewport. The editor used to hold half the window as an
`area` node in a split, which made it the one thing in a CAD app you could not
put away — and `isAreaOpen` reports any area placed directly in the tree as
open, so "toggle the editor" was not even expressible.

The file tree lives *inside* the code panel. It is still its own contributed
area, listed on the rail that owns its open state and its width, but
`hostedBy: 'project.code'` tells the rail not to draw it: neither an icon in the
strip nor a slot in the region. `CodeArea` draws it instead, and its hide/show is
a button in the editor's own bar. So `toggleArea`, `extentFor`, the toggle
command and persistence all work on it unchanged, while the affordance sits where
the activity is — choosing which file to read is part of reading code, and the
tree's only consumer is the editor.

The alternative was to let a rail's expanded region hold an arbitrary layout
subtree. More general, and it answers a question nobody has asked: what the icon
strip toggles when the region is not an area.

Two things this forces, both easy to get wrong:

- **A structural change is a version bump.** `PersistedLayout.version` is the
  migration. The saved `root` is restored verbatim, so editing a preset moves
  nobody — including your own dev profile — until the version changes and the
  screen re-seeds. Node ids belong to the preset that made them; a stale tree is
  worse than none.
- **Rail bounds are per node.** A title block is pointless over 400px and a code
  editor is cramped at 720, so `minExtent`/`maxExtent` live on the node, and the
  starting `size` is what seeds `extentFor`. The rail used to pass a constant
  fallback, which silently ignored every preset's stated width.

## Keybindings

A binding resolves to a command id and nothing else. It carries no behaviour of
its own, so the keyboard cannot reach anything that is not already a command with
a title, an `enabled` signal, and a row in the palette.

`keystrokes` is a **sequence of chords**: `['Mod+K']` is one chord, `['v', '1']`
is two. Matching walks a prefix tree and answers `none`, `prefix`, or `full` —
`prefix` being the state that makes sequences possible at all. A held sequence
appears in the status bar, because a keyboard that has quietly eaten a keystroke
while it waits for another is indistinguishable from one that is broken.

Chords are normalised before anything compares them, **modifiers included**, so
`Shift+Mod+1` and `Mod+Shift+1` are the same binding. Getting that wrong costs an
afternoon: the binding simply never fires.

### Scopes

A scope is a contributed situation with a `priority`. Whoever knows the situation
is true applies it — the code editor holds `codeEditor.focused` for as long as a
buffer has focus, through a CodeMirror capability rather than a DOM listener in a
view, so it is true for every buffer wherever it is mounted. The strongest active
scope wins a contested sequence, which lets the editor claim a key the app also
uses without either of them knowing about the other.

`base` is contributed like any other scope, and is always active and always
weakest.

### Bare keys belong to whoever is typing

`textEntry` on a scope says "while this is active, an unmodified key is a
character". A chord carrying Mod, Ctrl or Alt always dispatches, as does the
second keystroke of a sequence already in progress; only bare keys defer, and
only to a form control or to a content-editable under a `textEntry` scope.

This replaced a blanket "ignore everything while focus is in a text field", which
silently killed every binding that had not opted out — `⌘1` included — the moment
the code editor had focus, because CodeMirror's content *is* a content-editable.

### The user's keymap

The bindings features contribute are defaults. A stored keymap overrides them,
and it is its own TOML document with its own version — deliberately outside the
settings cascade, because an override is a patch against what the app shipped
rather than an answer to "for me or for this project". `keybindings.toml` beside
`user.toml` on desktop, browser storage on the web.

Two rules, both chosen to be explainable:

- **A stored line for a command replaces every contributed binding for it.** Per
  command rather than per binding: someone is answering "I want this action on
  these keys" and neither knows nor cares how many bindings shipped for it.
- **`-command` unbinds**, VS Code style, because a keymap has to be able to say
  "not this".

The user's lines sort first in the resolved list, so taking a chord the app was
using means theirs fires — and both stay in the list, so the dialog can point at
the collision instead of the app quietly losing.

A file that cannot be parsed is an empty keymap, and a line that cannot be parsed
costs that line: a broken keymap file must not be a broken app. A file claiming a
version we do not know is left alone entirely rather than guessed at.

### The table

In the settings dialog, as a section with a body and no rows — `SettingsSection`
grew a `render` for exactly this, because eighty bindings are not eighty settings
and modelling them that way would make the cascade lie about what it holds.

It lists **commands**, not bindings, which is the opposite of how the file is
stored: the file is a list of overrides, and this is the list of things the app
can do. A command with no keys has to appear or it can never be given any.

Recording holds `suspendListening` for as long as the field is open — that is
what the refcount exists for, since `⌘K` cannot be recorded if the palette opens
the moment it is pressed. Each further keystroke appends a chord, so a sequence
is entered by typing it. A conflict is reported and not refused: two commands on
one chord in different scopes is normal, and someone mid-way through swapping two
bindings is not making a mistake. The scope list underneath shows which scopes
are active *right now*, which is the answer to "why did that key do something
else".

### What is deliberately not here yet

- **Binding `arguments`.** `Command.run` takes none. When a command needs
  arguments that is a change to the command contract first.
- **Mutually-exclusive scope groups.** `main` uses them so sketch and modelling
  modes cannot stack. There are no modes here yet, and it is one pure function to
  add when there are.
- **Watching the keymap file.** An edit made outside the app lands on the next
  launch. Doing it properly needs the echo-filtering the settings watcher does,
  and a keymap changes rarely enough that the restart is a fair price for not
  building that twice.

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

Controls stay native where the platform already gets the behaviour right:
`Select` is a real `<select>` with our chevron over it, and `Switch` is a
visually-hidden checkbox under a styled track. The only thing a bespoke popup or
a `div role="switch"` would buy is the chance to get keyboard, touch, and screen
readers wrong.

## What is not built yet

- Point-and-click tools as LSP or kcl-lib macro actions (principle 6)
- Cloud sync
- Token storage on desktop uses browser storage; the existing app uses a
  per-environment config file, which survives a cleared profile and supports
  environment switching. Settings already write one, so the mechanism exists
- Watching is desktop-only, and a project folder moved or deleted underneath the
  app is reported as a change to each file rather than as the project going away
- An engine-idle signal, so the view can be framed automatically after execution
- Selection and the feature tree. Camera controls are in; clicking the model to
  select something is not, and it plugs into the same interaction seam
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

## Watching for external changes

Files change underneath a desktop app: a formatter runs, a branch is checked
out, someone edits `user.toml` in vim. `FileWatcher` (`src/contracts/`) is how
the app finds out, and it is deliberately not part of `FileSystem` — that is
*how* to read and write, this is *when something else did*.

The web build contributes **no watcher at all**, not a no-op. The
origin-private filesystem is reachable only by this app, so there is no external
editor to notice and a watcher there would be a promise the platform cannot
keep. Every consumer resolves the service with `optional` and works without it.
That is also why the settings store carries its own `watch?` rather than being
watched through the filesystem: on the web, another tab *is* a real external
editor, and the `storage` event is how you hear about it.

### Coalescing, and telling your own writes apart

Two things make this safe, and skipping either produces a feature that is worse
than not having one.

**Coalescing.** One save from another editor can produce a create, a rename and
two writes, and the file is not readable at every point in between. The main
process gathers raw events for 120ms and then stats each path once, which is
also how it decides between created, changed and removed — `fs.watch` says
'rename' for both creation and deletion, so only the file's state afterwards can
answer.

**Provenance.** Autosave writes while someone keeps typing. Left alone, that
write comes back as an incoming change, and the buffer would be told that
content it produced itself is a conflict — the divergence bar appearing
mid-sentence. `FsOperationQueue.recordWrite` already existed for exactly this;
`readExternalChange` is what finally consults it, and it matches on **content**,
not on the path or the clock, so a genuine edit that lands inside the window
still gets through. For `user.toml` the check happens in the main process
instead, because that is where the write happens: it knows what it last wrote,
so the renderer only ever hears about edits it did not cause.

### What each consumer does with it

The session watches its project folder and does two separate jobs, only one of
which is about content: a file with a buffer open on it is reconciled, and a
file appearing or disappearing refreshes the tree. A plain write to a file
nobody has open changes neither, so it deliberately does not re-walk the
project.

Reconciliation itself is unchanged — the buffer already knew how to adopt a
change silently when it is clean and surface a conflict when it is not. The
watcher only supplies the input that policy was written for.

Settings re-read the file that changed. An external edit **wins outright**,
unlike the first read at startup: that one races a click and keeps what the
person just did, whereas a file edited while the app is open is newer than
anything the app knows. A line deleted by hand becomes inherited again, which is
the whole point of editing the file yourself.

A watch is shared: one operating-system watch per directory however many
features ask for it, released when the last of them stops listening. The session
and the settings service both want the project folder and neither has to know
the other asked.

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
- the settings channels are the exception, and deliberately so: they serve one
  pinned path in the app's configuration directory, which is not a granted root.
  The renderer cannot name the file, only ask for the one file it is allowed
- watches are confined to granted roots too, and a renderer may only stop a
  watch it started; every watch dies with the window that asked for it
- `user.toml` is written to a temporary file and renamed, so a crash mid-write
  leaves the previous settings intact rather than a truncated file
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
