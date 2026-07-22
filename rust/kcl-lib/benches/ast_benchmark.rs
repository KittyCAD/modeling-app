//! AST-focused benchmarks for the Arc-backed `BoxNode` change: parse cost,
//! AST clone cost, and mutation passes (digest, node paths) on owned vs.
//! shared trees.
//!
//! The `shared` variants retain the original program while mutating a clone,
//! so every `BoxNode` is aliased and copy-on-write has to deep-clone as the
//! pass descends. This models a `FunctionSource` from a previous run keeping
//! function ASTs alive while an editor pass mutates the tree (the worst case
//! for COW), not just a synthetic clone.

use criterion::Criterion;
use criterion::criterion_group;
use criterion::criterion_main;

pub fn bench_ast(c: &mut Criterion) {
    for (name, file) in [
        ("pipes_on_pipes", PIPES_PROGRAM),
        ("big_kitt", KITT_PROGRAM),
        ("mike_stress_test", MIKE_STRESS_TEST_PROGRAM),
        ("lsystem", LSYSTEM_PROGRAM),
    ] {
        c.bench_function(&format!("ast_parse_{name}"), |b| {
            b.iter(|| kcl_lib::Program::parse_no_errs(file).unwrap())
        });

        let prog = kcl_lib::Program::parse_no_errs(file).unwrap();

        c.bench_function(&format!("ast_clone_{name}"), |b| {
            let prog = prog.clone();
            b.iter(move || prog.clone())
        });

        // Mutation passes on an exclusively owned tree (the common case:
        // fresh from the parser). Setup produces an unshared copy each
        // iteration; only the pass itself is timed.
        c.bench_function(&format!("ast_digest_owned_{name}"), |b| {
            b.iter_batched(
                || kcl_lib::Program::parse_no_errs(file).unwrap(),
                |mut prog| {
                    prog.compute_digest();
                    prog
                },
                criterion::BatchSize::LargeInput,
            )
        });

        c.bench_function(&format!("ast_node_paths_owned_{name}"), |b| {
            b.iter_batched(
                || kcl_lib::Program::parse_no_errs(file).unwrap(),
                |prog| prog.fill_node_paths(),
                criterion::BatchSize::LargeInput,
            )
        });

        // Clone-then-mutate-most with the ORIGINAL retained: every node is
        // shared, so (with Arc-backed nodes) copy-on-write deep-clones the
        // whole tree as the digest pass descends.
        c.bench_function(&format!("ast_digest_shared_clone_{name}"), |b| {
            let prog = prog.clone();
            b.iter(move || {
                let mut clone = prog.clone();
                clone.compute_digest();
                clone
            })
        });
    }
}

criterion_group!(benches, bench_ast);
criterion_main!(benches);

const KITT_PROGRAM: &str = include_str!("../e2e/executor/inputs/kittycad_svg.kcl");
const PIPES_PROGRAM: &str = include_str!("../e2e/executor/inputs/pipes_on_pipes.kcl");
const MIKE_STRESS_TEST_PROGRAM: &str = include_str!("../tests/mike_stress_test/input.kcl");
const LSYSTEM_PROGRAM: &str = include_str!("../e2e/executor/inputs/lsystem.kcl");
