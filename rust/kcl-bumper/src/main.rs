//! Bumps versions in Cargo.toml.
use anyhow::Context;
use anyhow::Result;
use clap::Parser;
use toml_edit::DocumentMut;
use toml_edit::Item;
use toml_edit::Value;
use toml_edit::value;

/// Deps that need to be updated in lock-step.
const KCL_API_DEPS: [&str; 1] = ["kcl-error"];
const KCL_LIB_DEPS: [&str; 4] = ["kcl-api", "kcl-derive-docs", "kcl-error", "kcl-syntax"];
const KCL_TEST_SERVER_DEPS: [&str; 1] = ["kcl-lib"];

fn main() -> Result<()> {
    let args = Args::parse();
    // Get all the directories in the current directory.
    let mut dirs = std::fs::read_dir(".").context("Could not read current directory")?;
    for dir in dirs.by_ref() {
        let dir = dir.context("Could not read directory")?;
        if !(dir.path().display().to_string().starts_with("./kcl-") && dir.path().is_dir()) {
            // We only care about the kcl-* directories.
            continue;
        }
        println!("Found directory: {}", dir.path().display());
        run_on_manifest(dir.path().join("Cargo.toml"), &args)?;
        eprintln!("Bumped version in {}", dir.path().display());
    }

    Ok(())
}

fn run_on_manifest(manifest_path: std::path::PathBuf, args: &Args) -> Result<()> {
    let crate_name = manifest_path
        .parent()
        .and_then(|path| path.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_owned();

    let cargo_dot_toml = std::fs::read(&manifest_path).context("Could not read chosen Cargo.toml")?;
    let cargo_dot_toml = String::from_utf8(cargo_dot_toml).context("Invalid UTF-8 in chosen Cargo.toml")?;
    let mut doc = cargo_dot_toml
        .parse::<DocumentMut>()
        .context("Invalid TOML in Cargo.toml")?;
    let next_version = update_semver(args.bump, &mut doc).context("Could not bump semver")?;

    if let Some(next_version) = next_version.as_ref() {
        match crate_name.as_ref() {
            "kcl-api" => {
                update_dependency_versions(&crate_name, &KCL_API_DEPS, &mut doc, next_version);
            }
            "kcl-lib" => {
                update_dependency_versions(&crate_name, &KCL_LIB_DEPS, &mut doc, next_version);
            }
            "kcl-test-server" => {
                update_dependency_versions(&crate_name, &KCL_TEST_SERVER_DEPS, &mut doc, next_version);
            }
            _ => {}
        }
    }

    std::fs::write(manifest_path, doc.to_string()).context("Could not write updated Cargo.toml")?;
    Ok(())
}

fn parse_version(cargo_dot_toml: &DocumentMut) -> Result<semver::Version> {
    let current_version = cargo_dot_toml["package"]["version"]
        .to_string()
        // Clean quotations and whitespace.
        .replace([' ', '"'], "");

    semver::Version::parse(&current_version).context("Could not parse semver version")
}

/// Update the given TOML document (for a Cargo.toml file) by bumping its `version` field.
/// What kind of bump (major, minor, patch) is given by the `bump` argument.
fn update_semver(bump: Option<SemverBump>, cargo_dot_toml: &mut DocumentMut) -> Result<Option<semver::Version>> {
    let current_version = parse_version(cargo_dot_toml)?;

    // Get the next version.
    let Some(bump) = bump else {
        println!("{current_version}");
        return Ok(None);
    };
    let mut next_version = current_version;
    match bump {
        SemverBump::Major => next_version.major += 1,
        SemverBump::Minor => next_version.minor += 1,
        SemverBump::Patch => next_version.patch += 1,
    };

    // Update the Cargo.toml
    cargo_dot_toml["package"]["version"] = value(next_version.to_string());
    println!("{next_version}");
    Ok(Some(next_version))
}

fn update_dependency_versions(
    crate_name: &str,
    dependencies: &[&str],
    cargo_dot_toml: &mut DocumentMut,
    next_version: &semver::Version,
) {
    // Make crate depend on the new versions so that crates that depend on
    // crate also update these.
    for dependency in dependencies {
        if !update_dependency_version(cargo_dot_toml, dependency, next_version) {
            eprintln!("Warning: could not find dependency `{dependency}` in {crate_name} [dependencies]");
        }
    }
}

fn update_dependency_version(cargo_dot_toml: &mut DocumentMut, dependency: &str, version: &semver::Version) -> bool {
    let Some(dependencies) = cargo_dot_toml["dependencies"].as_table_like_mut() else {
        return false;
    };
    let Some(dependency_item) = dependencies.get_mut(dependency) else {
        return false;
    };

    // kcl crates don't use SemVer, so we don't allow kcl-lib 0.2.0 to work with
    // kcl-error 0.2.1. The versions should match exactly, not be merely
    // SemVer-compatible.
    let version_constraint = format!("={version}");
    match dependency_item {
        Item::Value(Value::String(_)) => {
            *dependency_item = value(version_constraint);
            true
        }
        Item::Value(Value::InlineTable(inline_table)) => {
            inline_table.insert("version", Value::from(version_constraint));
            true
        }
        Item::Table(table) => {
            table["version"] = value(version_constraint);
            true
        }
        _ => false,
    }
}

/// Bumps versions in Cargo.toml
#[derive(Parser, Debug)]
struct Args {
    /// What part of the semantic version (major, minor or patch) to bump.
    /// If not given, bumper will just print the current version and then exit.
    #[arg(short, long)]
    bump: Option<SemverBump>,
}

#[derive(Debug, Clone, Copy)]
enum SemverBump {
    Major,
    Minor,
    Patch,
}

impl std::str::FromStr for SemverBump {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "major" => Ok(Self::Major),
            "minor" => Ok(Self::Minor),
            "patch" => Ok(Self::Patch),
            _ => Err("valid options are 'major', 'minor' and 'patch'.".to_owned()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXAMPLE: &str = r#"
[package]
name = "bumper"
version = "0.1.0"

[dependencies]
anyhow = "1.0.81"
        "#;

    #[test]
    fn test_bump_minor() {
        let mut cargo_dot_toml = EXAMPLE.parse::<DocumentMut>().unwrap();
        update_semver(Some(SemverBump::Minor), &mut cargo_dot_toml).unwrap();
        assert_eq!(
            cargo_dot_toml.to_string(),
            r#"
[package]
name = "bumper"
version = "0.2.0"

[dependencies]
anyhow = "1.0.81"
        "#
        );
    }

    #[test]
    fn test_bump_major() {
        let mut cargo_dot_toml = EXAMPLE.parse::<DocumentMut>().unwrap();
        update_semver(Some(SemverBump::Major), &mut cargo_dot_toml).unwrap();
        assert_eq!(
            cargo_dot_toml.to_string(),
            r#"
[package]
name = "bumper"
version = "1.1.0"

[dependencies]
anyhow = "1.0.81"
        "#
        );
    }

    #[test]
    fn test_bump_patch() {
        let mut cargo_dot_toml = EXAMPLE.parse::<DocumentMut>().unwrap();
        update_semver(Some(SemverBump::Patch), &mut cargo_dot_toml).unwrap();
        assert_eq!(
            cargo_dot_toml.to_string(),
            r#"
[package]
name = "bumper"
version = "0.1.1"

[dependencies]
anyhow = "1.0.81"
        "#
        );
    }

    #[test]
    fn test_update_kcl_lib_dependency_versions() {
        const KCL_LIB_EXAMPLE: &str = r#"
[package]
name = "kcl-lib"
version = "0.2.128"

[dependencies]
kcl-derive-docs = { version = "0.1", path = "../kcl-derive-docs" }
kcl-error = { version = "0.1", path = "../kcl-error" }
        "#;

        let mut cargo_dot_toml = KCL_LIB_EXAMPLE.parse::<DocumentMut>().unwrap();
        let next_version = update_semver(Some(SemverBump::Patch), &mut cargo_dot_toml)
            .unwrap()
            .unwrap();
        update_dependency_versions("kcl-lib", &KCL_LIB_DEPS, &mut cargo_dot_toml, &next_version);

        assert_eq!(
            cargo_dot_toml["dependencies"]["kcl-derive-docs"]["version"]
                .as_value()
                .and_then(Value::as_str),
            Some("=0.2.129")
        );
        assert_eq!(
            cargo_dot_toml["dependencies"]["kcl-error"]["version"]
                .as_value()
                .and_then(Value::as_str),
            Some("=0.2.129")
        );
    }

    #[test]
    fn test_missing_kcl_lib_dependency_is_non_fatal() {
        const KCL_LIB_MISSING_DEPENDENCY_EXAMPLE: &str = r#"
[package]
name = "kcl-lib"
version = "0.2.128"

[dependencies]
kcl-derive-docs = { version = "0.1", path = "../kcl-derive-docs" }
        "#;

        let mut cargo_dot_toml = KCL_LIB_MISSING_DEPENDENCY_EXAMPLE.parse::<DocumentMut>().unwrap();
        let next_version = update_semver(Some(SemverBump::Patch), &mut cargo_dot_toml)
            .unwrap()
            .unwrap();
        update_dependency_versions("kcl-lib", &KCL_LIB_DEPS, &mut cargo_dot_toml, &next_version);

        assert_eq!(
            cargo_dot_toml["dependencies"]["kcl-derive-docs"]["version"]
                .as_value()
                .and_then(Value::as_str),
            Some("=0.2.129")
        );
        let dependencies = cargo_dot_toml["dependencies"]
            .as_table_like()
            .expect("dependencies should be a table");
        assert!(dependencies.get("kcl-error").is_none());
    }

    #[test]
    fn test_update_kcl_lib_dependency_versions_without_table() {
        const KCL_LIB_EXAMPLE: &str = r#"
[package]
name = "kcl-lib"
version = "0.2.128"

[dependencies]
kcl-derive-docs = "0.1"
kcl-error = "0.1"
        "#;

        let mut cargo_dot_toml = KCL_LIB_EXAMPLE.parse::<DocumentMut>().unwrap();
        let next_version = update_semver(Some(SemverBump::Patch), &mut cargo_dot_toml)
            .unwrap()
            .unwrap();
        update_dependency_versions("kcl-lib", &KCL_LIB_DEPS, &mut cargo_dot_toml, &next_version);

        assert_eq!(
            cargo_dot_toml["dependencies"]["kcl-derive-docs"]
                .as_value()
                .and_then(Value::as_str),
            Some("=0.2.129")
        );
        assert_eq!(
            cargo_dot_toml["dependencies"]["kcl-error"]
                .as_value()
                .and_then(Value::as_str),
            Some("=0.2.129")
        );
    }

    #[test]
    fn test_update_kcl_test_server_dependency_versions() {
        const KCL_TEST_SERVER_EXAMPLE: &str = r#"
[package]
name = "kcl-test-server"
version = "0.2.128"

[dependencies]
kcl-lib = { version = "0.1", path = "../kcl-lib" }
        "#;

        let mut cargo_dot_toml = KCL_TEST_SERVER_EXAMPLE.parse::<DocumentMut>().unwrap();
        let next_version = update_semver(Some(SemverBump::Patch), &mut cargo_dot_toml)
            .unwrap()
            .unwrap();
        update_dependency_versions(
            "kcl-test-server",
            &KCL_TEST_SERVER_DEPS,
            &mut cargo_dot_toml,
            &next_version,
        );

        assert_eq!(
            cargo_dot_toml["dependencies"]["kcl-lib"]["version"]
                .as_value()
                .and_then(Value::as_str),
            Some("=0.2.129")
        );
    }
}
