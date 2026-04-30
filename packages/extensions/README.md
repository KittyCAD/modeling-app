# `@kittycad/extensions`

Reactive extension framework for Zoo Design Studio.

This package provides:

- extension signals for declarative composition
- services for imperative capabilities
- runtime extensions for long-lived state
- compartments for runtime reconfiguration
- plugins as the installable developer-facing unit

## Mental Model

- `ExtensionContainer` owns the active graph and resolves signals and services.
- `Signal` is a typed extension point that combines many contributions into one value.
- `Service` is a typed capability object that extensions can read from the container.
- `ExtensionDefinition` is the declarative unit that contributes signals, services, and child extensions through `uses`.
- `ExtensionFactory` creates runtime-backed extensions with stable state.
- `Slot` is a replaceable subtree that can be reconfigured at runtime.
- `createPlugin(...)` packages metadata, a slot, and a toggle controller into one installable extension node.

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
