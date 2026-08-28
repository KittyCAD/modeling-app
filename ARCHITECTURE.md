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
the app observes, the menu holds preferences someone sets. Both it and the
settings dialog write the same user-level setting, so neither is the real one.

## Settings

Three layers, resolved in one direction: the app's compiled defaults, then the
user's overrides, then the open project's. Nothing merges downward and nothing
writes to a lower layer, so "why is this value what it is" always has a
three-line answer — which the dialog prints under every row.

A setting is **data contributed by the feature whose behaviour it changes**
(`src/contracts/settings.ts`). The engine owns the camera settings, the theme
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
