# AGENTS.md (TypeScript app)

## Scope

This file applies to TypeScript and React development under `src/`. It complements the repo root `CONTRIBUTING.md` and `eslint.config.mjs`.

## Project overview

`src/` contains the main Zoo Design Studio application, including:
- React UI components and layout areas
- XState machines for app workflows
- KCL parsing, AST editing, execution helpers, and editor integrations
- Electron main/preload entry points and browser runtime code
- Vitest unit and integration tests

## Dev environment tips

- Use `@src/*` imports for app code. Relative imports are mostly reserved for CSS modules and intentionally local plugin/extension code where lint rules allow it.
- The app expects the Rust/Wasm bundle to exist for many integration paths. Use `npm run build:wasm` or `npm run fetch:wasm` before tests that execute KCL.
- Some integration and e2e flows require `VITE_ZOO_API_TOKEN` in `.env.development.local`. If a test needs the token and it is not available, ask before running it.
- If desktop Playwright e2e tests fail locally because Electron cannot launch with symptoms like `bad option: --remote-debugging-port=0`, `Authorization required, but no authorization protocol specified`, or `Missing X server or $DISPLAY`, run the test with your desktop X11 session variables passed through explicitly: `env -i HOME=$HOME USER=$USER DISPLAY=$DISPLAY XAUTHORITY=$XAUTHORITY XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-x11} PATH=$PATH /run/current-system/sw/bin/bash -lc 'cd /home/kurt/repos/fullStack1/modeling-app && npx playwright test ...'`.
- This is mainly a Linux desktop-session issue, observed on NixOS specifically: a command can work in an interactive terminal but fail from an agent/tool-run process unless X11 auth and related session variables are forwarded.

## Review-friendly edits

- Keep diffs small and intentional. Do not reformat or refactor unrelated code while making a targeted change.
- Do not run `npm run organize-imports` unless the task is specifically about organizing imports.
- Preserve deliberate test import ordering. Some tests call `vi.mock(...)` before importing the component under test because the mocked modules have import-time side effects.
- Prefer local, boring fixes over new abstractions. Add helpers only when they remove real duplication or match an existing local pattern.

## Code style

- Format with Biome and lint with ESLint, both covered by `make check`.
- Keep TypeScript types understandable and maintainable. Prefer explicit interfaces, straightforward unions, and local type guards over clever conditional types, heavy generics, or type-level plumbing.
- Use type-only imports for types (`import type { Foo } ...`) because ESLint enforces `@typescript-eslint/consistent-type-imports`.
- Use `isArray()` from `@src/lib/utils`, and any other helpful utils instead of reinventing your own.
- Avoid ad hoc path string handling with `split('/')` or `join('/')`; use existing path utilities or platform APIs.
- Do not use `TOML.parse` or `TOML.stringify` directly. Use the settings/test utility wrappers that preserve app-specific behavior.
- Avoid non-ASCII characters in comments and user-facing strings unless the file already uses them or the product text requires them.

## Error handling

- Import error helpers from `@src/lib/trap`.
- Use `isErr(value)` when you only need to narrow an `Error | T` value.
- Use `err(value)` only when it is useful to log the error to the console; `err` logs as a side effect.
- Use `trap(value)` at UI or machine boundaries when the error should be logged and surfaced to the user with a toast.
- Prefer returning `Error | T` or rejecting with an `Error` over throwing in production code. Tests may throw for clear assertion failures.
- For intentionally fire-and-forget promises, use `.catch(reportRejection)` or an existing local error-reporting pattern so `no-floating-promises` stays meaningful.

## React and state

- Follow existing component structure and Tailwind conventions in nearby files.
- Keep rendered UI text concise and product-specific. Do not add explanatory UI copy for internal implementation details.
- Use stable selectors or extracted selector functions for `useSelector` when a selector is reused or would create noisy rerenders.
- Keep XState event, state, and context changes close to the owning machine. Avoid threading machine internals through unrelated components.
- When a component depends on import-time browser or desktop globals, mock those modules before importing the component in tests.

## Tests

- Unit tests use `*.test.ts` or `*.test.tsx` and run with `npm run test:unit`.
- Integration tests use `*.spec.ts` or `*.spec.tsx` and run with `npm run test:integration`.
- Prefer targeted Vitest runs while iterating, for example `npm run test:unit -- src/path/to/file.spec.tsx`.
- Component tests should prefer user-visible queries (`screen.getByRole`, `screen.getByText`) when practical. `data-testid` is fine for controls or generated content without a stable accessible label.
- Keep mocks narrow and reset state in `beforeEach` or `afterEach` when tests touch localStorage, timers, singleton modules, or machine actors.

## Common verification

For a typical `src/` change, prefer the smallest useful checks first:

```sh
make check
npm run test:unit -- src/path/to/file.spec.tsx
```

Before a broad PR, run:

```sh
make check
npm run test:unit
npm run test:integration
```
