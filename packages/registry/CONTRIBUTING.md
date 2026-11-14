# Contributing to the new registry runtime

This guide applies to `@kittycad/registry/next`; the legacy default entrypoint
remains in place until the application migration.

Start with the [algebra guide](ALGEBRA.md) for the algebra and examples. Follow the
[repository contributor guide](../../CONTRIBUTING.md) for dependencies and generated
Rust/Wasm artifacts. Run the commands below from the repository root.

## Keep the algebra small

- Try an array, an existing helper, or a composition of primitives before adding
  a new abstraction. Use arrays for static groups; introduce a Factory when it
  needs an instance, dependency exports, startup work, or cleanup.
- Inject concrete Factory exports for constructor dependencies. Observe a Facet
  or Service when the consumer needs to follow changes in its contributions or
  selected provider. A changing Signal inside an injected object can stay live
  without looking up that object again.
- Keep Facet combiners pure and define their empty-input result. Contributions
  remain explicit source functions, including when the contributed value is a
  function. Services report conflicting providers instead of choosing by order.
- Keep implementation machinery internal. Public exports in `src/next.ts`
  should help authors or callers; consumers should not need casts to connect
  correctly typed Facets, sources, or Factory exports.
- Keep app-specific policy in the app. Core modules use relative imports and
  have no dependency on app internals. Examples and tests may exercise app code.

## Preserve the runtime guarantees

| Area | What a change must preserve |
| --- | --- |
| Planning | Expand declared dependencies before consumers, flatten groups, preserve first occurrence, and reject cycles. Planning never reads or calls `create`, or installs Bindings. |
| Ownership | Share Factory instances within each Registry and keep them alive while reachable from configured roots through dependencies or children. Replacing children preserves their owner's instance and dependencies. A retained consumer cannot silently receive a different dependency instance. |
| Publication | Create instances synchronously, then expose the new contributions together. Failed creation cleans up returned instances and leaves the previous configuration visible. |
| Startup | Read injected exports during `create`; defer registry observations to after publication. Run new instances' `start` callbacks after removed-instance cleanup. Rolled-back instances never start; retained instances do not restart. |
| Cleanup | Await startup cleanup before `dispose`, children before owners, and consumers before dependencies. Continue after failures and report them together. Failures after publication leave the new configuration in place. |
| Isolation | Keep Facet storage separate for each Registry and preserve each Facet's input type. Reject overlapping reconciliations until startup and cleanup finish. |

If `create` allocates resources and throws before returning an instance, it must
release those resources itself: the Registry can only clean up instances it has
received. Await `configure`, `replace`, and `dispose` when completion matters.

## Test the behavior being changed

For planner and lifetime changes, prefer properties over a range of graphs or
configuration histories. Use an independent reference model; copying the runtime
algorithm into the expected result can hide the same bug in both. Keep a small
regression example when a generated failure reveals a defect. Check inferred
public types when inference or a type relationship is part of the change.

Start with affected tests, then run the package suite. Runtime or API changes also
need tests for affected app consumers and a repository typecheck.

```sh
npx vitest run --mode=development packages/registry/src
npx eslint packages/registry/src --max-warnings 0
npm run tsc -- --noEmit
npm run fmt:check
```

Property suites live alongside unit tests in `src/*.properties.test.ts`; lifecycle
cases are in `src/lifecycle.test.ts`. Component integration tests use `*.spec.tsx`.

## Make the change reviewable

Keep implementation, examples, docs, and consumers consistent when changing an
API. Explain the concrete before/after behavior and any changed guarantee in the
PR. Keep commits focused on a logical concern, and keep stacked branches aligned
when shared contracts change. Follow the repository's PR and CI guidance.
