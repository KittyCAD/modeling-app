use std::env;
use std::hint::black_box;
use std::process::Command;
use std::time::Instant;

use dhat::HeapStats;
use kcl_lib::ExecState;
use kcl_lib::ExecutorContext;
use kcl_lib::MockConfig;
use kcl_lib::Program;

#[path = "memory_workloads/mod.rs"]
mod memory_workloads;

fn parse_args() -> (Option<String>, usize) {
    let mut workload = None;
    let mut iterations = 20;
    let mut args = env::args().skip(1);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--bench" => {}
            "--workload" => {
                workload = Some(args.next().expect("--workload requires a value"));
            }
            "--iterations" => {
                iterations = args
                    .next()
                    .expect("--iterations requires a value")
                    .parse()
                    .expect("--iterations must be a positive integer");
            }
            other => panic!("unknown argument `{other}`"),
        }
    }

    assert!(iterations > 0, "--iterations must be positive");
    (workload, iterations)
}

fn run_program(rt: &tokio::runtime::Runtime, ctx: &ExecutorContext, program: &Program) {
    rt.block_on(async {
        let mut exec_state = ExecState::new_mock(ctx, &MockConfig::default());
        if let Err(err) = ctx.run(program, &mut exec_state).await {
            panic!("program execution failed: {}", err.error);
        }
    });
}

fn profile_workload(name: &str, iterations: usize) {
    let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
    let ctx = rt.block_on(async { ExecutorContext::new_mock(None).await });
    let source = memory_workloads::workload_source(name).unwrap_or_else(|| panic!("unknown workload `{name}`"));
    let program = Program::parse_no_errs(black_box(source)).expect("memory benchmark workload must parse");

    run_program(&rt, &ctx, &program);

    let start_stats = HeapStats::get();
    let start_time = Instant::now();
    for _ in 0..iterations {
        run_program(&rt, &ctx, black_box(&program));
    }
    let elapsed = start_time.elapsed();
    let stats = HeapStats::get();

    rt.block_on(async { ctx.close().await });

    let total_blocks = stats.total_blocks - start_stats.total_blocks;
    let total_bytes = stats.total_bytes - start_stats.total_bytes;
    println!(
        "{name},{iterations},{:.3},{:.3},{total_blocks},{:.2},{total_bytes},{:.2},{:.6},{:.6}",
        elapsed.as_secs_f64() * 1000.0,
        elapsed.as_secs_f64() * 1000.0 / iterations as f64,
        total_blocks as f64 / iterations as f64,
        total_bytes as f64 / iterations as f64,
        stats.max_bytes as f64 / 1_000_000.0,
        stats.curr_bytes as f64 / 1_000_000.0,
    );
}

fn run_all_workloads(iterations: usize) {
    println!(
        "workload,iterations,elapsed_ms,elapsed_ms_per_iter,total_alloc_blocks,alloc_blocks_per_iter,total_alloc_bytes,alloc_bytes_per_iter,process_max_live_mb,end_live_mb"
    );
    let exe = env::current_exe().expect("failed to locate current executable");
    for workload in memory_workloads::WORKLOADS {
        let output = Command::new(&exe)
            .arg("--workload")
            .arg(workload.name)
            .arg("--iterations")
            .arg(iterations.to_string())
            .output()
            .unwrap_or_else(|err| panic!("failed to run workload `{}`: {err}", workload.name));

        if !output.status.success() {
            panic!(
                "workload `{}` failed with status {}\nstdout:\n{}\nstderr:\n{}",
                workload.name,
                output.status,
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
        }

        print!("{}", String::from_utf8_lossy(&output.stdout));
    }
}

fn main() {
    let (workload, iterations) = parse_args();
    match workload {
        Some(workload) => profile_workload(&workload, iterations),
        None => run_all_workloads(iterations),
    }
}
