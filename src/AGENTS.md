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
- If TypeScript starts failing on missing or stale generated Rust/Wasm bindings, especially after merging main or Rust-side stdlib changes, rerun `npm run build:wasm:dev`. That rebuilds the local Wasm package and refreshes generated bindings used by the TypeScript app.
- Some integration and e2e flows require `VITE_ZOO_API_TOKEN` in `.env.development.local`. If a test needs the token and it is not available, ask before running it.
- For web Playwright runs, set `TARGET=web`. The `Google Chrome` Playwright project name alone does not select the web fixture path; without `TARGET=web`, the shared fixture still tries to launch Electron.
- On NixOS, Playwright may not find branded Chrome at its default `/opt/google/chrome/chrome` path. Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/run/current-system/sw/bin/google-chrome-stable` when running the `Google Chrome` project locally.
- If desktop Playwright e2e tests fail locally because Electron cannot launch with symptoms like `bad option: --remote-debugging-port=0`, `Authorization required, but no authorization protocol specified`, or `Missing X server or $DISPLAY`, run the test with your desktop X11 session variables passed through explicitly: `env -i HOME=$HOME USER=$USER DISPLAY=$DISPLAY XAUTHORITY=$XAUTHORITY XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-x11} PATH=$PATH /run/current-system/sw/bin/bash -lc 'cd <repository-root>/modeling-app && npx playwright test ...'`.
- This is mainly a Linux desktop-session issue, observed on NixOS specifically: a command can work in an interactive terminal but fail from an agent/tool-run process unless X11 auth and related session variables are forwarded.
- For Playwright scene click debugging, `scene.makeMouseHelpers(..., { debugLabel: 'name' })` draws a labeled marker at the resolved stream coordinate without pausing the test. `debugLabel` is the marker switch; there is no separate `debug` flag for mouse helpers. Use `enablePause: true` only when an interactive pause is useful, and ask the user before adding it because `page.pause()` blocks automated runs. A useful offer is: "I can add a labeled click coordinate marker in this test and enable a pause so you can see the exact resolved click point when the test runs."

## Review-friendly edits

- Keep diffs small and intentional. Do not reformat or refactor unrelated code while making a targeted change.
- Do not run `npm run organize-imports` unless the task is specifically about organizing imports.
- Preserve deliberate test import ordering. Some tests call `vi.mock(...)` before importing the component under test because the mocked modules have import-time side effects.
- Prefer local, boring fixes over new abstractions. Add helpers only when they remove real duplication or match an existing local pattern.

## Reviewing code

- Treat KCL, engine behavior, generated artifacts, selections, constraints, and API changes as compatibility-sensitive. Ask whether old KCL, samples, or customer-like projects could now produce different geometry, no geometry, or subtly wrong geometry. Breaking changes need versioning, migration behavior, a feature flag, or clear rollout notes.
- Treat project loading, filesystem state, cloud/local storage, editor state, Zookeeper, and app/project context as data-integrity risks. Look for one clear source of truth, synchronization rules, and coverage for reloads, large projects, nested files, project switching, web, and desktop.
- Check async ownership where state changes, not just where work starts. Background jobs, websocket callbacks, Zookeeper runs, queues, and handoffs must not create stale state.
- For sketch, constraint, region, solver/frontend, and point-and-click changes, simple happy-path sketches are not enough. Look for validation on arcs, tangent constraints, partially constrained sketches and hidden support geometry.
- Review Zookeeper changes as file-editing and state-sync changes, not just chat UI. Verify current project/file context, actual writes, stale context handling, reconnect behavior, nested or missing files, cloud/local projects, large directories, stuck states, and usage/billing stops.
- Require whole-flow validation for user-critical paths such as sign-in, billing, onboarding, install/update, import/export, project creation, and share links. Unit tests are not enough when failures depend on deployed URLs, external services, packaged artifacts, or production-like environments.
- Ask whether failures are loud, recoverable, and observable. Silent no-ops, data loss, wrong-project edits, stale renders, stuck usage, broken onboarding, and wrong geometry need clear errors or safe stops plus enough logging or reporting to debug.
- Increase scrutiny under deadline pressure or for hot paths. Ask about feature flags, staged rollout, rollback paths, and whether the exact demo, workshop, enterprise, or release workflow has been tested.

After reviewing, tell the human what should be smoke tested and whether the PR's tests cover the risk. Prefer regression tests that encode the bug over tests that only prove the new implementation works once. A useful test would have failed before the fix.

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
