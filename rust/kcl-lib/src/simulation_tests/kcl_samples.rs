//! Run all the KCL samples in the `kcl_samples` directory.
use std::{
    fs,
    panic::{AssertUnwindSafe, catch_unwind},
    path::{Path, PathBuf},
};

use anyhow::Result;
use fnv::FnvHashSet;
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use super::Test;

lazy_static::lazy_static! {
    /// The directory containing the KCL samples source.
    static ref INPUTS_DIR: PathBuf = Path::new("../../public/kcl-samples").to_path_buf();
    /// The directory containing the expected output.  We keep them isolated in
    /// their own directory, separate from other simulation tests, so that we
    /// know whether we've checked them all.
    static ref OUTPUTS_DIR: PathBuf = Path::new("tests/kcl_samples").to_path_buf();
}

#[kcl_directory_test_macro::test_all_dirs("../public/kcl-samples")]
fn parse(dir_name: &str, dir_path: &Path) {
    let t = test(dir_name, dir_path.join("main.kcl"));
    let write_new = matches!(
        std::env::var("INSTA_UPDATE").as_deref(),
        Ok("auto" | "always" | "new" | "unseen")
    );
    if write_new {
        // Ensure the directory exists for new tests.
        std::fs::create_dir_all(t.output_dir.clone()).unwrap();
    }
    super::parse_test(&t);
}

#[kcl_directory_test_macro::test_all_dirs("../public/kcl-samples")]
async fn unparse(dir_name: &str, dir_path: &Path) {
    let t = test(dir_name, dir_path.join("main.kcl"));
    unparse_test(&t).await;
}

/// This is different from the rest of the simulation tests because we want to write
/// back out to the original file.
async fn unparse_test(test: &Test) {
    let kcl_files = crate::unparser::walk_dir(&test.input_dir).await.unwrap();
    let futures = kcl_files
        .into_iter()
        .filter(|file| file.extension().is_some_and(|ext| ext == "kcl")) // We only care about kcl
        // files here.
        .map(|file| {
            tokio::spawn(async move {
                let contents = tokio::fs::read_to_string(&file).await.unwrap();
                eprintln!("{}", file.display());
                let program = crate::Program::parse_no_errs(&contents).unwrap();
                let recast = program.recast_with_options(&Default::default());

                catch_unwind(AssertUnwindSafe(|| {
                    expectorate::assert_contents(&file, &recast.to_string());
                }))
            })
        })
        .collect::<Vec<_>>();

    // Join all futures and await their completion.
    for future in futures {
        future.await.unwrap().unwrap();
    }
}

#[kcl_directory_test_macro::test_all_dirs("../public/kcl-samples")]
async fn kcl_test_execute(dir_name: &str, dir_path: &Path) {
    let t = test(dir_name, dir_path.join("main.kcl"));
    super::execute_test(&t, true, true).await;
}

#[test]
fn test_after_engine_ensure_kcl_samples_manifest_etc() {
    let tests = kcl_samples_inputs();
    let expected_outputs = kcl_samples_outputs();

    // Ensure that inputs aren't missing.
    let input_names = FnvHashSet::from_iter(tests.iter().map(|t| t.name.clone()));
    let missing = expected_outputs
        .into_iter()
        .filter(|name| !input_names.contains(name))
        .collect::<Vec<_>>();
    assert!(
        missing.is_empty(),
        "Expected input kcl-samples for the following. If these are no longer tests, delete the expected output directories for them in {}: {missing:?}",
        OUTPUTS_DIR.to_string_lossy()
    );

    // We want to move the screenshot for the inputs to the public/kcl-samples
    // directory so that they can be used as inputs for the next run.
    // First ensure each directory exists.
    let public_screenshot_dir = INPUTS_DIR.join("screenshots");
    for dir in [&public_screenshot_dir] {
        if !dir.exists() {
            std::fs::create_dir_all(dir).unwrap();
        }
    }
    for tests in &tests {
        let screenshot_file = OUTPUTS_DIR.join(&tests.name).join(super::RENDERED_MODEL_NAME);
        if !screenshot_file.exists() {
            panic!("Missing screenshot for test: {}", tests.name);
        }
        std::fs::copy(
            screenshot_file,
            public_screenshot_dir.join(format!("{}.png", &tests.name)),
        )
        .unwrap();
    }

    // Update the README.md with the new screenshots.
    let mut new_content = String::new();
    for test in tests {
        // Format:
        new_content.push_str(&format!(
            r#"#### [{}]({}/main.kcl) ([screenshot](screenshots/{}.png))
[![{}](screenshots/{}.png)]({}/main.kcl)
"#,
            test.name, test.name, test.name, test.name, test.name, test.name,
        ));
    }
    update_readme(&INPUTS_DIR, &new_content).unwrap();
}

#[test]
fn test_after_engine_generate_manifest() {
    // Generate the manifest.json
    generate_kcl_manifest(&INPUTS_DIR).unwrap();
}

fn test(test_name: &str, entry_point: std::path::PathBuf) -> Test {
    let parent = std::fs::canonicalize(entry_point.parent().unwrap()).unwrap();
    let inputs_dir = std::fs::canonicalize(INPUTS_DIR.as_path()).unwrap();
    let relative_path = parent.strip_prefix(inputs_dir).unwrap();
    let output_dir = std::fs::canonicalize(OUTPUTS_DIR.as_path()).unwrap();
    let relative_output_dir = output_dir.join(relative_path);

    // Ensure the output directory exists.
    if !relative_output_dir.exists() {
        std::fs::create_dir_all(&relative_output_dir).unwrap();
    }
    Test {
        name: test_name.to_owned(),
        entry_point: entry_point.clone(),
        input_dir: parent.to_path_buf(),
        output_dir: relative_output_dir,
        // Skip is temporary while we have non-deterministic output.
        skip_assert_artifact_graph: true,
    }
}

fn kcl_samples_inputs() -> Vec<Test> {
    let mut tests = Vec::new();

    // Collect all directory entries first and sort them by name for consistent ordering
    let mut entries: Vec<_> = INPUTS_DIR
        .read_dir()
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .collect();

    // Sort directories by name for consistent ordering
    entries.sort_by_key(|a| a.file_name());

    for entry in entries {
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
        if matches!(dir_name_str.as_ref(), "screenshots") {
            // Skip output directories.
            continue;
        }
        eprintln!("Found KCL sample: {:?}", dir_name.to_string_lossy());
        // Look for the entry point inside the directory.
        let sub_dir = INPUTS_DIR.join(dir_name);
        let main_kcl_path = sub_dir.join("main.kcl");
        let entry_point = if main_kcl_path.exists() {
            main_kcl_path
        } else {
            panic!("No main.kcl found in {sub_dir:?}");
        };
        tests.push(test(&dir_name_str, entry_point));
    }

    tests
}

fn kcl_samples_outputs() -> Vec<String> {
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
    files: Vec<String>,
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
    let title = lines[0].trim_start_matches(COMMENT_PREFIX).trim().to_string();
    let description = lines[1].trim_start_matches(COMMENT_PREFIX).trim().to_string();

    // Get the relative path from the project directory to the primary KCL file
    let path_from_project_dir = full_path_to_primary_kcl
        .strip_prefix(INPUTS_DIR.as_path())
        .unwrap_or(&full_path_to_primary_kcl)
        .to_string_lossy()
        .to_string();

    let mut files = files.to_vec();
    files.sort();

    Some(KclMetadata {
        file: primary_kcl_file,
        path_from_project_directory_to_first_file: path_from_project_dir,
        multiple_files: files.len() > 1,
        title,
        description,
        files,
    })
}

// Function to scan the directory and generate the manifest.json
fn generate_kcl_manifest(dir: &Path) -> Result<()> {
    let mut manifest = Vec::new();

    // Collect all directory entries first
    let mut entries: Vec<_> = WalkDir::new(dir)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .collect();

    // Sort directories by name for consistent ordering
    entries.sort_by_key(|a| a.file_name().to_string_lossy().to_string());

    // Loop through all directories and add to manifest if KCL sample
    for entry in entries {
        let path = entry.path();

        if path.is_dir() {
            // Get all .kcl files in the directory
            let files: Vec<String> = fs::read_dir(path)?
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

            if let Some(metadata) = get_kcl_metadata(path, &files) {
                manifest.push(metadata);
            }
        }
    }

    // Write the manifest.json
    let output_path = dir.join(MANIFEST_FILE);
    expectorate::assert_contents(&output_path, &serde_json::to_string_pretty(&manifest).unwrap());

    println!(
        "Manifest of {} items written to {}",
        manifest.len(),
        output_path.display()
    );

    Ok(())
}

/// Updates README.md by finding a specific search string and replacing all content after it
/// with the new content provided.
fn update_readme(dir: &Path, new_content: &str) -> Result<()> {
    let search_str = "---\n";
    let readme_path = dir.join("README.md");

    // Read the file content
    let content = fs::read_to_string(&readme_path)?;

    // Find the line containing the search string
    let Some(index) = content.find(search_str) else {
        anyhow::bail!(
            "Search string '{}' not found in `{}`",
            search_str,
            readme_path.display()
        );
    };

    // Get the position just after the search string
    let position = index + search_str.len();

    // Create the updated content
    let updated_content = format!("{}{}\n", &content[..position], new_content);

    // Write the modified content back to the file
    expectorate::assert_contents(&readme_path, &updated_content);

    Ok(())
}
