# Registry algebra and next runtime

The new implementation is available at `@kittycad/registry/next`. The default
`@kittycad/registry` entrypoint and application imports continue to use the existing
implementation. `src/examples/extension-workspace.ts` demonstrates typed Factory
dependencies alongside reactive composition and replaceable children.

| Concept | Essence | Responsibility |
| --- | --- | --- |
| Signal | live observation of `T` | dependency tracking |
| Facet | ordered `readonly Input[] → Output` | pure composition |
| Service | Facet from providers to missing/ready/conflict | singleton capability |
| Contract | named product of Facets | shared vocabulary |
| Factory<T> | `{ key?, dependencies?, create }` | owned lifetime, typed exports, and replaceable children |
| Binding | typed registration with ordering options | contribute to a Facet |
| Extension | Binding, Factory, or group of Extensions | graph composition |
| slot | helper acquiring supplied children | resource-free Factory |

## Composition and identity

A Facet's empty output is `combine([])`. Every combiner must handle that case;
associativity and commutativity are not required. `Source<T> = () => T` accepts
constants and live signal reads without guessing whether a value is a signal.

Factories use explicit `key` identity when supplied, otherwise object identity.
The first selected definition wins, including its dependencies. Rebuilding an
Factory with the same key retains its acquired instance and current children.
Its captured dependency instances must remain unchanged; changing dependencies
requires removing and reacquiring the owner. Removing its last reachable occurrence
ends that lifetime; mounting it again reacquires resources.

Bindings have object identity in the graph. Their optional `key` instead identifies
a contribution **within its Facet**. Contributions are stably ordered by highest,
high, default, low, lowest precedence, then duplicate contribution keys are removed.
A higher-precedence contribution wins a repeated key, with declaration order
breaking ties. Unkeyed contributions are never deduplicated by their value.

`contract(tokens)` freezes a shallow copy with precise readonly token types.
`slot(items, key?)` snapshots the initial child array. Neither freezes nested
application state. `InputOf`, `OutputOf`, and `CapabilityOf` derive adapter types.

## Planning and acquisition

`plan(items)` expands declared dependencies before their owners, flattens groups,
and rejects dependency cycles and recursive groups. It never reads `create` or
installs bindings. Its optional selected-definition map carries earlier decisions
into plans for subsequently acquired children. A losing definition is discarded
before its dependencies are expanded.

Each planned entry has an `ItemPath`: a root index followed by typed
`['items', index]` or `['dependencies', name]` steps. Extension indices are nonnegative
integers; dependency names are the keys of the declared dependency map. `formatPath` renders diagnostics. Paths identify occurrences, not stable
identities. Cycle errors retain structured paths.

`Registry` in `src/nextRegistry.ts` acquires synchronously. Returned children are
planned in turn, with declared definitions selected before acquisition begins.
`factory({ dependencies, create })` infers constructor inputs from a named map
of Factories. Each dependency is acquired once, before its consumers, and its
exports are injected directly. Exports are private construction inputs until the
complete graph commits; they do not require Service tokens or early publication.

```ts
import { factory } from '@kittycad/registry/next'

const files = factory({
  create: () => ({ exports: { read: (path: string) => path.length } }),
})
const editor = factory({
  dependencies: { storage: files },
  create({ storage }) {
    const size = storage.read('document.kcl')
    return { exports: { size } }
  },
})
```

The optional second constructor argument supplies only `origin`, `observe`, and
`replace`; constructor capabilities come from the declared dependency map.
Registry-wide Facet and Service reads must still wait until acquisition finishes.
Services select providers through composition; dependency injection names a concrete
Factory. A dependency discarded by keyed selection cannot supply another
definition's exports. Sources and combiners run under mutation guards.

Every `Facet<I, O>` owns typed per-registry storage. The `contribute` callback
stages `Source<I>` reads and receives a parameterless commit closure. The runtime
never stores untyped token/source pairs or asserts an input type later. Unpublished
source lists belong to one reconciliation attempt. Successful publication batches
all Facet changes and diagnostics, so subscribers cannot see a partial graph.

## Runtime API and cleanup

- `configure(items)` replaces the roots and awaits removed resources.
- `replace(factory, items)` changes a mounted owner's children while retaining the
  owner's acquired resources and declared dependencies. It is the reconfiguration
  operation; it does not reacquire the owner.
- `observe(facet)` returns a live readonly signal; `get(facet)` reads a snapshot.
- `required(service)` rejects absence and conflicts; `optional(service)` permits
  absence but still rejects conflicts.
- `debug(facet)` observes selected contributions, origins, keys, and precedence
  without reading their sources. `inspect()` snapshots selected graph items and
  counts. Binding counts describe installed nodes; debug lists describe effective
  contributions after precedence and key selection.
- `dispose()` and `Symbol.asyncDispose` unmount everything and await cleanup.
  Disposal is terminal and idempotent, even when cleanup fails. `configure([])`
  instead empties a registry that may subsequently be configured again.

An Instance may return `start: () => void | Cleanup`. After atomic publication and
removed-instance cleanup, the registry starts each new instance once, in acquisition
order. `configure` and `replace` resolve after startup finishes. `start` can read
live observations and return an awaitable cleanup; that cleanup runs before the
instance's `dispose`. Retained owners keep their existing effects through child
replacement. Consumer-owned `computed` projections can be constructed lazily in
`create` and first observed by an `effect` in `start`, without manual microtasks.
Startup failures leave the committed graph in place; remaining instances still
start, and publication, cleanup, and startup failures are reported together.

Failed acquisition releases newly returned instances and leaves the previous
graph published and reactive. Rolled-back instances never start. Code allocating resources before throwing without
returning an Instance must release those resources itself. Binding installation
must only register contributions. Rollback does not reverse arbitrary external side
effects or mutations made through an injected dependency.

Cleanup follows dependency and ownership edges, releasing owned children before
their owners and every consumer before its shared dependencies. Reordering roots
cannot reverse those lifetime requirements. Contradictory lifetime edges are rejected
before publication. Cleanup awaits each finalizer, continues
after failures, and reports an AggregateError. A cleanup failure after publication
does not revert the committed graph. Acquisition/publication failures and cleanup
failures are preserved together. Overlapping mutations are rejected while a
transaction or cleanup is in progress.

## Services and plugins

`service<T>(name)` derives singleton composition from a Facet. Provider order never
chooses a winner. Conflicts report every provider ID/path and retain provider
records for developer tools. Multiple capabilities can be composed explicitly
through an ordinary list Facet, avoiding the old `multiple` flag's array-to-`T` cast.

`provide(token, implementation, options?)` publishes a readonly service facade.
Methods preserve their original receiver and are guarded against calls during
Facet computation. Signal fields are exposed as readonly computed signals.
Facades are stable per implementation, service token, and registry. Frozen objects,
accessors, and class methods are supported without modifying the implementation.
Protection is shallow: ordinary nested objects and returned values remain owned
by the service. Directly freezing the facade is unsupported; it is already guarded
against property mutation.

`createPlugin({ id, title, description, items, enabledByDefault? })` is an ordinary
keyed Factory. `plugins` collects its metadata and controller service token. The
controller exposes `active`, `enable`, `disable`, and `toggle`. Metadata and the
controller remain installed while content is disabled. `active` follows committed
content, including when removal commits but cleanup rejects.

## Verification

The suites cover dependency order, first occurrence, cycles, typed path navigation,
service cardinality, mixed-type atomic publication, per-registry isolation, retained
owners, shared dependency lifetimes, injected exports, rollback, precedence/key selection, protected capabilities, and terminal
disposal. Plugin histories exercise enable/disable transitions and cleanup failures.
A React integration test imports the public package entrypoint and checks that live
service state survives plugin reconfiguration. Application consumers use the same
public entrypoint as the package examples.

## Package layout

- `src/algebra.ts`: Facets, Services, Bindings, Factories, and authoring helpers.
- `src/planner.ts` and `src/path.ts`: declared dependencies and structured paths.
- `src/nextRegistry.ts`: acquisition, publication, replacement, diagnostics, and cleanup.
- `src/plugins.ts`: metadata and toggle controllers composed from the primitives.
- `src/examples/extension-workspace.ts`: a document model shared by a live title,
  replaceable sidebar panels, and an independently toggled outline plugin.

Factories use synchronous `create` callbacks and awaitable cleanup. Declarative
groups use ordinary Extension arrays; they should not acquire an extra lifetime merely
to group contributions. The application migration is a separate change.
