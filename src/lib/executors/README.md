# Execution context for editor modes

Executors watch a bound editor and run every matching capability. Each run uses
an immutable input snapshot; newer input interrupts older work. Results coalesce
without one capability's failure hiding the others. Typed `output.get(capability)`
lookups preserve the data type declared by that capability.

An executor is independent of editor focus and React mounts. Consumers may create
one explicitly, or use `executionContext(capability, getExecutors)` as a typed
provider for `defineEditorView`. The provider returns an executor and a `result`
signal with that capability's data, error, and run state.

Modes using `executionContext` acquire leases on the same editor's executor.
Switching modes preserves its results and resources. Separate editor instances
remain independent, including instances with the same source. Closing an editor
or its project releases its executors; removing the last leased mode also closes
its executor. Markdown demonstrates this pairing without an engine connection.
