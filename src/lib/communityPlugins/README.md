# Local community plugin prototype

This subsystem is available behind `zds_project_shell_refactor`. It demonstrates
explicit activation, compilation, isolated command execution, and buffer-driven
reloads. It is a development prototype, not a published plugin platform.

## Try it

1. Use the project shell and copy
   `examples/community-plugins/hello.zds.ts` into a disposable project.
2. Open the file. Its Plugin Builder view inspects the TOML manifest and shows
   the requested permissions. Opening and compiling never activate the plugin.
3. Approve notifications and select **Start / approve reload**.
4. Find **Hello plugin: Say hello** in the command palette and invoke it.
5. Switch to Code and change the greeting. Successful compilation replaces the
   command automatically, including when Plugin Builder is not the selected view.
   A syntax or activation error leaves the previous instance installed.
6. Stop the plugin or close its backing document to remove its commands. Switching
   between Code and Plugin Builder, or opening another view of the same document,
   does not create another installation.

The watcher is the existing editor/executor pipeline: working-buffer changes and
backing changes adopted by the editor both compile. There is no independent
filesystem watcher or persistent installation list yet. Closing ZDS ends these
development installations. Saving does not install anything in another project.

## Source and SDK

Both `.zds.js` and `.zds.ts` use a leading `/* @zds-plugin` TOML block. Metadata is
parsed before any guest evaluation. The current manifest requires `id`, `name`,
`api_version = 1`, and `permissions`. Unknown metadata fields fail inspection.
A future directory package can put the same metadata in `zds-plugin.toml`.
Directory packages are not implemented by this prototype.

`@zoo/zds-plugin` is a types-only workspace package. Authors use `import type`
to get contribution shapes and the activation API; compilation removes those
imports. External editors can install `packages/zds-plugin` from a local checkout
until the SDK is published. ZDS currently provides compilation diagnostics, not
TypeScript semantic checking, autocomplete, or SDK installation UI. The independent
`lib/typescript` extension supplies Code-surface parsing and light/dark syntax
highlighting for JavaScript, TypeScript, JSX, and TSX, including plugin sources.

Sucrase strips TypeScript and emits a CommonJS module evaluated inside QuickJS.
There is no host `require`: runtime imports fail activation. No npm installation,
build scripts, native modules, or remote modules execute on the author's behalf.

## Contribution boundary

Public SDK types describe guest values. Internal contribution types containing
React components, DOM nodes, CodeMirror views, Signals, or application services
cannot cross this boundary. Shared pure data types can later move into SDK
modules and be imported by both the internal contract and its adapter.

The guest's `contribute(kind, definition)` serializes data and replaces function
values with callback references. Trusted core extensions register adapters in
`communityContributionAdaptersFacet`. Each adapter parses its own input, requires
any relevant declared and granted permissions, and returns native Plankton
extensions. Command IDs are namespaced by installation, independently of the
self-declared manifest ID. Adapters must not perform effects while preparing
contributions; acquisition failures must retain the previous installation.

Only the `command` adapter is implemented. The intended additional adapters are:

| Contribution point | Trusted host responsibility |
| --- | --- |
| Modeling tools | Bind a view/execution target and mediate reviewed modeling operations. |
| Layout areas | Register a namespaced `areaType` backed by a host-rendered surface. |
| Executors | Supply explicitly authorized snapshots, propagate cancellation, and discard stale results. |
| Editor views | Own the native view and render a guest-provided declarative UI description. |

Core features should contribute these adapters themselves. The community loader
should not grow a switch over every application feature. SDK contribution maps
can grow alongside their checked adapters. TypeScript declaration merging helps
authoring but grants no runtime authority. Async callbacks, callback arguments and
results, declarative UI, and protocol versions for additional contribution points
still need implementation before these adapters can be delivered.

## Permissions and isolation

The [contribution and authority decision](../../dev-docs/adr/0002-community-contributions-and-authority.md)
records the boundary between registering features and receiving permission to
access data or perform privileged operations.

Each runtime generation has a separate QuickJS Wasm module, an 8 MiB guest heap
limit, a stack limit, and a 100 ms execution deadline per activation or command.
The host bounds contribution size/count and notification size/count. Guest code
has no browser, network, filesystem, Electron, or Node APIs. Module loading does
not expose the application's preload bridge. Compiler and runtime assets ship
with ZDS; they are not fetched from a plugin-specified URL.

The sole implemented privileged operation is `ui.notify`. Both declaration and
explicit installation grant are checked at the host call. Activation cannot show
notifications. Changed source can inherit the same grants during development;
new permissions pause reload for approval. Stop revokes access immediately,
including commands retained by an old caller. Grants are in-memory only.

The string permission set is deliberately limited to this operation. Before
adding project or network access, introduce capability-specific parsed requests
and grants with host-resolved project/path/origin scopes. A bare `project.read`
boolean is insufficient. Keep contributions and authority separate: registering a
tool must not implicitly grant project edits or arbitrary command dispatch.
Permission denial, revocation, request timing, user defaults, and optional grants
belong to a host broker. Network access must use that broker, check redirect
destinations, exclude application credentials, and separately restrict local
network destinations. Project-read plus network grants permit disclosure to the
approved destination and must be explained together in approval UI.

These limits and tests are not a security audit. QuickJS currently executes on
the renderer thread; a worker-owned runtime and aggregate resource budgets need
evaluation before wider distribution.

## Installation and distribution

Installation records, startup activation preferences, and permission grants are
separate state. An inactive installation can retain its grants; activating a
plugin does not approve new permissions. A future installed-plugin setting can
retain source/release references and startup preferences, while a host-owned
grant store records approvals keyed to installation identity and scope. Project
configuration must not confer grants merely by declaring a bundled plugin.
These persistence mechanisms are not implemented by the development prototype.

This prototype identifies a development installation by its backing editor and
tracks the exact source text for replacement. It does not implement releases,
content digests, signatures, publisher identity, or installation from Projects.

Future distributed installations must pin an immutable artifact/revision and
digest, separately from the Projects container ID and the author's version label.
Bundled or discovered source never inherits another user's grants and must not
run merely because a project opened. Published update approval and rollback must
operate on exact artifacts rather than following a mutable project revision.

## Verification

`npm run test:unit -- src/lib/communityPlugins` exercises the real QuickJS runtime,
permission denial, absent host globals, CPU/heap limits, reload failure, and the
registered editor/executor/command flow. No KCL Wasm build is required by these
tests. Smoke testing the steps above still matters for actual project-file
opening, feature flags, pane switching, and the packaged desktop application.
