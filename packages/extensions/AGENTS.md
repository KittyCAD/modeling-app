# Extensions Package Guide

This package is the shared extension runtime used by the app.

## Scope

- Keep framework code in `src/`.
- Keep tutorial and usage examples in `src/examples/`.
- Keep unit tests as `*.test.ts`.
- Keep integration/component tests as `*.spec.tsx`.

## Editing Rules

- Prefer relative imports within this package.
- Do not import app internals from `src/` into the core runtime unless the file is explicitly an example or test.
- Preserve the separation between:
  - extension signals as composition
  - services as capabilities
  - runtime extensions as stateful models
  - plugins as installable/toggleable bundles

## Verification

When changing this package, prefer these checks:

```sh
npx eslint packages/extensions/src --max-warnings 0
npx vitest run --mode=development packages/extensions/src
npm run tsc -- --pretty false
```
