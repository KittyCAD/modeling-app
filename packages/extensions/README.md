# `@kittycad/extensions`

Reactive extension framework for Zoo Design Studio.

This package provides:

- extension signals for declarative composition
- services for imperative capabilities
- runtime extensions for long-lived state
- slots for runtime reconfiguration
- plugins as the installable developer-facing unit

## Mental Model

- `ExtensionContainer` owns the active graph and resolves signals and services.
- `Signal` is a typed extension point that combines many contributions into one value.
- `Service` is a typed capability object that extensions can read from the container.
- `ExtensionDefinition` is the declarative unit that contributes signals, services, and child extensions through `uses`.
- `ExtensionFactory` creates runtime-backed extensions with stable state.
- `Slot` is a replaceable subtree that can be reconfigured at runtime.
- `createPlugin(...)` packages metadata, a slot, and a toggle controller into one installable extension node.

## Concept Map

The most important distinction is:

- an `extension` is any node in the runtime graph
- a `plugin` is one particular kind of extension node meant to be installed, listed in UI, and toggled at runtime

```mermaid
graph TD
  C["ExtensionContainer"]
  N["ExtensionNode"]
  D["ExtensionDefinition"]
  F["ExtensionFactory"]
  P["Plugin<br/>created by createPlugin(...)"]
  S["Signal"]
  V["Service"]
  U["uses"]
  L["Slot"]
  T["Toggle Controller Service"]
  M["Plugin Metadata<br/>pluginsSignal"]

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

- `ExtensionContainer` owns a graph of `ExtensionNode`s.
- `ExtensionDefinition`, `ExtensionFactory`, `Slot`, and `Plugin` are all ways to participate in that graph.
- Plain extensions usually contribute `Signal`s and `Service`s directly.
- A plugin wraps normal extension content in extra structure: metadata for discovery, a slot for runtime enable/disable, and a toggle controller service.
- So a plugin is not separate from the extension system. It is a higher-level, developer-facing packaging pattern built out of normal extension primitives.

## Package Layout

- [`src/index.ts`](./src/index.ts): public entrypoint
- [`src/examples/app.ts`](./src/examples/app.ts): tutorial-style example container
- `src/*.test.ts`: unit tests
- `src/*.spec.tsx`: integration/component tests

## Import Policy

This package lives under `packages/`, so relative imports are allowed within the package.
App code outside the package should import it by package name:

```ts
import { ExtensionContainer, appendSignal } from '@kittycad/extensions'
```

## Notes

- The example app is documentation, not production app wiring.
- The package currently relies on the repo root toolchain and dependency installation.
