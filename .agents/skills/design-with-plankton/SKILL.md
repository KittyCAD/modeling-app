---
name: design-with-plankton
description: "Design or refactor a ZDS subsystem with Plankton: organize a concern under src/lib, separate independent systems through contribution contracts, and wire resources and changing inputs through the existing API. Use when explicitly invoked."
---

# Design ZDS systems with Plankton

Use Plankton to assemble the requested subsystem. Identify what it contributes,
which resources it owns, and which inputs can change while it stays installed.
Keep domain operations in ordinary functions and objects; use Plankton for their
assembly, shared dependencies, and lifetimes. Do not redesign Plankton itself or
introduce another registry unless the task establishes a missing capability.

Read the [package guide](../../../packages/plankton/README.md) and relevant
contracts and consumers before choosing the wiring. The
[document workspace example](../../../packages/plankton/src/examples/document-workspace.ts)
shows several concepts together. The app's
[input helpers](../../../src/registry/inputs.ts) provide declared observations;
they are application helpers, not additional package primitives.

## Give the concern a home and a small public contract

Bundle the concern's domain code, components, settings, and tests under
`src/lib/<concern>/`. Put its Plankton assembly in `src/lib/<concern>/registry/`:
typically `contract.ts` for tokens and types, and `index.ts` for the Extensions
or plugins to install. Split larger adapters into neighboring files and export
the bundle through `index.ts`. Reuse existing shared contracts, including those
under `src/registry/contracts`, rather than creating competing tokens or moving
unrelated files just to regularize their locations.

The app [discovers registry entrypoints](../../../src/registry/registry.ts) through
`src/lib/*/registry/index.ts`; its default export is an Extension, often an array.
Check that discovery before adding a second installation path. Define plugins
within the concern's registry folder and include them in that default export;
use the existing [ZDS plugin helper](../../../src/registry/createZdsPlugin.ts)
when settings and feature-controlled activation are needed. A subdirectory is
not automatically installed just because it contains an Extension.

Keep the domain implementation usable without the Registry. Supply ordinary
capabilities to its constructor; let `registry/` adapt injected exports and live
observations to those capabilities. Avoid turning a domain object into a service
locator or placing implementation code in a global wiring directory.

Ask which parts could stand alone before adding imports between concerns.
For example, home-project presentation and project-library operations need not
orchestrate the cloud backend. The
[cloud library adapter](../../../src/lib/cloudProjects/registry/library.ts)
contributes entries, loading state, and library operations through the shared
[Home](../../../src/registry/contracts/homeProjects.ts) and
[project-library](../../../src/registry/contracts/projectLibraries.ts) contracts.
Keep that knowledge in the cloud concern rather than teaching Home or the
library coordinator to call cloud implementation details. A contract can describe
a cloud-backed entry without its consumer depending on the cloud runtime.

For a proposed cross-concern dependency, identify the actual need: a fixed
resource, an optional capability, a list of contributed behaviors, or changing
state. Let the receiving concern define the smallest useful contract and let
other concerns implement it. Prefer this to backend-specific branches or an
ever-growing coordinator. Do not split genuinely inseparable behavior merely to
remove an import.

## Choose the wiring from the behavior

| The subsystem needs… | Use… | Check… |
| --- | --- | --- |
| Commands, language support, views, or configuration with no owned resources | An array of `contribute(facet, () => value)` Bindings | Reuse an existing Facet when its meaning fits. |
| An instance that needs setup, shared identity, or cleanup | `factory({ dependencies, create })` | Name its exports and the event that ends its lifetime. |
| A particular resource during construction, retained while the consumer lives | A dependency on the resource's Factory | `create` receives its actual exports, including any live signals they contain. |
| Aggregated configuration or a selected Service that may appear, disappear, or change | The contract's `observations` Factory | Read its exports after `create`; do not capture one selected provider as a permanent dependency. |
| Several features to supply configuration | A `Facet<I, O>` and its combiner | Define the empty case and whether ordering or duplicate keys matter. |
| A capability selected through application composition | `service<T>()` and `provide(token, capability)` | Missing and conflicting providers need explicit behavior. Constructor injection alone needs no Service token. |
| Content that can be replaced while its owner stays alive | A Slot or a Factory's replaceable children | Replacement must preserve the owner's resources and captured dependencies. |
| An installable plugin or a flag-controlled feature | Existing plugin or feature-gate helpers | Decide which controls remain available while the content is disabled. |

Use arrays to package static registrations. A Factory is not needed to make
static Bindings publish together: a Registry configuration already does that.
Place a static Binding under a Factory when it belongs to that instance and
captures its resources, not merely to give the array a name.

Keep shared tokens in a contract module that providers and consumers can import
without importing each other's implementations. Preserve token types with
`contract` and derive contribution shapes with `InputOf` rather than duplicating
interfaces. `contribute` takes a source function even for constant values;
accepting a plain function value would be ambiguous with a source to execute.

## Constructor inputs versus changing inputs

For a known constructor resource, import its Factory and declare
`dependencies: { files: fileOperationsExtension }`. Use the injected `files`
inside `create`; do not defer the lookup through a callback just to wait for
startup. Dependencies are acquired first and shared until their last dependent
is removed. See the [project-session constructor](../../../src/lib/projectSession/registry/index.ts).

For a changing input, use an existing contract's `observations`, or declare a
consumer-specific dependency with `observe(facet)` or `observeService(token)`
from the app input helpers. Facet observations expose `.value`; Service
observations expose `.current.value` and `.required()`. The former permits
absence; the latter rejects it. Conflicting Service providers remain errors.

Create lazy `computed` projections in the consumer when it needs a particular
setting or derived value. Upstream contracts need not anticipate every useful
projection. Do not read an observation, including through `.peek()` or
`.required()`, during `create`. A Factory receives injected dependencies and an
optional scope with `origin`, `observe`, and `replace`; it has no general resolver.

Return `start` for effects, subscriptions, and background work that read those
observations. It runs after the new configuration is visible and removed
resources finish cleanup. Return cleanup from `start` to stop that work; use
`dispose` to release resources acquired by `create`. Avoid consumer
`queueMicrotask` startup workarounds. The
[cursor preference consumer](../../../src/lib/cursorBlinking/registry/index.ts)
shows a consumer-owned projection and a reversible DOM effect.

An event or command can read a live input when invoked; it needs no startup
effect merely to defer that read. In components using `useSignals`, read the
Registry directly rather than constructing a `computed` just to unwrap it.

## Make ownership and change explicit

Before implementing, describe what survives each relevant change: project
switching, a feature toggle, a provider change, or replacement of child content.
Use the actual domain names, such as document, connection, or session.

- Give Factories stable identities. A repeated key retains the selected instance;
  it does not rerun `create` or swap its captured dependency instances. Reacquire
  the owner when those constructor dependencies must change.
- Bindings' optional keys are local to a Facet and apply after precedence. Do not
  use them as resource lifetime identifiers or silently resolve competing Service
  providers by declaration order.
- Replacing children preserves the owner, but removes children and dependencies
  no longer needed elsewhere. Grouping arrays adds no owner. Diagnostic paths
  describe occurrences and can change when arrays are regrouped.
- Keep Facet sources and combiners free of side effects. Put work in domain
  methods or lifecycle callbacks. Readonly TypeScript types do not prove purity,
  and an arbitrary combiner need not be associative or commutative.
- `create` is synchronous. Failed acquisition releases new resources and leaves
  the old configuration installed; it cannot undo arbitrary external writes.
  Async work started afterward must ignore late results when its owner is gone.
- The Registry rejects overlapping reconfiguration. Reuse the existing
  [feature-gate helper](../../../src/lib/projectSession/next/feature.ts) for
  coordinated toggles instead of adding independent replacement loops.

## Migrate a subsystem and check the result

Map each old registration, lookup, subscription, and cleanup to the choices
above. Keep the domain implementation when it still fits; replace the assembly
and lifecycle wiring. Choose a real migration seam for released behavior, and
keep old and new ownership from running simultaneously. Do not expand a design
request into an application-wide migration.

Exercise one real consumer through the proposed API. Verify that constructor
inputs infer correctly, static registrations remain readable, and replacing a
provider has the intended effect on existing consumers. Revisit any wrapper that
only renames an array, forwards a lookup, or requires repeated manual scheduling.

Check existing coverage, then test observable behavior at the lowest useful
level: shared dependency lifetime, retained owners, provider changes, failed
setup, complete cleanup, and late async completion where relevant. Use generated
histories when several updates interact; use focused examples for regressions.
Inject lightweight test Factories. If a module eagerly imports real defaults,
mock the unrelated module boundary so unit tests do not require generated WASM;
injection alone does not stop those imports. Use integration tests for the real
wiring, and prefer existing coverage to new CI E2E tests.

Follow repository verification guidance. Explain the resulting contributions,
constructor dependencies, changing inputs, and cleanup in ordinary language,
along with the checks and any remaining limitations. For a design-only request,
show that wiring for review before implementation.
