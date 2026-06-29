# Arena Backend CPU Performance

Date: 2026-06-01
Branch: `env-refactor-arena`
Worktree: `/Users/therapon/Repos/GitHub/Zoo/modeling-app/env-refactor-arena/rust`

This run compares the legacy and arena memory backends using Criterion for CPU
timing and DHAT for heap/allocation profiling.
Raw console output is kept in:

- `perf-runs/criterion-legacy.txt`
- `perf-runs/criterion-arena.txt`
- `perf-runs/dhat-legacy.txt`
- `perf-runs/dhat-arena.txt`

CPU commands:

```sh
KCL_MEMORY_IMPL=legacy cargo bench -p kcl-lib --bench memory_benchmark_criterion --locked
KCL_MEMORY_IMPL=arena cargo bench -p kcl-lib --bench memory_benchmark_criterion --locked
```

The table uses the midpoint value from Criterion's reported confidence interval.
Lower is better.

| Workload | Legacy mean | Arena mean | Arena / Legacy | Delta |
|---|---:|---:|---:|---:|
| `many_closure_snapshots` | 18.378 ms | 17.939 ms | 0.976x | -2.39% |
| `many_bindings_and_lookups` | 28.351 ms | 27.633 ms | 0.975x | -2.53% |
| `shadowed_function_calls` | 18.683 ms | 18.325 ms | 0.981x | -1.92% |
| `function_chain_calls` | 17.853 ms | 17.538 ms | 0.982x | -1.76% |
| `wide_object_access` | 28.349 ms | 27.415 ms | 0.967x | -3.30% |
| `array_index_lookups` | 57.808 ms | 56.670 ms | 0.980x | -1.97% |
| `std_prelude_lookups` | 24.085 ms | 23.856 ms | 0.991x | -0.95% |

Summary:

- Arena is at parity or slightly faster than legacy on this CPU run.
- The largest observed improvement is `wide_object_access` at about 3.3%.
- `std_prelude_lookups` is effectively parity; Criterion reported the change as
  within its noise threshold.

## DHAT Heap Profile

DHAT commands:

```sh
KCL_MEMORY_IMPL=legacy cargo bench -p kcl-lib --bench memory_profile --features dhat-heap --locked -- --iterations 20
KCL_MEMORY_IMPL=arena cargo bench -p kcl-lib --bench memory_profile --features dhat-heap --locked -- --iterations 20
```

The table uses per-iteration values from the DHAT CSV output. DHAT elapsed time
is included as a sanity check only; use Criterion above for CPU conclusions.
Lower is better.

| Workload | Legacy DHAT time/iter | Arena DHAT time/iter | DHAT time delta | Legacy alloc/iter | Arena alloc/iter | Alloc ratio | Legacy max live | Arena max live | Max live delta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `many_closure_snapshots` | 4021.254 ms | 3745.324 ms | -6.86% | 84438539 B | 84386293 B | 0.999x | 23.023 MB | 22.958 MB | -0.28% |
| `many_bindings_and_lookups` | 4689.730 ms | 4579.665 ms | -2.35% | 347998281 B | 347933235 B | 1.000x | 74.573 MB | 74.508 MB | -0.09% |
| `shadowed_function_calls` | 4276.002 ms | 4234.949 ms | -0.96% | 92606807 B | 92551361 B | 0.999x | 25.049 MB | 24.984 MB | -0.26% |
| `function_chain_calls` | 4081.764 ms | 4017.722 ms | -1.57% | 95933503 B | 95878057 B | 0.999x | 24.334 MB | 24.269 MB | -0.27% |
| `wide_object_access` | 8776.697 ms | 8681.253 ms | -1.09% | 134878719 B | 134813673 B | 1.000x | 26.484 MB | 26.418 MB | -0.25% |
| `array_index_lookups` | 19902.995 ms | 20474.100 ms | 2.87% | 298666252 B | 298601206 B | 1.000x | 21.742 MB | 21.677 MB | -0.30% |
| `std_prelude_lookups` | 4351.321 ms | 4521.740 ms | 3.92% | 103897438 B | 103880520 B | 1.000x | 23.545 MB | 23.520 MB | -0.11% |

DHAT summary:

- Arena allocation volume is effectively at parity with legacy.
- Arena allocated slightly fewer bytes per iteration on every workload, but the
  differences are below 0.1% in most cases.
- Arena process max-live heap is slightly lower on every workload, by roughly
  0.1% to 0.3%.
- `many_bindings_and_lookups` remains the highest max-live workload at about
  74.5 MB for both backends.
