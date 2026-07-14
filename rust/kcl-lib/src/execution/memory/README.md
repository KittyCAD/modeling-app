# KCL Memory Backend Profiling

This directory contains the memory backend implementations. Use
`KCL_MEMORY_IMPL` to choose which backend to run:

Note: The legacy backend no longer exists. Commands have been preserved to show intended use of commands.

```sh
KCL_MEMORY_IMPL=legacy
KCL_MEMORY_IMPL=arena
```

Set the backend explicitly for comparisons. Do not rely on the default while
changing which implementation is preferred.

Run all commands from the Rust workspace root:

```sh
cd rust
```

## Validate A Backend

Run the memory backend parity tests first:

```sh
KCL_MEMORY_IMPL=arena cargo nextest run --retries 3 --no-fail-fast -p kcl-lib --locked -- memory_backends
KCL_MEMORY_IMPL=legacy cargo nextest run --retries 3 --no-fail-fast -p kcl-lib --locked -- memory_backends
```

For a full workspace check, run:

```sh
KCL_MEMORY_IMPL=arena cargo nextest run --workspace --retries 3 --no-fail-fast --locked
KCL_MEMORY_IMPL=legacy cargo nextest run --workspace --retries 3 --no-fail-fast --locked
```

## CPU Benchmarks

Use the Criterion memory benchmark for CPU timing:

```sh
KCL_MEMORY_IMPL=legacy cargo bench -p kcl-lib --bench memory_benchmark_criterion --locked
KCL_MEMORY_IMPL=arena cargo bench -p kcl-lib --bench memory_benchmark_criterion --locked
```

Criterion writes detailed reports under:

```text
target/criterion/memory_execution/
```

Compare the same workload names between backends. Current workloads are:

```text
many_closure_snapshots
many_bindings_and_lookups
shadowed_function_calls
function_chain_calls
wide_object_access
array_index_lookups
std_prelude_lookups
```

For stable CPU numbers, keep the machine quiet and avoid comparing Criterion
results against DHAT runs. DHAT changes the allocator and adds instrumentation
overhead.

## Heap Profiling

Use the `memory_profile` bench with the `dhat-heap` feature for allocation and
live-heap stats. The output is CSV.

Run all workloads:

```sh
KCL_MEMORY_IMPL=legacy cargo bench -p kcl-lib --bench memory_profile --features dhat-heap --locked -- --iterations 20
KCL_MEMORY_IMPL=arena cargo bench -p kcl-lib --bench memory_profile --features dhat-heap --locked -- --iterations 20
```

Run one workload:

```sh
KCL_MEMORY_IMPL=legacy cargo bench -p kcl-lib --bench memory_profile --features dhat-heap --locked -- --workload function_chain_calls --iterations 20
KCL_MEMORY_IMPL=arena cargo bench -p kcl-lib --bench memory_profile --features dhat-heap --locked -- --workload function_chain_calls --iterations 20
```

Capture results for comparison:

```sh
KCL_MEMORY_IMPL=legacy cargo bench -p kcl-lib --bench memory_profile --features dhat-heap --locked -- --iterations 20 | tee /tmp/kcl-memory-legacy.csv
KCL_MEMORY_IMPL=arena cargo bench -p kcl-lib --bench memory_profile --features dhat-heap --locked -- --iterations 20 | tee /tmp/kcl-memory-arena.csv
```

CSV columns:

```text
workload
iterations
elapsed_ms
elapsed_ms_per_iter
total_alloc_blocks
alloc_blocks_per_iter
total_alloc_bytes
alloc_bytes_per_iter
process_max_live_mb
end_live_mb
```

Use these columns for heap comparison:

```text
alloc_blocks_per_iter
alloc_bytes_per_iter
process_max_live_mb
end_live_mb
```

The `elapsed_ms_per_iter` column is useful as a rough sanity check, but use
Criterion for CPU conclusions.

## Suggested Comparison Flow

1. Run parity tests for both backends.
2. Run Criterion CPU benchmarks for `legacy`.
3. Run Criterion CPU benchmarks for `arena`.
4. Run DHAT heap profiling for `legacy`.
5. Run DHAT heap profiling for `arena`.
6. Compare workload-by-workload ratios:

```text
arena / legacy
```

Use ratios above `1.0` as regressions and below `1.0` as improvements.
