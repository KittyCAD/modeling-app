# Execution context for editor modes

Executors watch a bound editor and run every matching capability. Each run uses
an immutable input snapshot; newer input interrupts older work. Results coalesce
without one capability's failure hiding the others. Typed `output.get(capability)`
lookups preserve the data type declared by that capability. A capability may supply
a reactive `revision` for additional inputs, such as imported buffers; a changed
revision interrupts the previous run even when the bound editor is unchanged.

Creating or acquiring an executor for a closed editor returns an `Error` without
retaining resources. `executionContext` passes that error to the mode binding.

An executor is independent of editor focus and React mounts. Consumers may create
one explicitly, or use `executionContext(capability, getExecutors)` as a typed
provider for `defineEditorView`. The provider returns an executor and a `result`
signal with that capability's data, error, and run state.

Modes using `executionContext` acquire leases on the same editor's executor.
Switching modes preserves its results and resources. Separate editor instances
remain independent, including instances with the same source. Closing an editor
or its project releases its executors; removing the last leased mode also closes
its executor. Markdown demonstrates this pairing without an engine connection.

Multiple view instances of one document can use different modes while sharing
this execution context. Editing its Code view updates a Modeling view immediately;
saving only updates persistence and dirty state, not the execution input. Closing
one tab leaves the document and its remaining contexts alive. Closing the last
view disposes the document and interrupts its executors.

`Executor.refresh()` retries the current editor and capability inputs for that
executor without editing the document or rerunning sibling executors. KCL scene
recovery starts opening a replacement connection and calls `refresh` to load
current sources. Source capture can run during startup; the KCL session waits for
the connection and native runtime before executing. Calls after disposal are
ignored.
