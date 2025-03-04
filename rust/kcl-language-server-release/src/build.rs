use std::{
    env,
    fs::File,
    io::{self, BufWriter},
    path::{Path, PathBuf},
};

use anyhow::Result;
use clap::Parser;
use flate2::{write::GzEncoder, Compression};
use time::OffsetDateTime;
use xshell::{cmd, Shell};
use zip::{write::FileOptions, ZipWriter};

/// A subcommand for building and packaging a release.
#[derive(Parser, Clone, Debug)]
pub struct Build {
    /// An optional client patch version to use.
    #[clap(long = "client-patch-version", default_value = "None")]
    pub client_patch_version: Option<String>,
}

impl Build {
    pub(crate) fn run(&self, sh: &Shell) -> Result<()> {
        let stable = sh
            .var("GITHUB_REF")
            .unwrap_or_default()
            .as_str()
            .contains("refs/tags/v");

        let project_root = crate::project_root();
        let target = Target::get(&project_root);
        let build = project_root.join("build");
        sh.remove_path(&build)?;
        sh.create_dir(&build)?;

        // Read the version from our root Cargo.toml.
        let version = sh.read_file("Cargo.toml")?;
        let mut version = version
            .lines()
            .find(|line| line.starts_with("version = "))
            .unwrap_or_default()
            .replace("version = ", "")
            .replace(['\"', '\''], "")
            .trim()
            .to_string();

        if !stable {
            version = format!("{}-nightly", version);
        }

        let release_tag = if stable {
            // We already checked above if the env var contains "refs/tags/v".
            // So this is safe to unwrap.
            sh.var("GITHUB_REF")
                .unwrap_or_default()
                .replace("refs/tags/", "")
                .to_string()
        } else {
            "nightly".to_string()
        };

        if stable && !release_tag.contains(&version) {
            // bail early if the tag doesn't match the version
            anyhow::bail!(
                "Tag {} doesn't match version {}. Did you forget to update Cargo.toml?",
                release_tag,
                version
            );
        }

        build_server(sh, &version, &target)?;
        build_client(sh, &version, &release_tag, &target)?;
        Ok(())
    }
}

fn build_client(sh: &Shell, version: &str, release_tag: &str, target: &Target) -> anyhow::Result<()> {
    let bundle_path = Path::new("server");
    sh.create_dir(bundle_path)?;
    sh.copy_file(&target.server_path, bundle_path)?;
    if let Some(symbols_path) = &target.symbols_path {
        sh.copy_file(symbols_path, bundle_path)?;
    }

    let mut patch = Patch::new(sh, "./package.json")?;
    patch
        .replace(r#""version": "0.0.0""#, &format!(r#""version": "{version}""#))
        .replace(r#""releaseTag": null"#, &format!(r#""releaseTag": "{release_tag}""#))
        .replace(r#""enabledApiProposals": [],"#, r#""#);
    patch.commit(sh)?;

    Ok(())
}

fn build_server(sh: &Shell, release: &str, target: &Target) -> anyhow::Result<()> {
    let _e = sh.push_env("CFG_RELEASE", release);
    let _e = sh.push_env("CARGO_PROFILE_RELEASE_LTO", "thin");

    // Uncomment to enable debug info for releases. Note that:
    //   * debug info is split on windows and macs, so it does nothing for those platforms,
    //   * on Linux, this blows up the binary size from 8MB to 43MB, which is unreasonable.
    // let _e = sh.push_env("CARGO_PROFILE_RELEASE_DEBUG", "1");

    if target.name.contains("-linux-") {
        env::set_var("CC", "clang");
    }

    let target_name = &target.name;
    cmd!(
        sh,
        "cargo build --manifest-path ./Cargo.toml --bin kcl-language-server --target {target_name} --release"
    )
    .run()?;

    let dst = Path::new("build").join(&target.artifact_name);
    gzip(&target.server_path, &dst.with_extension("gz"))?;
    if target_name.contains("-windows-") {
        zip(
            &target.server_path,
            target.symbols_path.as_ref(),
            &dst.with_extension("zip"),
        )?;
    }

    Ok(())
}

fn gzip(src_path: &Path, dest_path: &Path) -> anyhow::Result<()> {
    let mut encoder = GzEncoder::new(File::create(dest_path)?, Compression::best());
    let mut input = io::BufReader::new(File::open(src_path)?);
    io::copy(&mut input, &mut encoder)?;
    encoder.finish()?;
    Ok(())
}

fn zip(src_path: &Path, symbols_path: Option<&PathBuf>, dest_path: &Path) -> anyhow::Result<()> {
    let file = File::create(dest_path)?;
    let mut writer = ZipWriter::new(BufWriter::new(file));
    let file_options = zip::write::SimpleFileOptions::default()
        .last_modified_time(convert_date_time(OffsetDateTime::from(
            std::fs::metadata(src_path)?.modified()?,
        ))?)
        .unix_permissions(0o755)
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(9));
    writer.start_file(src_path.file_name().unwrap().to_str().unwrap(), file_options)?;
    let mut input = io::BufReader::new(File::open(src_path)?);
    io::copy(&mut input, &mut writer)?;
    if let Some(symbols_path) = symbols_path {
        writer.start_file(symbols_path.file_name().unwrap().to_str().unwrap(), file_options)?;
        let mut input = io::BufReader::new(File::open(symbols_path)?);
        io::copy(&mut input, &mut writer)?;
    }
    writer.finish()?;
    Ok(())
}

struct Target {
    name: String,
    server_path: PathBuf,
    symbols_path: Option<PathBuf>,
    artifact_name: String,
}

impl Target {
    fn get(project_root: &Path) -> Self {
        let name = match env::var("RA_TARGET") {
            Ok(target) => target,
            _ => {
                if cfg!(target_os = "linux") {
                    "x86_64-unknown-linux-gnu".to_string()
                } else if cfg!(target_os = "windows") {
                    "x86_64-pc-windows-msvc".to_string()
                } else if cfg!(target_os = "macos") {
                    "aarch64-apple-darwin".to_string()
                } else {
                    panic!("Unsupported OS, maybe try setting RA_TARGET")
                }
            }
        };
        let out_path = project_root.join("target").join(&name).join("release");
        let (exe_suffix, symbols_path) = if name.contains("-windows-") {
            (".exe".into(), Some(out_path.join("kcl_language_server.pdb")))
        } else {
            (String::new(), None)
        };
        let server_path = out_path.join(format!("kcl-language-server{exe_suffix}"));
        let artifact_name = format!("kcl-language-server-{name}{exe_suffix}");
        Self {
            name,
            server_path,
            symbols_path,
            artifact_name,
        }
    }
}

struct Patch {
    path: PathBuf,
    original_contents: String,
    contents: String,
}

impl Patch {
    fn new(sh: &Shell, path: impl Into<PathBuf>) -> anyhow::Result<Patch> {
        let path = path.into();
        let contents = sh.read_file(&path)?;
        Ok(Patch {
            path,
            original_contents: contents.clone(),
            contents,
        })
    }

    fn replace(&mut self, from: &str, to: &str) -> &mut Patch {
        assert!(self.contents.contains(from));
        self.contents = self.contents.replace(from, to);
        self
    }

    fn commit(&self, sh: &Shell) -> anyhow::Result<()> {
        sh.write_file(&self.path, &self.contents)?;
        Ok(())
    }
}

impl Drop for Patch {
    fn drop(&mut self) {
        // FIXME: find a way to bring this back
        let _ = &self.original_contents;
        // write_file(&self.path, &self.original_contents).unwrap();
    }
}

fn convert_date_time(offset_dt: OffsetDateTime) -> anyhow::Result<zip::DateTime> {
    // Convert to MS-DOS date time format that the zip crate expects
    zip::DateTime::from_date_and_time(
        (offset_dt.year() as u16).try_into().unwrap_or(1980),
        offset_dt.month() as u8,
        offset_dt.day() as u8,
        offset_dt.hour() as u8,
        offset_dt.minute() as u8,
        offset_dt.second() as u8,
    )
    .map_err(|err| anyhow::anyhow!("Failed to convert date time to MS-DOS format: {}", err))
}
