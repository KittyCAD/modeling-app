use std::borrow::Cow;
use std::ffi::OsStr;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::process::ExitCode;
use std::process::ExitStatus;
use std::process::Output;
use std::process::Stdio;

use anyhow::Context;
use anyhow::Result;
use anyhow::bail;
use clap::Parser;
use ignore::gitignore::Gitignore;
use ignore::gitignore::GitignoreBuilder;
use serde::Serialize;
use tempfile::NamedTempFile;
use walkdir::WalkDir;

mod reproduce;

/// Check an external KCL parser against a membership corpus.
#[derive(Parser)]
#[command(version)]
struct Args {
    /// Root directory of the membership corpus.
    #[arg(long, value_name = "ROOT")]
    corpus: PathBuf,
    /// File containing gitignore-style patterns relative to the corpus root.
    #[arg(long, value_name = "FILE")]
    skip_file: Option<PathBuf>,
    /// Write the corpus-relative paths of failed fixtures to this file.
    #[arg(long, value_name = "FILE")]
    failed_files: Option<PathBuf>,
    /// Write the result report as JSON.
    #[arg(long)]
    json: bool,
    /// Parser executable followed by its arguments.
    #[arg(last = true, required = true, num_args = 1.., value_name = "PARSER")]
    parser: Vec<OsString>,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Verdict {
    Accept,
    Reject,
}

impl Verdict {
    fn as_str(self) -> &'static str {
        match self {
            Self::Accept => "accept",
            Self::Reject => "reject",
        }
    }
}

struct Fixture {
    path: PathBuf,
    expected: Verdict,
}

enum Outcome {
    Success(Verdict),
    Fail(Verdict),
    Error(anyhow::Error),
    Skipped,
}

#[derive(Default, Serialize)]
struct Summary {
    success: usize,
    fail: usize,
    #[serde(skip)]
    errors: usize,
    skipped: usize,
}

#[derive(Serialize)]
struct JsonReport<'a> {
    summary: &'a Summary,
    results: Vec<JsonResult<'a>>,
}

#[derive(Serialize)]
struct JsonResult<'a> {
    path: Cow<'a, str>,
    expected: Verdict,
    actual: Option<Verdict>,
    outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stderr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reproduce: Option<String>,
}

fn main() -> ExitCode {
    match run(Args::parse()) {
        Ok(status) => status,
        Err(error) => {
            let _ = writeln!(io::stderr(), "{error:#}");
            ExitCode::from(2)
        }
    }
}

fn run(args: Args) -> Result<ExitCode> {
    let [executable, parser_args @ ..] = args.parser.as_slice() else {
        bail!("missing parser executable");
    };
    let mut parser = Command::new(executable);
    parser.args(parser_args);

    let fixtures = discover_fixtures(&args.corpus)?;
    let skip = load_skip_file(args.skip_file.as_deref())?;
    let mut stdout = io::stdout().lock();
    let mut stderr = io::stderr().lock();
    let mut summary = Summary::default();
    let mut failed_paths = Vec::new();
    let mut json_results = Vec::new();
    let parser_working_directory = args
        .json
        .then(std::env::current_dir)
        .transpose()
        .context("could not get the parser working directory")?;

    if !args.json {
        writeln!(stdout, "outcome\texpected\tactual\tpath")?;
    }
    for fixture in &fixtures {
        let input = args.corpus.join(&fixture.path);
        let mut diagnostics = Vec::new();
        let outcome = if is_skipped(&skip, &fixture.path) {
            Outcome::Skipped
        } else {
            let result = run_parser(&mut parser, &input).and_then(|output| {
                diagnostics = output.stderr;
                read_verdict(output.status, &output.stdout)
            });
            match result {
                Ok(actual) if actual == fixture.expected => Outcome::Success(actual),
                Ok(actual) => Outcome::Fail(actual),
                Err(error) => Outcome::Error(error),
            }
        };

        let (label, actual, error) = match outcome {
            Outcome::Success(actual) => {
                summary.success += 1;
                ("success", Some(actual), None)
            }
            Outcome::Fail(actual) => ("fail", Some(actual), None),
            Outcome::Error(error) => {
                summary.errors += 1;
                ("fail", None, Some(error))
            }
            Outcome::Skipped => {
                summary.skipped += 1;
                ("skipped", None, None)
            }
        };

        let failed = label == "fail";
        if failed {
            summary.fail += 1;
            failed_paths.push(fixture.path.as_path());
        }
        if let Some(directory) = &parser_working_directory {
            json_results.push(JsonResult {
                path: fixture.path.to_string_lossy(),
                expected: fixture.expected,
                actual,
                outcome: label,
                error: error.map(|error| format!("{error:#}")),
                stderr: (!diagnostics.is_empty()).then(|| String::from_utf8_lossy(&diagnostics).into_owned()),
                reproduce: failed.then(|| reproduce::command(directory, &args.parser, &input)),
            });
            continue;
        }

        if let Some(error) = error {
            writeln!(stderr, "{}: {error:#}", fixture.path.display())?;
        }
        let actual = actual.map_or("-", Verdict::as_str);
        writeln!(
            stdout,
            "{label}\t{}\t{actual}\t{}",
            fixture.expected.as_str(),
            fixture.path.display()
        )?;
        if !diagnostics.is_empty() {
            writeln!(stderr, "{}:", fixture.path.display())?;
            stderr.write_all(&diagnostics)?;
            if !diagnostics.ends_with(b"\n") {
                writeln!(stderr)?;
            }
        }
    }

    if args.json {
        serde_json::to_writer_pretty(
            &mut stdout,
            &JsonReport {
                summary: &summary,
                results: json_results,
            },
        )
        .context("could not write JSON report")?;
        writeln!(stdout)?;
    } else {
        writeln!(
            stdout,
            "Summary: {} success, {} fail ({} tool errors), {} skipped",
            summary.success, summary.fail, summary.errors, summary.skipped,
        )?;
    }
    stdout.flush()?;

    if let Some(path) = args.failed_files.as_deref() {
        write_failed_files(path, &failed_paths)?;
    }

    if summary.errors > 0 {
        return Ok(ExitCode::from(2));
    }
    if summary.fail > 0 {
        return Ok(ExitCode::from(1));
    }
    Ok(ExitCode::SUCCESS)
}

fn discover_fixtures(root: &Path) -> Result<Vec<Fixture>> {
    let mut fixtures = Vec::new();
    for (directory, expected) in [("success", Verdict::Accept), ("failures", Verdict::Reject)] {
        let directory = root.join(directory);
        for entry in WalkDir::new(&directory) {
            let entry = entry.with_context(|| format!("could not walk {}", directory.display()))?;
            if entry.depth() == 0 && !entry.file_type().is_dir() {
                bail!("{} is not a directory", directory.display());
            }
            if entry.file_type().is_file() && entry.path().extension() == Some(OsStr::new("kcl")) {
                fixtures.push(Fixture {
                    path: entry.path().strip_prefix(root)?.to_owned(),
                    expected,
                });
            }
        }
    }
    fixtures.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(fixtures)
}

fn load_skip_file(path: Option<&Path>) -> Result<Gitignore> {
    let Some(path) = path else {
        return Ok(Gitignore::empty());
    };
    let mut builder = GitignoreBuilder::new(".");
    if let Some(error) = builder.add(path) {
        return Err(error).context("could not load skip file");
    }
    builder.build().context("could not build skip matcher")
}

fn is_skipped(matcher: &Gitignore, path: &Path) -> bool {
    if matcher.matched(path, false).is_ignore() {
        return true;
    }

    // Git ignores every descendant of an excluded directory.
    path.ancestors()
        .skip(1)
        .take_while(|parent| !parent.as_os_str().is_empty())
        .any(|parent| matcher.matched(parent, true).is_ignore())
}

fn run_parser(parser: &mut Command, fixture: &Path) -> Result<Output> {
    let input = fs::File::open(fixture).with_context(|| format!("could not open {}", fixture.display()))?;
    parser
        .stdin(Stdio::from(input))
        .output()
        .context("could not run parser")
}

fn read_verdict(status: ExitStatus, stdout: &[u8]) -> Result<Verdict> {
    if !status.success() {
        bail!("parser returned {status}");
    }
    match stdout {
        b"accept" | b"accept\n" | b"accept\r\n" => Ok(Verdict::Accept),
        b"reject" | b"reject\n" | b"reject\r\n" => Ok(Verdict::Reject),
        _ => bail!("parser stdout must contain one `accept` or `reject` verdict"),
    }
}

fn write_failed_files(output: &Path, paths: &[&Path]) -> Result<()> {
    let mut contents = Vec::new();
    for path in paths {
        let bytes = path.as_os_str().as_encoded_bytes();
        if bytes.contains(&b'\n') || bytes.contains(&b'\r') {
            bail!("cannot write a failed path containing a line break: {path:?}");
        }
        contents.extend_from_slice(bytes);
        contents.push(b'\n');
    }
    let parent = output
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut temporary =
        NamedTempFile::new_in(parent).with_context(|| format!("could not write {}", output.display()))?;
    temporary
        .write_all(&contents)
        .with_context(|| format!("could not write {}", output.display()))?;
    temporary
        .persist(output)
        .with_context(|| format!("could not replace {}", output.display()))?;
    Ok(())
}
