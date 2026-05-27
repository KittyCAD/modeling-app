use std::hint::black_box;

use criterion::BenchmarkId;
use criterion::Criterion;
use criterion::criterion_group;
use criterion::criterion_main;
use kcl_lib::ExecState;
use kcl_lib::ExecutorContext;
use kcl_lib::MockConfig;
use kcl_lib::Program;

mod memory_workloads;

fn run_program(rt: &tokio::runtime::Runtime, ctx: &ExecutorContext, program: &Program) {
    rt.block_on(async {
        let mut exec_state = ExecState::new_mock(ctx, &MockConfig::default());
        if let Err(err) = ctx.run(program, &mut exec_state).await {
            panic!("program execution failed: {}", err.error);
        }
    });
}

fn bench_memory_execution(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();
    let ctx = rt.block_on(async { ExecutorContext::new_mock(None).await });
    let programs = memory_workloads::WORKLOADS
        .iter()
        .map(|workload| {
            (
                workload.name,
                Program::parse_no_errs(black_box((workload.source)())).unwrap(),
            )
        })
        .collect::<Vec<_>>();

    let mut group = c.benchmark_group("memory_execution");
    for (name, program) in &programs {
        group.bench_with_input(BenchmarkId::from_parameter(*name), program, |b, program| {
            b.iter(|| run_program(&rt, &ctx, black_box(program)));
        });
    }
    group.finish();

    rt.block_on(async { ctx.close().await });
}

criterion_group!(benches, bench_memory_execution);
criterion_main!(benches);
