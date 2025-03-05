//! Run all the KCL samples in the `kcl_samples` directory.
//!
//! Use the `KCL_SAMPLES_ONLY=gear` environment variable to run only a subset of
//! the samples, in this case, all those that start with "gear".
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use fnv::FnvHashSet;
use tokio::task::JoinSet;

use super::Test;

lazy_static::lazy_static! {
    /// The directory containing the KCL samples source.
    static ref INPUTS_DIR: PathBuf = Path::new("../../public/kcl-samples").to_path_buf();
    /// The directory containing the expected output.  We keep them isolated in
    /// their own directory, separate from other simulation tests, so that we
    /// know whether we've checked them all.
    static ref OUTPUTS_DIR: PathBuf = Path::new("tests/kcl_samples").to_path_buf();
}

#[test]
fn parse() {
    let write_new = matches!(
        std::env::var("INSTA_UPDATE").as_deref(),
        Ok("auto" | "always" | "new" | "unseen")
    );
    let filter = filter_from_env();
    let tests = kcl_samples_inputs(filter.as_deref());
    let expected_outputs = kcl_samples_outputs(filter.as_deref());

    assert!(!tests.is_empty(), "No KCL samples found");

    // Print out the environment variables.
    eprintln!("Inside simulation_test env...");
    eprintln!("EXPECTORATE={:?}", std::env::var("EXPECTORATE").as_deref());
    eprintln!("TWENTY_TWENTY={:?}", std::env::var("TWENTY_TWENTY").as_deref());

    let input_names = FnvHashSet::from_iter(tests.iter().map(|t| t.name.clone()));

    for test in tests {
        if write_new {
            // Ensure the directory exists for new tests.
            std::fs::create_dir_all(test.output_dir.clone()).unwrap();
        }
        super::parse_test(&test);
    }

    // Ensure that inputs aren't missing.
    let missing = expected_outputs
        .into_iter()
        .filter(|name| !input_names.contains(name))
        .collect::<Vec<_>>();
    assert!(missing.is_empty(), "Expected input kcl-samples for the following. If these are no longer tests, delete the expected output directories for them in {}: {missing:?}", OUTPUTS_DIR.to_string_lossy());
}

#[test]
fn unparse() {
    // kcl-samples don't always use correct formatting.  We don't ignore the
    // test because we want to allow the just command to work.  It's actually
    // fine when no test runs.
}

#[tokio::test(flavor = "multi_thread")]
async fn kcl_test_execute() {
    let filter = filter_from_env();
    let tests = kcl_samples_inputs(filter.as_deref());
    let expected_outputs = kcl_samples_outputs(filter.as_deref());

    assert!(!tests.is_empty(), "No KCL samples found");

    // Print out the environment variables.
    eprintln!("Inside simulation_test env...");
    eprintln!("EXPECTORATE={:?}", std::env::var("EXPECTORATE").as_deref());
    eprintln!("TWENTY_TWENTY={:?}", std::env::var("TWENTY_TWENTY").as_deref());

    // Note: This is unordered.
    let mut tasks = JoinSet::new();
    // Mapping from task ID to test index.
    let mut id_to_index = HashMap::new();
    // Spawn a task for each test.
    for (index, test) in tests.iter().cloned().enumerate() {
        let handle = tasks.spawn(async move {
            super::execute_test(&test, true).await;
        });
        id_to_index.insert(handle.id(), index);
    }

    // Join all the tasks and collect the failures.  We cannot just join_all
    // because insta's error messages don't clearly indicate which test failed.
    let mut failed = vec![None; tests.len()];
    while let Some(result) = tasks.join_next().await {
        let Err(err) = result else {
            continue;
        };
        // When there's an error, store the test name and error message.
        let index = *id_to_index.get(&err.id()).unwrap();
        failed[index] = Some(format!("{}: {err}", &tests[index].name));
    }
    let failed = failed.into_iter().flatten().collect::<Vec<_>>();
    assert!(failed.is_empty(), "Failed tests: {}", failed.join("\n"));

    // Ensure that inputs aren't missing.
    let input_names = FnvHashSet::from_iter(tests.iter().map(|t| t.name.clone()));
    let missing = expected_outputs
        .into_iter()
        .filter(|name| !input_names.contains(name))
        .collect::<Vec<_>>();
    assert!(missing.is_empty(), "Expected input kcl-samples for the following. If these are no longer tests, delete the expected output directories for them in {}: {missing:?}", OUTPUTS_DIR.to_string_lossy());
}

fn test(test_name: &str, entry_point: String) -> Test {
    Test {
        name: test_name.to_owned(),
        entry_point,
        input_dir: INPUTS_DIR.join(test_name),
        output_dir: OUTPUTS_DIR.join(test_name),
    }
}

fn filter_from_env() -> Option<String> {
    std::env::var("KCL_SAMPLES_ONLY").ok().filter(|s| !s.is_empty())
}

fn kcl_samples_inputs(filter: Option<&str>) -> Vec<Test> {
    let mut tests = Vec::new();
    for entry in INPUTS_DIR.read_dir().unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        if !path.is_dir() {
            // We're looking for directories only.
            continue;
        }
        let Some(dir_name) = path.file_name() else {
            continue;
        };
        let dir_name_str = dir_name.to_string_lossy();
        if dir_name_str.starts_with('.') {
            // Skip hidden directories.
            continue;
        }
        if matches!(dir_name_str.as_ref(), "step" | "screenshots") {
            // Skip output directories.
            continue;
        }
        if let Some(filter) = &filter {
            if !dir_name_str.starts_with(filter) {
                continue;
            }
        }
        eprintln!("Found KCL sample: {:?}", dir_name.to_string_lossy());
        // Look for the entry point inside the directory.
        let sub_dir = INPUTS_DIR.join(dir_name);
        let entry_point = if sub_dir.join("main.kcl").exists() {
            "main.kcl".to_owned()
        } else {
            format!("{dir_name_str}.kcl")
        };
        tests.push(test(&dir_name_str, entry_point));
    }

    tests
}

fn kcl_samples_outputs(filter: Option<&str>) -> Vec<String> {
    let mut outputs = Vec::new();

    for entry in OUTPUTS_DIR.read_dir().unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        if !path.is_dir() {
            // We're looking for directories only.
            continue;
        }
        let Some(dir_name) = path.file_name() else {
            continue;
        };
        let dir_name_str = dir_name.to_string_lossy();
        if dir_name_str.starts_with('.') {
            // Skip hidden.
            continue;
        }
        if let Some(filter) = &filter {
            if !dir_name_str.starts_with(filter) {
                continue;
            }
        }

        eprintln!("Found expected KCL sample: {:?}", &dir_name_str);
        outputs.push(dir_name_str.into_owned());
    }

    outputs
}
