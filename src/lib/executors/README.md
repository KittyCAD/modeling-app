# Requested editor computations

An executor owns independently requested computations for one editor. Creating or
acquiring it does no computation. Contributions to `executorCapabilityFacet`
describe eligibility, additional dependency revisions, and an `execute` function.

```ts
const input = executor.input(capability)
const result = executor.result(capability)
await executor.run(capability)
```

`input` observes the current eligible source, contents, and dependency revision.
`result` observes the last completed attempt's input, data or error, completion
identity, progress, and freshness. Its `requested` field identifies the active
request's input, falling back to the completed input when idle. Before any request,
there is no completed input and the result is stale.

An edit, rename, language change, or dependency revision can mark a result stale
without executing, clearing its data, or interrupting requested work. A run may
finish successfully against older input and publish a stale result. Returning to
the same source, contents, and revision restores freshness. Revisions compare with
`Object.is`; producers must publish new values when their dependencies change.

`run(capability)` captures the entrypoint and invokes the capability synchronously,
so adapters can capture additional inputs before their first asynchronous wait.
It returns when that request finishes or is cancelled. Execution errors are
collected in the result rather than rejected. A newer request interrupts only the
same capability's preceding request. Late replies cannot publish. Other capabilities
keep their results and active work. The last completed attempt remains visible
while a replacement runs; a completed failure replaces that attempt with an error.

Changing applicability retains a stale result; a run request for an ineligible
capability does nothing. Withdrawing a contribution cancels its work and removes its
results. Closing the editor, project, or executor cancels all its work and closes
its Effect scope. Requests after shutdown do nothing. Creating or acquiring an
executor for an already closed editor returns an Error.

`output` provides collected data/error summaries and typed `get(capability)` access.
Since capabilities run independently, they may describe different inputs. Its
source/contents identify the most recent request; use `result(capability)` for the
input and freshness of an individual result. Duplicate capability IDs can collide
in summaries; typed access and execution ownership use capability object identity.

## Automatic execution policy

`acquireAutomaticExecution(executor, capability, enabled?)` leases a policy that
requests input initially and when it changes. Multiple mode contexts share one
policy for the same executor and capability. Any enabled lease permits automatic
requests. Releasing the last lease stops scheduling without cancelling requested
work. Executor shutdown also stops the policy.

The policy coalesces synchronous edits and waits for active work to finish before
requesting the newest input, skipping intermediate edits. Disabling it cancels
queued requests. Re-enabling it catches up if the result is stale; it does not
rerun a fresh result or repeatedly retry a failed unchanged input.

`executionContext(capability, getExecutors)` acquires a shared executor and typed
result observation without installing a policy. Its optional third argument is an
enabled reader that explicitly acquires the automatic policy. Markdown uses
`() => true`; other consumers can supply a setting or call `run` from a command.

## Assembly and lifetime

The Plankton factory publishes `executorsService` and owns executor cleanup.
Contributions and project sessions are observed composition inputs. Replacing
capabilities preserves the service and editor resources.

Executors are independent of focus and React mounts. Mode contexts lease a shared
executor for their editor; explicitly created executors remain independent even
for the same editor. Switching modes and remounting components retain acquired
contexts. Closing the final leased mode closes its executor. Separate editor
instances retain independent executions even when they refer to the same source.
