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
| 4 | CodeMirror owns buffer state; `projectSession` owns the project | `src/contracts/buffers.ts`, `src/features/projectSession/` | shape only |
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

## Buffers and the project session

`projectSession` owns one open project: its files, its buffers, and which buffer
is being **viewed** versus **executed**. Those are separate signals on purpose.
Collapsing them into one "current file" is what turns the active file into a
hidden dependency of every subsystem, and it is why you cannot read a second
file without disturbing the model.

Buffer ids are minted, never derived from paths, so a rename moves a buffer
without anything downstream noticing. Opening a project opens no buffer: "no
active buffer" is a state the UI must handle anyway, so it is where you land.

`EditorBuffer` is a phase-one shape — identity, naming, text, dirty, version.
The CodeMirror `EditorState` and the single dispatch boundary every transaction
passes through arrive with the editor itself.

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
- Settings, auth, and cloud sync — settings will be signals plus a
  registry-composed schema, not a state machine
- Storybook for ui-kit; `packages/ui-components` should be deleted once its
  useful components and its Storybook setup are ported over

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

Neither provider is registered yet, so both report a clear reason: no project
open, or not connected to the engine.

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

There is no desktop `ProjectSource` yet, so the desktop app still reads projects
from browser storage. Wiring the IPC surface to a real filesystem source, and to
the WASM file system provider, is the obvious next step.

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
