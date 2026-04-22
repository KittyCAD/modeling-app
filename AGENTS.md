# AGENTS.md

## Scope

This file applies to the repository root unless a deeper `AGENTS.md` overrides it. For any work under `rust/`, read and follow `rust/AGENTS.md`.

## Project overview

- This repository is Zoo Design Studio, a React/Vite/Electron CAD application.
- Main application code lives in `src/`.
- End-to-end tests live in `e2e/`.
- Shared packages live in `packages/`.
- There is a substantial Rust part of the codebase in `rust/`. It powers the WASM layer, KCL language tooling, and related services. Treat `rust/` as its own workspace and use `rust/AGENTS.md` for Rust-specific build, lint, test, and release instructions.

## Setup commands

- Install the Node version from `.nvmrc`: `fnm install` then `fnm use`.
- Install JS dependencies: `npm install`.
- Install Rust and WASM tooling when needed:
  - macOS/Linux: `npm run install:rust` and `npm run install:wasm-pack:cargo`
  - Windows equivalents exist in `package.json`
- Build the WASM layer before Electron development, integration tests, or any workflow that depends on the KCL runtime: `npm run build:wasm`

## Development commands

- Browser dev server: `npm start`
- Electron app with hot reload: `npm run tron:start`
- Production desktop package: `npm run tronb:package:prod`

## Dev environment tips

- `npm run tron:start` assumes `npm install` and `npm run build:wasm` have already been run.
- The built WASM bundle is generated output. Do not hand-edit generated files under `public/` or Rust-generated artifacts unless the task is specifically about generated output.
- Generated KCL stdlib docs under `docs/kcl-std/` are overwritten by Rust-side generation; do not manually edit them.
- Local browser development may use billable modeling commands for non-employees.
- Some Zoo dev infrastructure is not publicly accessible. If a workflow that targets `dev.zoo.dev` fails for access reasons, prefer the documented production-facing or local alternatives instead of assuming the environment is broken.

## Code style

- Format with Biome: `npm run fmt`
- Check formatting without writing: `npm run fmt:check`
- Lint JS/TS code: `npm run lint`
- Follow existing test naming:
  - `*.test.*` for unit tests
  - `*.spec.*` for integration and Playwright tests
- Keep changes aligned with existing patterns in the area you edit instead of introducing new conventions.
- Avoid non-ASCII characters in comments.

## Testing instructions

- Unit tests: `npm run test:unit`
- Integration tests: `npm run test:integration`
- Full Vitest suite: `npm run test`
- Web Playwright tests: `npm run test:e2e:web`
- Desktop Playwright tests: `npm run test:e2e:desktop` or `npm run test:e2e:desktop:local`
- Rust/KCL end-to-end checks: `npm run test:e2e:kcl`
- Run the narrowest relevant checks for the files you changed, then broaden if the change crosses boundaries such as `src/` plus `rust/`.

## Tokens and external services

- `VITE_ZOO_API_TOKEN` can be set in `.env.development.local` for local browser and editor/LSP workflows that need authenticated Zoo API access.
- `ZOO_API_TOKEN` is required for many Rust/KCL tests.
- Playwright and KCL-related tests may depend on remote services or credentials. Confirm the needed token is available before running broad suites.
