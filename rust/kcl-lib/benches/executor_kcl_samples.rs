use std::{
    fs,
    path::{Path, PathBuf},
};

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion};
use kcl_lib::{test_server, UnitLength::Mm};
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

    let benchmark_dirs = discover_benchmark_dirs(&base_dir);

    for dir in benchmark_dirs {
        let dir_name = dir.file_name().unwrap().to_string_lossy().to_string();

        // Find main.kcl file (will panic if not found)
        let input_file = find_main_kcl_file(&dir);

        // Read the file content (panic on failure)
        let input_content = fs::read_to_string(&input_file)
            .unwrap_or_else(|e| panic!("Failed to read main.kcl in directory {}: {}", dir_name, e));
        c.bench_with_input(BenchmarkId::new("execute", dir_name), &input_content, |b, s| {
            let rt = Runtime::new().unwrap();
            // Spawn a future onto the runtime
            b.iter(|| {
                rt.block_on(test_server::execute_and_snapshot(s, Mm, None)).unwrap();
            });
        });
    }
}

criterion_group!(benches, run_benchmarks);
criterion_main!(benches);
