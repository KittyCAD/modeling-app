# Registry algebra — first sketch

The proposal lives in `src/algebra.ts`, with a small example in
`src/examples/algebra.ts`. It is an independent design sketch, not an implemented
replacement registry or a new public entrypoint. The existing runtime still uses
ValueSpecs; **Facet** is the proposed name going forward.

| Concept | Essence | Responsibility |
| --- | --- | --- |
| Signal | live observation of `T` | dependency tracking |
| Facet | `readonly Input[] → Output` plus identity | pure composition |
| Service | Facet from identified providers to a resolution | exactly-one capability |
| Contract | named product of Facets and Services | shared vocabulary |
| Subtree | identity with `{ create, dependencies? }` | ownership and replacement |
| Binding | typed contribution packaged as registration | token/value agreement |
| Item | Binding, group, or Subtree | graph composition |
| slot | helper that acquires static children | resource-free Subtree |

Facet and Subtree objects are their own identities. Names are diagnostic;
equal names do not make equal tokens. Symbols and token objects need not both
exist. Signals come from Preact rather than a second reactive implementation.

A Facet's empty output is `combine([])`. That removes `defaultValue` and the
possibility of disagreement between two definitions of the empty case. This asks
every combiner to be total, including at zero contributions. It does not require
associativity or commutativity: an ordered many-to-one function is the actual
contract, not necessarily a monoid.

A Service is now `Facet<Provider<T>, Resolution<T>>`, created by `service<T>(name)`.
Its capability type participates in both the input and output; no phantom field
or separate token class is necessary. `provide(token, value)` checks the
implementation against the token with `NoInfer<T>` and produces an ordinary
Facet contribution. Contracts consequently contain only Facets.

Resolution is a discriminated union: missing, ready, or conflict. A conflict
contains at least two identified providers. `scope.required(token)` rejects
absence and conflicts; `scope.optional(token)` permits absence but still rejects
conflicts. Both obtain the matching resolution through `observe(token)` on every
read, so they follow provider replacements and participate in reactive tracking.
`ServiceResolutionError` includes the service name, every provider ID and graph
path, and structured provider records. `provide` obtains provenance from the Sink
at installation; authors need only supply the capability. The interpreter must
assign a consistent Origin to each owner Scope and its owned bindings. IDs are diagnostic labels,
not a deduplication mechanism. Provider order never selects a winner.

`Source<T> = () => T` normalizes contribution inputs: `() => constant` and
`() => signal.value` need no runtime shape guessing. This matters when `T` itself
has a `value` property. Source is an input protocol, not a new reactive engine.
Only calls within a tracked computation participate in dependency tracking.

## Graph and lifetime

The sketch includes the remaining structural concepts:

- **Binding:** `contribute` captures a correctly typed Facet and source in a
  registration closure. `provide` derives from it. The interpreter supplies a
  Sink with the owning Origin to register contributions without reading their
  sources during installation.
- **Item / composition:** a Binding, an array of Items, or a Subtree.
  This is how the primitive tokens become an installable graph without `any`.
- **Subtree / lifetime:** acquire state once per mounted identity and release it
  when unmounted. `create(scope)` returns initial children and optional async
  cleanup. A Subtree can own several services, facet contributions, and children.
- **slot(items):** a Subtree whose acquisition returns a frozen shallow snapshot
  of supplied children and no cleanup. Static and stateful subtrees share one
  protocol; no separate Slot or Factory type remains.

`scope.replace(subtree, items)` reconciles only the current children. It does not
rerun the owner's `create`, invoke its cleanup, or replace its acquired resources.
Declared dependencies remain required while the owner is mounted. On unmount,
current children are removed before owner cleanup. The initial `Instance.items`
is not rewritten: the future interpreter tracks current children separately.

Planning inspects declared dependencies only. It must not call `create`, including
for slots. All child graphs become known during acquisition and need staged
expansion and cycle checks. Slot children are intentionally not a preflight graph.

The remaining ideas look like policies or derived operations:

- **Identity** governs deduplication and state preservation. Token identity alone
  does not settle stable item keys across rebuilt definitions.
- **Ordering** is observable: precedence buckets and declaration order determine
  what a Facet receives. Contribution keys add a separate deduplication policy.
- **Dependencies** express inclusion and construction order, independently of
  capability lookup. `uses` children cannot establish prerequisites for the
  callback that creates them.
- **Resolution** turns the installed graph into live Facet outputs and Service
  availability. `Scope.observe` handles both; service lookup projects its explicit
  missing/ready/conflict resolution through `required` or `optional`.
- **Plugins** derive from Items, slot subtrees, metadata contributions, and a controller
  Service. They need no additional primitive.
- **Diagnostics and purity guards** are runtime policy, not additional algebraic
  types. Removing wrappers would still require deciding how to enforce the
  existing service-surface and pure-combiner guarantees.

Contracts are useful architecture, but add no runtime behavior. JSX and CodeMirror
can supply Facet input types and Service capabilities without joining the core.
Their adapters, effects, and cleanup belong at the subtree/lifetime boundary.

## Decisions before a runtime rewrite

1. Implement interpretation of the proposed Item sum and binding registration.
   No registry interpreter is implemented in this sketch.
2. Implement staged child discovery and reconciliation: replacement retains the
   owner, while unmount releases children before owner resources.
3. Separate singleton capability lookup from multiple-provider composition.
   Today `multiple: true` returns an array cast to `T`; that cardinality needs a
   type-level representation or an explicit Facet of capabilities. The sketch
   implements singleton services only.
4. Retain the existing identity, ordering, dependency, and teardown guarantees
   while replacing their representations in separate steps.

The registry predates subsequent versioned releases, so the experimental module
provides a seam for examining these choices before migrating existing consumers.

## Declared-dependency planner

`plan(items)` in `src/planner.ts` returns ordered `{ item, path }` entries for
Bindings and Subtrees. Groups are flattened. Every identity is visited once;
dependencies precede their owners, and unrelated items retain traversal order.
The first encounter supplies each entry's structured `ItemPath`: a root index
followed by `['items' | 'dependencies', index]` steps. Traversal constructs
nonnegative integer indices. Paths locate occurrences in this input, not persistent
identities; `formatPath` in `src/path.ts` renders them for diagnostics. Origin paths
remain human-readable strings at the provider diagnostic boundary. Identity is
reference identity, so structurally identical definitions remain distinct.

An edge into the active traversal throws `DependencyCycleError`, whose `paths`
describe the cycle. Completed shared dependencies are not cycles. Recursive
groups are rejected too. Planning neither reads `create` nor installs bindings;
slot contents and other acquired children are deliberately outside this plan.

`src/planner.properties.test.ts` compares ordering and provenance against a small
expand-then-deduplicate model and checks reachable cycles against independent
dependency elimination. Structured paths are also followed back through the
input graph to check exact item identity and index validity. Five properties run
300 cases each, alongside examples covering group cycles, shared groups, and
undiscovered slot contents. The DAG fixtures are frozen, and acquisition/installation
callbacks throw if invoked.

The planner is not yet wired into the existing registry. Staged acquisition and
reconciliation remain the next layer.

## Laws checked before interpretation

`src/algebra.properties.test.ts` runs eleven properties with 300 generated cases
each, covering service cardinality, lookup agreement, conflict preservation under
permutation, duplicate providers, diagnostic provenance, lazy binding registration,
live source reads, and provenance assigned per installation. Subtree properties
cover slot snapshots, deferred child acquisition, and replacement forwarding
without owner acquisition or cleanup at the Scope adapter boundary. Empty, singleton, and conflicting inputs are generated
separately so each boundary gets coverage. Inputs include duplicate IDs, empty
labels, escaping, and Unicode; frozen inputs catch attempted mutation.

These laws apply to the supplied service and binding operations. Arbitrary Facet
combiners need not be associative, commutative, or incrementally mergeable. Subtree
execution, graph identity, and disposal ordering await an interpreter. Type errors
are checked separately by the negative cases in `src/algebra.test.ts` and `tsc`.

## Authoring conveniences

- `InputOf`, `OutputOf`, and `CapabilityOf` derive adapter types from contract tokens.
- `createScope(origin, host)` derives token-bound required/optional lookup from the
  interpreter's observation operation. It forwards observation and replacement to
  the host. The standalone `required`/`optional` functions are low-level resolution
  projections; subtree authors should use Scope to keep token and resolution paired.
- `provide(token, value)` attaches the installing Sink's ID and path automatically.
  The same binding installed under different origins receives local provenance.
- Subtrees are plain `{ create, dependencies? }` objects, with object identity and
  contextual typing through `satisfies Subtree`. See `src/examples/algebra.ts`.
- `contract(tokens)` returns a frozen shallow copy with precise readonly token
  properties. `satisfies Contract` remains a type check only.
- The slot helper copies and freezes its initial array. Neither helper freezes nested items,
  token objects, or capability implementations.

The interpreter still needs to assign ownership, acquire subtrees, and register
bindings. These conveniences do not implement those graph or lifetime policies.
