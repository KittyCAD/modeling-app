# `@kittycad/registry`

Reactive registry framework for Zoo Design Studio.

This package provides:

- registry value specs for declarative composition
- services for imperative capabilities
- runtime registry items for long-lived state
- slots for runtime reconfiguration
- plugins as the installable developer-facing unit

## Mental Model

- `Registry` owns the active graph and resolves value specs and services.
- `ValueSpec` is a typed registry point that combines many contributions into one value.
- `Service` is a typed capability object that registry items can read from the registry.
- `RegistryItemDefinition` is the declarative unit that contributes value specs, services, and child registry items through `uses`.
- `RegistryItemFactory` creates runtime-backed registry items with stable state.
- `Slot` is a replaceable subtree that can be reconfigured at runtime.
- `createPlugin(...)` packages metadata, a slot, and a toggle controller into one installable registry node.
- `defineContract(...)` marks a shared bundle of `ValueSpec`s and `Service`s that provider and consumer registry items can both depend on without importing each other.

## Concept Map

The most important distinction is:

- a `registry item` is any node in the runtime graph
- a `plugin` is one particular kind of registry node meant to be installed, listed in UI, and toggled at runtime

```mermaid
graph TD
  C["Registry"]
  N["RegistryItem"]
  D["RegistryItemDefinition"]
  F["RegistryItemFactory"]
  P["Plugin<br/>created by createPlugin(...)"]
  S["ValueSpec"]
  V["Service"]
  U["uses"]
  L["Slot"]
  T["Toggle Controller Service"]
  M["Plugin Metadata<br/>pluginsValueSpec"]

  C -->|"owns and resolves"| N

  N --> D
  N --> F
  N --> L
  N --> P

  D -->|"provides contributions to"| S
  D -->|"provides implementations for"| V
  D --> U
  U -->|"installs child"| N

  F -->|"creates runtime-backed"| D

  P -->|"is still just one"| N
  P -->|"provides"| M
  P -->|"contains"| L
  P -->|"provides"| T
  T -->|"reconfigures"| L
  L -->|"mounts plugin subtree of"| N

  S -->|"combines many contributions into one resolved value"| C
  V -->|"is read imperatively from"| C
```

Read the diagram from top to bottom:

- `Registry` owns a graph of `RegistryItem`s.
- `RegistryItemDefinition`, `RegistryItemFactory`, `Slot`, and `Plugin` are all ways to participate in that graph.
- Plain registry items usually contribute `ValueSpec`s and `Service`s directly.
- A plugin wraps normal registry item content in extra structure: metadata for discovery, a slot for runtime enable/disable, and a toggle controller service.
- So a plugin is not separate from the registry system. It is a higher-level, developer-facing packaging pattern built out of normal registry primitives.

## Decoupling Pattern

When one registry item defines `ValueSpec`s or `Service`s that another registry
item depends on, avoid exporting the tokens from the provider module itself.

Prefer a small contract module:

- `weather.contract.ts`: exports only shared `ValueSpec`s and `Service`s
- `weather.provider.ts`: imports the contract and provides implementations
- `weather.consumer.ts`: imports the same contract and consumes those tokens

The helper below makes that intent explicit:

```ts
import {
  defineContract,
  defineService,
  firstWinsValueSpec,
} from '@kittycad/registry'

export const weatherContract = defineContract({
  currentTemperatureValueSpec: firstWinsValueSpec<number>(
    'weather.current-temperature',
    0
  ),
  weatherSummaryService: defineService<{ readonly summary: string }>(
    'weather.summary'
  ),
})
```

That pattern decouples the import graph from the registry graph:

- consumers import the contract, not the provider registry item module
- providers and consumers can be configured in either runtime order
- module cycles are less likely as the app grows

For app code, prefer organizing contracts by concern under a dedicated registry
contracts area instead of collecting them into one global file. A good shape is:

- `src/registry/contracts/routes.ts`
- `src/registry/contracts/statusBar.ts`
- `src/registry/contracts/settings.ts`

That keeps contracts close to the registry layer while still avoiding a single
"misc contracts" bucket.

## Package Layout

- [`src/index.ts`](./src/index.ts): public entrypoint
- [`src/examples/app.ts`](./src/examples/app.ts): tutorial-style example container
- `src/*.test.ts`: unit tests
- `src/*.spec.tsx`: integration/component tests

## Import Policy

This package lives under `packages/`, so relative imports are allowed within the package.
App code outside the package should import it by package name:

```ts
import { Registry, appendValueSpec } from '@kittycad/registry'
```

## Notes

- The example app is documentation, not production app wiring.
- The package currently relies on the repo root toolchain and dependency installation.
