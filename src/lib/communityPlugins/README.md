# Local community plugin prototype

This subsystem is available behind `zds_project_shell_refactor`. It demonstrates
explicit activation, persistent local installations, compilation, isolated command
execution, and buffer-driven reloads. It is a development prototype, not a published plugin platform.

## Try it

1. Use the project shell and copy
   `examples/community-plugins/hello.zds.ts` into a disposable project.
2. Open the file. Its Plugin Builder view inspects the TOML manifest and shows
   the requested permissions. Opening and compiling never activate the plugin.
3. Approve notifications. Select **Start preview** for a temporary
   preview, **Install snapshot** to retain these exact source contents, or
   **Install for development** to retain the source path and follow open-buffer
   changes. An installed plugin is enabled on startup by default.
4. Find **Hello plugin: Say hello** in the command palette and invoke it.
   For an installed copy, edit **Greeting** under **Settings > Plugins**, select
   **Save Greeting**, and invoke the command again. **Reset Greeting** restores the
   declared default. Values survive disabling the installation and restarting ZDS.
5. Switch to Code and change the greeting. Successful builds reload a running
   preview or development installation. Snapshots retain their installed contents.
   A syntax or activation error leaves the previous working instance available.
6. Closing the document stops its preview. Installed plugins remain available.
   Use **Settings > Plugins > Installed community plugins** to disable, re-enable,
   retry, revoke permissions, or uninstall them, including when their source is
   missing or invalid.

The watcher is the existing editor/executor pipeline: working-buffer changes and
backing changes adopted by an open editor both compile. There is no independent
filesystem watcher for closed development sources. Startup and **Retry / reload
source** read the file again; an open buffer takes precedence. Unsaved development
edits are not retained in the installation and therefore do not survive restart.

## Source and SDK

Both `.zds.js` and `.zds.ts` use a leading `/* @zds-plugin` TOML block. Metadata is
parsed before any guest evaluation. The current manifest requires `id`, `name`,
`api_version = 1`, and `permissions`. An optional plain-text `description` (up to
2000 characters) introduces the plugin in Builder and is retained with installed
metadata, including when the source is unavailable. Unknown metadata fields fail inspection.
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

The `command` and `settings` adapters are implemented. The intended additional adapters are:

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

## Namespaced user settings

An installation inherently owns its ordinary settings namespace. The SDK exposes
`contribute('settings', { fields })` with string, boolean, and number definitions.
Each field requires a local key, title, and matching default; descriptions, string
length limits, and numeric bounds are supported. The host rejects unknown types,
executable UI, unsupported properties, invalid defaults, duplicate declarations,
and declarations exceeding 32 fields. The UI renders standard host controls.

The guest reads declared fields with `zds.settings.getString(key)`, `getBoolean`,
or `getNumber`. Reads return the current value and reject unknown keys or type
mismatches. Declare settings before reading them during activation. Read inside a
command callback when the command should follow later edits, as the hello example
does. The SDK currently provides synchronous reads; users save and reset values
through host controls. Guest writes and change subscriptions are not implemented.

`settingsPagesFacet` describes live pages with stable page/field IDs, a title, and
explicit extension or community-installation ownership. Community adapters assign
ownership from the host installation identity; plugins cannot choose a namespace
or core page owner. These descriptors can feed the redesigned settings editor
without tying page identity to storage categories. This slice displays fields in
the existing Plugins panel; it does not implement the sidebar/page migration or
new settings URL routes.

Page definitions follow the published Plankton graph, independently of the native
settings actor's startup definitions. Successful hot reload replaces the schema
alongside commands; failed activation preserves the previous working graph.
Disabling or removing a schema withdraws its page without discarding values.
Previews read defaults and do not publish installed-plugin settings pages.

User overrides persist in a separate `settings` collection in
`community-plugins.toml`, keyed by host installation UUID. Defaults are not saved
as overrides. Incompatible saved values fall back to the current default with a UI
notice, and remain retained for a future compatible definition. Resetting clears
overrides; uninstall removes the installation's settings and grants. Two
installations with the same manifest ID have independent values. Snapshots remain
pinned: installing an updated example creates a new installation rather than
silently changing an older snapshot's schema.

All access is confined to that installation's declared keys. Reading ordinary
settings needs no additional permission and confers no access to application
settings, other plugins, project contents, or permission grants. A plugin-defined
boolean cannot approve network or project access. Project-level overrides and
secret storage remain outside this protocol.

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
including commands retained by an old caller. Preview grants are in-memory only;
installed-plugin grants persist by installation identity. Disabling retains these
grants. Revocation stops the instance immediately and removes its persistent grant;
uninstall removes both the installation and its grants.

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
separate state. They are persisted as separate collections in a versioned,
user-owned `community-plugins.toml` beside `settings.toml`, following the keymap
sidecar precedent. This keeps the installation and grant mutation in one document.
Project settings never supply either collection. The storage interface can later
be backed by the main settings actor without changing installation lifetimes.

Each explicit installation gets a new host-generated UUID, independently of its
manifest ID. A snapshot stores its exact source text; a development installation
stores its selected source path and follows buffer changes. Restart compiles the
appropriate source and checks the API version, declared plugin ID, supported
permissions, and retained grants before activation. Development source declaring
a different plugin ID must be installed separately and receives no old grants.
Missing, invalid, or incompatible sources remain listed with their error for retry
or removal. One failed source does not block other installed plugins.

An inactive installation retains its grants; enabling does not approve additional
permissions. A changed permission declaration pauses reload for explicit approval.
Permission approval cannot restart an obsolete source if the buffer changed while
the grant was being saved. Disabled installations remain disabled after restart.
Closing the application disposes runtimes without changing activation preferences.

The complete persisted document is parsed before use. Unsupported schemas,
malformed state, duplicate installation IDs, and orphaned or unsupported grants
fail closed and are never silently replaced with empty preferences. Writes detect
stale store snapshots; same-origin windows use Web Locks to serialize the
compare/write pair when available. Same-origin windows receive change notifications
and revoke their old instances before restoring the updated preferences. External
tools do not participate in that lock or notification channel; use Reload after
editing the file externally.
A failed disable, revocation, or uninstall write leaves the current instance stopped
and reports the persistence failure. Reload the list before retrying a stale write.

This slice does not implement hosted releases, cryptographic artifact digests,
signatures, publisher identity, or installation from Projects.

Future distributed installations must pin an immutable artifact/revision and
digest, separately from the Projects container ID and the author's version label.
Bundled or discovered source never inherits another user's grants and must not
run merely because a project opened. Published update approval and rollback must
operate on exact artifacts rather than following a mutable project revision.

## Verification

`npm run test:unit -- src/lib/communityPlugins` exercises the real QuickJS runtime,
permission denial, absent host globals, CPU/heap limits, reload failure, persisted
snapshot/development lifetimes, grant revocation, missing sources, stale writes,
and the registered editor/executor/command flow across simulated app restarts. No KCL Wasm build is required by these
tests. Smoke testing the steps above still matters for actual project-file
opening, feature flags, pane switching, and the packaged desktop application.
