# Plankton for Rust

Plankton composes application extensions and manages the resources they share.
This standalone prototype requires Rust 1.88 and has no runtime crate dependencies.

Run the document workspace example from the repository root.

```sh
cargo run --manifest-path packages/plankton-rust/Cargo.toml --example document_workspace
```

The editor receives the document's title signal at construction and contributes
the title to the panel list. A subscriber prints updates after document edits,
sidebar replacement, and outline plugin toggles. The plugin can turn its
outline off, let the document change, and restore the outline for the current
title. See the [example](examples/document_workspace.rs).

## Contracts

A `Facet` marker type declares its `Input`, `Output`, and combiner.
`Binding::new::<Panels>` accepts a `Source<Panels::Input>`, which any matching
zero-argument function or closure implements. `registry.get::<Panels>()` returns
`Panels::Output`. Use a distinct marker for each contract and group related
markers in a module. Adapter types can refer to `<Panels as Facet>::Input` and
the other associated types directly.

A `Service` marker declares a capability, which can be a trait object such as
`dyn FileAccess`. Register an implementation with `Binding::provide::<Files>`.
`resolve` returns `Missing`, `Ready(Rc<_>)`, or `Conflict` with provider origins.
`required` requires one provider. `optional` allows absence and reports conflicts.

Bevy's reflection registry also uses types to identify registrations. Here the
marker selects a contribution list through `TypeId`, and `Any` lets the registry
store lists with different input types. The associated type determines the list's
element type at both insertion and lookup. Factories use definition identity or
an explicit key, so two Factories can export the same type and still have
independent lifetimes. [Bevy TypeRegistry](https://docs.rs/bevy_reflect/latest/bevy_reflect/struct.TypeRegistry.html)
· [Rust std::any](https://doc.rust-lang.org/std/any/)

## Signals and subscriptions

Declare which signals can invalidate a binding with `depending_on`. Share a
`ReadSignal<T>` with consumers that need to read or declare a dependency on the
value. Keep the writable `Signal<T>` with the code that owns updates.

```rust
let title = Signal::new(String::from("sketch.kcl"));
let view = title.read_only();
let source = view.clone();
let panel = Binding::new::<Panels>(move || source.get()).depending_on(&view);
```

`Observation::subscribe` calls the listener with a fresh output when an effective
binding changes or a declared signal is written. Use `get` to read the current
value on demand. Keep the returned guard for as long as the listener should run.
Each `set` invalidates dependents, including writes of equal values. A source
can read any state, and callers declare explicitly which reads should trigger
notifications.

Notifications run synchronously. During reconciliation the registry queues
invalidations and delivers them after cleanup and startup finish. If acquisition
fails, writes to shared signals still take effect and subscribers read the
previously published graph. Facet sources and combiners should remain pure.
Subscriptions installed by an instance can be dropped in its startup cleanup.

## Plugins

`create_plugin` combines a factory, a scoped slot, and a record in the
`Plugins` facet. The factory takes typed constructor dependencies and builds
the extensions for the slot. Plugins start enabled by default. Set
`PluginSpec::enabled_by_default` to `false` to mount the record with an empty
slot. Constructor dependencies stay mounted while the plugin is disabled.
Declare resources that should follow the toggle in child factories.

Use `registry.get::<Plugins>()` to find a plugin's metadata and controller.
The controller exposes an `active` observation and takes `&mut Registry` for
`enable`, `disable`, and `toggle`. Await these operations to finish cleanup.
Activity follows the published graph. A failed
acquisition preserves the previous state, and a cleanup failure after disabling
leaves the plugin inactive. Records remain discoverable while disabled.
An activity subscriber receives updates when its own plugin's enabled state
changes.

## Scoped slots

A factory can call `scope.slot(initial_children)` during construction. It
installs the returned extension among its own children and can share the
`ScopedSlot` handle through a contract such as a service. A controller installed
alongside its slot stays available while the slot is empty.

The controller passes `&mut Registry` when it calls `ScopedSlot::replace`. The
handle is tied to the registry and acquired instance that created it. It works
while that instance owns the slot as a direct child, including through a static
group. Removing and reacquiring the owner invalidates the old handle.

## Planning and inspection

Call `plan(&roots)` to preview the declared extensions. It flattens groups,
selects the first occurrence of each declaration, and lists dependencies before
their consumers. Each item includes its path in the input. The dry run
reports declared cycles and leaves constructor-created children and source
values for runtime.

Call `registry.inspect()` for the currently published graph, including children
returned by constructors. It lists selected items and counts factories,
installed bindings, and facets with contributions. Binding counts include
contributions shadowed by a key. Use `snapshot.debug::<F>()` for the bindings
that contribute to a particular facet. Inspection includes both an item's
current path and its origin, which preserves a retained factory's original
acquisition path. `snapshot.inspect()` reads the inventory captured with that
snapshot.

## Ownership and lifecycle

A constructor declares a concrete dependency with `factory.dependency("name")`.
The constructor receives an owned `Rc<T>` and can keep it in its exports, sources,
or lifecycle callbacks. Combine multiple dependencies with `zip`, and use
`map` if a named struct reads better than a tuple. Constructors and callbacks
can capture owned application state. Their `'static` bound means the captures
cannot borrow short-lived locals. The registry can drop them as soon as their
owners and all other references are gone.

An `Observation<T>` is an owned handle that samples the current graph when
read. Constructors may capture observations and first read them in startup
hooks. A snapshot keeps one graph available for reads across several Facets.
Sources still evaluate on demand, so data captured by a source can change
between reads of the same snapshot.

Factory construction and startup are synchronous. Register cleanup with
`on_dispose` or `on_start_with_cleanup` for synchronous callbacks. Use
`on_dispose_async` or `on_start_with_async_cleanup` for callbacks that return
futures.

Await `configure`, `replace`, and `dispose` to finish reconciliation. The
registry acquires and publishes the new graph before awaiting removed instances'
cleanup. It awaits startup cleanup before disposal, children before owners,
and consumers before dependencies. New instances start after cleanup, then
subscribers receive queued updates. Constructor failures roll back new instances
and preserve the previous graph. Cleanup and startup errors are collected and
leave the committed graph in place.

The registry keeps settlement work if the calling future is dropped. Call
`finish_pending().await` to resume it, or let the next mutation finish it first.
If that work returns an error, the next mutation returns that error before
starting its own changes. Once shutdown begins, it is terminal.
Await `dispose` to finish shutdown. Dropping the registry can run cleanup that
completes immediately in graph order. Cleanup that suspends needs an executor
and an explicit await.

Retaining a snapshot or a service handle can extend the life of a Rust value
beyond registry removal. Keep resources that need a deterministic shutdown
boundary behind an explicit cleanup hook. Lifecycle failure reporting covers
errors returned from hooks. Panics follow ordinary Rust unwinding.

This prototype uses a single-threaded registry. The application supplies its
executor. The TypeScript service facade is outside this prototype's scope.
