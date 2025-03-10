use std::{
    fs,
    path::{Path, PathBuf},
};

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use tokio::runtime::Runtime;

const IGNORE_DIRS: [&str; 2] = ["step", "screenshots"];

fn discover_benchmark_dirs(base_path: &Path) -> Vec<PathBuf> {
    let mut benchmark_dirs = Vec::new();

    if let Ok(entries) = fs::read_dir(base_path) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_dir() {
                let dir_name = path.file_name().unwrap().to_string_lossy();
                if !IGNORE_DIRS.iter().any(|&x| x == dir_name) {
                    benchmark_dirs.push(path);
                }
            }
        }
    }

    benchmark_dirs
}

fn find_main_kcl_file(dir_path: &Path) -> PathBuf {
    let file_path = dir_path.join("main.kcl");

    if !file_path.exists() || !file_path.is_file() {
        panic!("Required main.kcl file not found in directory: {}", dir_path.display());
    }

    file_path
}

fn run_benchmarks(c: &mut Criterion) {
    // Specify the base directory containing benchmark subdirectories
    let base_dir = std::env::current_dir().unwrap().join("../public/kcl-samples");

    if !base_dir.exists() || !base_dir.is_dir() {
        panic!("Invalid base directory: {}", base_dir.display());
    }

    let benchmark_dirs = discover_benchmark_dirs(&base_dir);

    let rt = Runtime::new().unwrap();

    for dir in benchmark_dirs {
        let dir_name = dir.file_name().unwrap().to_string_lossy().to_string();

        // Find main.kcl file (will panic if not found)
        let input_file = find_main_kcl_file(&dir);

        // Read the file content (panic on failure)
        let input_content = fs::read_to_string(&input_file)
            .unwrap_or_else(|e| panic!("Failed to read main.kcl in directory {}: {}", dir_name, e));

        // Create a benchmark group for this directory
        let mut group = c.benchmark_group(&dir_name);
        group.sample_size(10);

        let program = kcl_lib::Program::parse_no_errs(&input_content).unwrap();

        group.bench_function("parse", |b| {
            b.iter(|| kcl_lib::Program::parse_no_errs(black_box(&input_content)).unwrap())
        });

        group.bench_function("execute", |b| {
            b.iter(|| {
                rt.block_on(async {
                    let ctx = kcl_lib::ExecutorContext::new_with_default_client(Default::default())
                        .await
                        .unwrap();
                    let mut exec_state = kcl_lib::ExecState::new(&ctx.settings);
                    ctx.run(black_box(&program), &mut exec_state).await.unwrap();
                    ctx.close().await;
                })
            })
        });

        group.finish();
    }
}

criterion_group!(benches, run_benchmarks);
criterion_main!(benches);
