# Registry package agent guidance

Repository `AGENTS.md` instructions apply. The guidance below concerns the new
`@kittycad/registry/next` runtime; keep the legacy default entrypoint unchanged by
new-runtime API changes. Use [ALGEBRA.md](ALGEBRA.md) for the public model and
[CONTRIBUTING.md](CONTRIBUTING.md) for design rules, runtime guarantees, and
verification commands.

## Working in this package

- Keep core code in `src/`, examples in `src/examples/`, unit/property tests in
  `*.test.ts`, and component integration tests in `*.spec.tsx`.
- Use relative imports internally. Keep app dependencies out of core modules;
  app-specific behavior belongs in app consumers, examples, or tests.
- Prefer composition and existing helpers to new primitives or public types.
  Static groups are Extension arrays; Factories manage instances and dependencies.
- Preserve dependency/export and Facet/input type relationships internally.
  Do not move responsibility for type safety onto callers through casts.
- Keep planning separate from execution. Preserve first occurrence, cycle
  detection, atomic publication, retained owners, shared dependency lifetimes,
  rollback, and complete cleanup after failures.
- Keep `create` synchronous. Start observation-driven work through `start` after
  publication; do not introduce consumer microtasks to work around startup order.
- Test observable guarantees with independent expectations. Extend the relevant
  property suite for graph or lifetime changes; avoid tests that copy the code.
- Update public exports, examples, docs, and affected app consumers together for
  API changes. Preserve stack ancestry when changing shared contracts.
- Run the relevant checks from CONTRIBUTING.md and report remaining limitations
  accurately. Keep commits focused; do not rewrite CI to hide a failing check.
