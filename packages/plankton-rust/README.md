# Plankton for Rust

Plankton composes application extensions and manages the resources they share.
This standalone prototype requires Rust 1.88 and has no crate dependencies.

Run the document workspace example from the repository root.

```sh
cargo run --manifest-path packages/plankton-rust/Cargo.toml --example document_workspace
```

The editor receives a shared document at construction. It contributes the
document title to the panel list and reads the complete list at startup.
Replacing the sidebar changes its panels while the editor and document stay
mounted. See the [example](examples/document_workspace.rs).

## Contracts

A `Facet` marker type declares its `Input`, `Output`, and combiner.
`Binding::new::<Panels>` accepts a source returning `Panels::Input`, and
`registry.get::<Panels>()` returns `Panels::Output`. Use a distinct marker for
each contract, even when two contracts have the same input and output types.

A `Service` marker declares a capability, which can be a trait object such as
`dyn FileAccess`. Register an implementation with `Binding::provide::<Files>`.
Resolution returns `Missing`, `Ready(Rc<_>)`, or `Conflict` with provider origins.

Bevy's reflection registry also uses types to identify registrations. Here the
marker selects a contribution list through `TypeId`, and `Any` lets the registry
store lists with different input types. The associated type determines the list's
element type at both insertion and lookup. Factories use definition identity or
an explicit key, so two Factories can export the same type and still have
independent lifetimes. [Bevy TypeRegistry](https://docs.rs/bevy_reflect/latest/bevy_reflect/struct.TypeRegistry.html)
· [Rust std::any](https://doc.rust-lang.org/std/any/)

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

The registry acquires synchronously, publishes the new graph together, releases
removed instances, then starts newly acquired instances. Constructor failures
roll back the new instances. Cleanup and startup errors leave the committed
graph in place. `dispose` reports shutdown failures. Dropping a registry runs
best-effort cleanup. Retaining a snapshot or a service handle can extend the
life of a Rust value beyond registry removal, while lifecycle callbacks still
run at removal. Keep resources that need a deterministic shutdown boundary
behind an explicit cleanup hook. Lifecycle failure reporting covers errors
returned from hooks. Panics follow ordinary Rust unwinding.

This prototype uses a single-threaded registry, synchronous hooks, and pull-based
observations. A host integration would need to decide when change notifications
are delivered and how async cleanup is awaited or canceled. Slots are available
for composing toggles. The TypeScript plugin controller and service facade are
outside this prototype's scope.
