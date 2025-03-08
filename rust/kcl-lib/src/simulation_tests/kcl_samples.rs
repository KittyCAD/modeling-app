//! Run all the KCL samples in the `kcl_samples` directory.
//!
//! Use the `KCL_SAMPLES_ONLY=gear` environment variable to run only a subset of
//! the samples, in this case, all those that start with "gear".
use std::{
    collections::HashMap,
    error::Error,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use fnv::FnvHashSet;
use serde::{Deserialize, Serialize};
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

    // Note: This is unordered.
    let mut tasks = JoinSet::new();
    // Mapping from task ID to test index.
    let mut id_to_index = HashMap::new();
    // Spawn a task for each test.
    for (index, test) in tests.iter().cloned().enumerate() {
        let handle = tasks.spawn(async move {
            super::execute_test(&test, true, true).await;
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

    // We want to move the step and screenshot for the inputs to the public/kcl-samples
    // directory so that they can be used as inputs for the next run.
    // First ensure each directory exists.
    let public_screenshot_dir = INPUTS_DIR.join("screenshots");
    let public_step_dir = INPUTS_DIR.join("step");
    for dir in [&public_step_dir, &public_screenshot_dir] {
        if !dir.exists() {
            std::fs::create_dir_all(dir).unwrap();
        }
    }
    for tests in tests {
        let screenshot_file = OUTPUTS_DIR.join(&tests.name).join(super::RENDERED_MODEL_NAME);
        if !screenshot_file.exists() {
            panic!("Missing screenshot for test: {}", tests.name);
        }
        std::fs::copy(
            screenshot_file,
            public_screenshot_dir.join(format!("{}.png", &tests.name)),
        )
        .unwrap();

        let step_file = OUTPUTS_DIR.join(&tests.name).join("exported_step.snap.step");
        if !step_file.exists() {
            panic!("Missing step for test: {}", tests.name);
        }
        std::fs::copy(step_file, public_step_dir.join(format!("{}.step", &tests.name))).unwrap();
    }

    // Generate the manifest.json
    generate_kcl_manifest(&INPUTS_DIR).unwrap();
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

const MANIFEST_FILE: &str = "manifest.json";
const COMMENT_PREFIX: &str = "//";

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct KclMetadata {
    file: String,
    path_from_project_directory_to_first_file: String,
    multiple_files: bool,
    title: String,
    description: String,
}

// Function to read and parse .kcl files
fn get_kcl_metadata(project_path: &Path, files: &[String]) -> Option<KclMetadata> {
    // Find primary kcl file (main.kcl or first sorted file)
    let primary_kcl_file = files
        .iter()
        .find(|file| file.contains("main.kcl"))
        .unwrap_or_else(|| files.iter().min().unwrap())
        .clone();

    let full_path_to_primary_kcl = project_path.join(&primary_kcl_file);

    // Read the file content
    let content = match fs::read_to_string(&full_path_to_primary_kcl) {
        Ok(content) => content,
        Err(_) => return None,
    };

    let lines: Vec<&str> = content.lines().collect();

    if lines.len() < 2 {
        return None;
    }

    // Extract title and description from the first two lines
    let title = lines[0].replace(COMMENT_PREFIX, "").trim().to_string();
    let description = lines[1].replace(COMMENT_PREFIX, "").trim().to_string();

    // Get the path components
    let path_components: Vec<String> = full_path_to_primary_kcl
        .components()
        .map(|comp| comp.as_os_str().to_string_lossy().to_string())
        .collect();

    // Get the last two path components
    let len = path_components.len();
    let path_from_project_dir = if len >= 2 {
        format!("{}/{}", path_components[len - 2], path_components[len - 1])
    } else {
        primary_kcl_file.clone()
    };

    Some(KclMetadata {
        file: primary_kcl_file,
        path_from_project_directory_to_first_file: path_from_project_dir,
        multiple_files: files.len() > 1,
        title,
        description,
    })
}

// Function to scan the directory and generate the manifest.json
fn generate_kcl_manifest(dir: &Path) -> Result<(), Box<dyn Error>> {
    let mut manifest = Vec::new();

    // Collect all directory entries first and sort them by name for consistent ordering
    let mut entries: Vec<_> = fs::read_dir(dir)?
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .collect();

    // Sort directories by name for consistent ordering
    entries.sort_by_key(|a| a.file_name());

    for entry in entries {
        let project_path = entry.path();

        if project_path.is_dir() {
            // Get all .kcl files in the directory
            let files: Vec<String> = fs::read_dir(&project_path)?
                .filter_map(Result::ok)
                .filter(|e| {
                    if let Some(ext) = e.path().extension() {
                        ext == "kcl"
                    } else {
                        false
                    }
                })
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect();

            if files.is_empty() {
                continue;
            }

            if let Some(metadata) = get_kcl_metadata(&project_path, &files) {
                manifest.push(metadata);
            }
        }
    }

    // Write the manifest.json
    let output_path = dir.join(MANIFEST_FILE);
    let manifest_json = serde_json::to_string_pretty(&manifest)?;

    let mut file = fs::File::create(output_path.clone())?;
    file.write_all(manifest_json.as_bytes())?;

    println!(
        "Manifest of {} items written to {}",
        manifest.len(),
        output_path.display()
    );

    Ok(())
}
