//! A binary to transpile KCL files with old sketch syntax (startProfile in pipe
//! expressions) to the new sketch block syntax. This is only a temporary dev
//! tool before we integrate it into the app.
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::Args;
use clap::Parser;
use clap::Subcommand;
use ignore::gitignore::Gitignore;
use ignore::gitignore::GitignoreBuilder;
use kcl_lib::ExecOutcome;
use kcl_lib::ExecutorContext;
use kcl_lib::ExecutorSettings;
use kcl_lib::KclError;
use kcl_lib::KclErrorWithOutputs;
use kcl_lib::Program;
use kcl_lib::TypedPath;
use kcl_lib::exec::RetryConfig;
use kcl_lib::exec::execute_with_retries;
use kcl_lib::pre_execute_transpile;
#[cfg(not(target_arch = "wasm32"))]
use kcl_lib::test_server;
use kcl_lib::tooling::render_artifacts::RenderArtifactKind;
use kcl_lib::tooling::render_artifacts::render_artifact_path;
use kcl_lib::transpile_all_old_sketches_to_new;
use walkdir::DirEntry;
use walkdir::WalkDir;

#[derive(Parser, Debug)]
#[command(
    version = clap::crate_version!(),
    author = clap::crate_authors!("\n"),
    arg_required_else_help = true,
    subcommand_required = true
)]
struct Cli {
    /// CLI subcommands.
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Transpile input KCL to Sketch V2.
    Convert(OptionalOutputCommandArgs),
    /// Transpile and execute Sketch V2 output.
    Run(RequiredOutputCommandArgs),
    /// Transpile, execute, and render Sketch V2 output.
    Render(RequiredOutputCommandArgs),
    /// Transpile, render, and compare Sketch V1 and V2 outputs.
    Compare(RequiredOutputCommandArgs),
}

#[derive(Args, Debug)]
struct CommonArgs {
    /// Input KCL file or directory.
    #[arg(value_parser = parse_input_path)]
    input: PathBuf,

    /// Emit machine-readable output.
    #[arg(short = 'j', long)]
    json: bool,

    /// Reduce human-oriented output.
    #[arg(short, long)]
    quiet: bool,
}

#[derive(Args, Debug)]
struct BatchArgs {
    /// Recursively process .kcl files under the input path.
    #[arg(short, long)]
    recursive: bool,

    /// .gitignore-like file of paths to skip.
    #[arg(short, long, requires = "recursive")]
    ignore_file: Option<PathBuf>,

    /// Continue processing after errors in batch mode.
    #[arg(short, long, requires = "recursive")]
    keep_going: bool,

    /// Write a text report to this file.
    #[arg(long, requires = "recursive")]
    report_file: Option<PathBuf>,
}

#[derive(Args, Debug)]
struct OptionalOutputCommandArgs {
    #[command(flatten)]
    common: CommonArgs,

    #[command(flatten)]
    batch: BatchArgs,

    /// Root output directory for generated files and artifacts.
    #[arg(short, long, requires = "recursive", required_if_eq("recursive", "true"))]
    out_dir: Option<PathBuf>,
}

#[derive(Args, Debug)]
struct RequiredOutputCommandArgs {
    #[command(flatten)]
    common: CommonArgs,

    #[command(flatten)]
    batch: BatchArgs,

    /// Root output directory for generated files and artifacts.
    #[arg(short, long)]
    out_dir: PathBuf,
}

// Better accessors for nested CLI Arg structs
impl OptionalOutputCommandArgs {
    fn input(&self) -> &Path {
        &self.common.input
    }

    fn json(&self) -> bool {
        self.common.json
    }

    fn quiet(&self) -> bool {
        self.common.quiet
    }

    fn recursive(&self) -> bool {
        self.batch.recursive
    }

    fn ignore_file(&self) -> Option<&Path> {
        self.batch.ignore_file.as_deref()
    }

    fn keep_going(&self) -> bool {
        self.batch.keep_going
    }

    fn report_file(&self) -> Option<&Path> {
        self.batch.report_file.as_deref()
    }
}

// Better accessors for nested CLI Arg structs
impl RequiredOutputCommandArgs {
    fn input(&self) -> &Path {
        &self.common.input
    }

    fn json(&self) -> bool {
        self.common.json
    }

    fn quiet(&self) -> bool {
        self.common.quiet
    }

    fn recursive(&self) -> bool {
        self.batch.recursive
    }

    fn ignore_file(&self) -> Option<&Path> {
        self.batch.ignore_file.as_deref()
    }

    fn keep_going(&self) -> bool {
        self.batch.keep_going
    }

    fn report_file(&self) -> Option<&Path> {
        self.batch.report_file.as_deref()
    }

    fn out_dir(&self) -> &Path {
        &self.out_dir
    }
}

fn not_implemented() -> ExitCode {
    eprintln!("Not implemented yet!");
    ExitCode::FAILURE
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();

    let result = match cli.command {
        Command::Convert(args) => convert(args).await,
        Command::Run(args) => run(args).await,
        Command::Render(args) => render(args).await,
        Command::Compare(_) => Ok(not_implemented()),
    };

    match result {
        Ok(code) => code,
        Err(err) => {
            eprintln!("{err}");
            ExitCode::FAILURE
        }
    }
}

async fn convert(args: OptionalOutputCommandArgs) -> Result<ExitCode, std::io::Error> {
    if args.json() {
        return Ok(not_implemented());
    }

    if args.recursive() {
        convert_recursive(args).await
    } else {
        convert_single(args).await
    }
}

async fn convert_single(args: OptionalOutputCommandArgs) -> Result<ExitCode, std::io::Error> {
    let input = normalize_input_path(args.input().to_path_buf())?;
    let output_file_name = input
        .file_name()
        .ok_or_else(|| std::io::Error::other(format!("Input path `{}` has no filename", input.display())))?;

    if let Some(out_dir) = args.out_dir {
        let out_path = out_dir.join(output_file_name);
        transpile_to_output(&input, &out_path, true)
            .await
            .map_err(std::io::Error::other)?;
    } else {
        let new_source = transpile_source_file(&input, true)
            .await
            .map_err(std::io::Error::other)?;
        println!("{new_source}");
    }

    Ok(ExitCode::SUCCESS)
}

async fn convert_recursive(args: OptionalOutputCommandArgs) -> Result<ExitCode, std::io::Error> {
    let Some(ref out_dir) = args.out_dir else {
        unreachable!("clap enforces --out-dir with --recursive")
    };

    let root = args.input();
    let mut report = ConvertReport::default();

    for entry in collect_recursive_entries(root, args.ignore_file())? {
        let file = entry.source_path;
        let rel_path = entry.relative_path;
        report.processed += 1;

        match transpile_to_output(&file, &out_dir.join(&rel_path), !args.keep_going()).await {
            Ok(_) => {
                report.succeeded += 1;
                if !args.quiet() {
                    eprintln!("Converted: {}", rel_path.display());
                }
            }
            Err(err) => {
                report.failures.push(ConvertFailure {
                    path: rel_path.clone(),
                    error: err.clone(),
                });
                if !args.quiet() {
                    eprintln!("Convert failed: {}: {}", rel_path.display(), err);
                }
                if !args.keep_going() {
                    break;
                }
            }
        }
    }

    let report_text = render_convert_report(&report);
    write_report(&report_text, args.quiet(), args.report_file())?;

    let exit_code = if report.failures.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    };
    Ok(exit_code)
}

async fn run(args: RequiredOutputCommandArgs) -> Result<ExitCode, std::io::Error> {
    if args.json() {
        return Ok(not_implemented());
    }

    if args.recursive() {
        return run_recursive(args).await;
    }

    run_single(args).await
}

async fn run_single(args: RequiredOutputCommandArgs) -> Result<ExitCode, std::io::Error> {
    let input = normalize_input_path(args.input().to_path_buf())?;
    fs::create_dir_all(args.out_dir())?;
    let output_kcl_path = args.out_dir().join(
        input
            .file_name()
            .ok_or_else(|| std::io::Error::other(format!("Input path `{}` has no filename", input.display())))?,
    );

    let transpiled = match transpile_to_output(&input, &output_kcl_path, true).await {
        Ok(source) => source,
        Err(err) => {
            fs::write(args.out_dir().join("run-log.txt"), format!("convert_failed\n{err}\n"))?;
            return Ok(ExitCode::FAILURE);
        }
    };

    match execute_source_with_input_settings(&transpiled, &input).await {
        Ok(()) => {
            fs::write(args.out_dir().join("run-log.txt"), "success\n")?;
            Ok(ExitCode::SUCCESS)
        }
        Err(err) => {
            fs::write(args.out_dir().join("run-log.txt"), format!("run_failed\n{err}\n"))?;
            Ok(ExitCode::FAILURE)
        }
    }
}

async fn run_recursive(args: RequiredOutputCommandArgs) -> Result<ExitCode, std::io::Error> {
    let root = args.input();
    let mut report = RunReport::default();

    for entry in collect_recursive_entries(root, args.ignore_file())? {
        let file = entry.source_path;
        let rel_path = entry.relative_path;
        report.processed += 1;

        let out_kcl_path = args.out_dir().join(&rel_path);

        let log_path = args
            .out_dir()
            .join(rel_path.parent().unwrap_or_else(|| Path::new("")))
            .join(run_log_file_name(&file)?);

        let transpiled = match transpile_to_output(&file, &out_kcl_path, !args.keep_going()).await {
            Ok(source) => source,
            Err(err) => {
                if let Some(parent) = log_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&log_path, format!("convert_failed\n{err}\n"))?;

                report.convert_failures.push(RunFailure {
                    path: rel_path.clone(),
                    error: err.clone(),
                });
                if !args.quiet() {
                    eprintln!("Convert failed: {}: {}", rel_path.display(), err);
                }
                if !args.keep_going() {
                    break;
                }
                continue;
            }
        };

        match execute_source_with_input_settings(&transpiled, &file).await {
            Ok(()) => {
                fs::write(&log_path, "success\n")?;
                report.succeeded += 1;
                if !args.quiet() {
                    eprintln!("Ran: {}", rel_path.display());
                }
            }
            Err(err) => {
                fs::write(&log_path, format!("run_failed\n{err}\n"))?;
                report.run_failures.push(RunFailure {
                    path: rel_path.clone(),
                    error: err.clone(),
                });
                if !args.quiet() {
                    eprintln!("Run failed: {}: {}", rel_path.display(), err);
                }
                if !args.keep_going() {
                    break;
                }
            }
        }
    }

    let report_text = render_run_report(&report);
    write_report(&report_text, args.quiet(), args.report_file())?;

    let exit_code = if report.convert_failures.is_empty() && report.run_failures.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    };
    Ok(exit_code)
}

async fn render(args: RequiredOutputCommandArgs) -> Result<ExitCode, std::io::Error> {
    if args.json() {
        return Ok(not_implemented());
    }

    if args.recursive() {
        return render_recursive(args).await;
    }

    render_single(args).await
}

async fn render_single(args: RequiredOutputCommandArgs) -> Result<ExitCode, std::io::Error> {
    let input = normalize_input_path(args.input().to_path_buf())?;
    fs::create_dir_all(args.out_dir())?;
    let output_kcl_path = args.out_dir().join(
        input
            .file_name()
            .ok_or_else(|| std::io::Error::other(format!("Input path `{}` has no filename", input.display())))?,
    );

    let transpiled = match transpile_to_output(&input, &output_kcl_path, true).await {
        Ok(source) => source,
        Err(err) => {
            fs::write(
                args.out_dir().join("render-log.txt"),
                format!("convert_failed\n{err}\n"),
            )?;
            return Ok(ExitCode::FAILURE);
        }
    };

    let rendered = match render_source_with_input_settings(&transpiled, &input).await {
        Ok(image) => image,
        Err(err) => {
            fs::write(args.out_dir().join("render-log.txt"), format!("render_failed\n{err}\n"))?;
            return Ok(ExitCode::FAILURE);
        }
    };

    let image_path = render_artifact_path(args.out_dir(), None, RenderArtifactKind::RenderedModel);
    if let Err(err) = write_png(&image_path, &rendered) {
        fs::write(
            args.out_dir().join("render-log.txt"),
            format!("render_failed\nFailed to write `{}`: {err}\n", image_path.display()),
        )?;
        return Ok(ExitCode::FAILURE);
    }

    fs::write(args.out_dir().join("render-log.txt"), "success\n")?;
    Ok(ExitCode::SUCCESS)
}

async fn render_recursive(args: RequiredOutputCommandArgs) -> Result<ExitCode, std::io::Error> {
    let root = args.input();
    let mut report = RenderReport::default();

    for entry in collect_recursive_entries(root, args.ignore_file())? {
        let file = entry.source_path;
        let rel_path = entry.relative_path;
        report.processed += 1;

        let out_kcl_path = args.out_dir().join(&rel_path);
        let out_dir = args.out_dir().join(rel_path.parent().unwrap_or_else(|| Path::new("")));
        let log_path = out_dir.join(render_log_file_name(&file)?);

        let transpiled = match transpile_to_output(&file, &out_kcl_path, !args.keep_going()).await {
            Ok(source) => source,
            Err(err) => {
                if let Some(parent) = log_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&log_path, format!("convert_failed\n{err}\n"))?;

                report.convert_failures.push(RenderFailure {
                    path: rel_path.clone(),
                    error: err.clone(),
                });
                if !args.quiet() {
                    eprintln!("Convert failed: {}: {}", rel_path.display(), err);
                }
                if !args.keep_going() {
                    break;
                }
                continue;
            }
        };

        let rendered = match render_source_with_input_settings(&transpiled, &file).await {
            Ok(image) => image,
            Err(err) => {
                fs::write(&log_path, format!("render_failed\n{err}\n"))?;
                report.render_failures.push(RenderFailure {
                    path: rel_path.clone(),
                    error: err.clone(),
                });
                if !args.quiet() {
                    eprintln!("Render failed: {}: {}", rel_path.display(), err);
                }
                if !args.keep_going() {
                    break;
                }
                continue;
            }
        };

        let stem = file_stem_string(&file)?;
        let image_path = render_artifact_path(&out_dir, Some(&stem), RenderArtifactKind::RenderedModel);
        match write_png(&image_path, &rendered) {
            Ok(()) => {
                fs::write(&log_path, "success\n")?;
                report.succeeded += 1;
                if !args.quiet() {
                    eprintln!("Rendered: {}", rel_path.display());
                }
            }
            Err(err) => {
                fs::write(
                    &log_path,
                    format!("render_failed\nFailed to write `{}`: {err}\n", image_path.display()),
                )?;
                report.render_failures.push(RenderFailure {
                    path: rel_path.clone(),
                    error: format!("Failed to write `{}`: {err}", image_path.display()),
                });
                if !args.quiet() {
                    eprintln!(
                        "Render failed: {}: Failed to write `{}`: {}",
                        rel_path.display(),
                        image_path.display(),
                        err
                    );
                }
                if !args.keep_going() {
                    break;
                }
            }
        }
    }

    let report_text = render_render_report(&report);
    write_report(&report_text, args.quiet(), args.report_file())?;

    let exit_code = if report.convert_failures.is_empty() && report.render_failures.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    };
    Ok(exit_code)
}

fn normalize_input_path(mut path: PathBuf) -> Result<PathBuf, std::io::Error> {
    // Normalize the path.
    if let Some(ext) = path.extension() {
        if !ext.eq_ignore_ascii_case("kcl") {
            return Err(std::io::Error::other("input file must have .kcl extension"));
        }
    } else {
        // Given a directory. Use main.kcl in that directory.
        path = path.join("main.kcl");
    }

    Ok(path)
}

fn parse_input_path(input: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(input);
    if let Some(ext) = path.extension()
        && !ext.eq_ignore_ascii_case("kcl")
    {
        return Err("input file must have .kcl extension".to_owned());
    }
    Ok(path)
}

fn write_transpiled_output(path: &Path, source: &str) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, source)
}

fn write_report(report_text: &str, quiet: bool, report_file: Option<&Path>) -> Result<(), std::io::Error> {
    if !quiet {
        eprintln!("{report_text}");
    }
    if let Some(report_file) = report_file {
        if let Some(parent) = report_file.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(report_file, report_text)?;
    }
    Ok(())
}

struct RecursiveEntry {
    source_path: PathBuf,
    relative_path: PathBuf,
}

fn collect_recursive_entries(root: &Path, ignore_file: Option<&Path>) -> Result<Vec<RecursiveEntry>, std::io::Error> {
    let matcher = build_ignore_matcher(root, ignore_file)?;
    let files = collect_kcl_files(root, &matcher)?;

    files
        .into_iter()
        .map(|source_path| {
            let relative_path = relative_output_path(root, &source_path)?;
            Ok(RecursiveEntry {
                source_path,
                relative_path,
            })
        })
        .collect()
}

async fn transpile_to_output(input_path: &Path, output_path: &Path, fail_fast: bool) -> Result<String, String> {
    let new_source = transpile_source_file(input_path, fail_fast).await?;
    write_transpiled_output(output_path, &new_source)
        .map_err(|err| format!("Failed to write `{}`: {err}", output_path.display()))?;
    Ok(new_source)
}

async fn transpile_source_file(path: &Path, fail_fast: bool) -> Result<String, String> {
    let text = fs::read_to_string(path).map_err(|err| format!("Failed to read `{}`: {err}", path.display()))?;

    // Parse.
    let (program, errs) =
        Program::parse(&text).map_err(|err| format!("Failed to parse `{}`: {err:#?}", path.display()))?;
    if !errs.is_empty() {
        let parse_errors = errs
            .into_iter()
            .map(|err| format!("{err:#?}"))
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("Parse errors in `{}`:\n{parse_errors}", path.display()));
    }
    let mut program = program.ok_or_else(|| format!("Failed to parse `{}`", path.display()))?;

    let settings = executor_settings_for_input(path);

    let result = async {
        pre_execute_transpile(&mut program)?;
        // Execute.
        let exec_outcome = execute_with_retries(&RetryConfig::default(), || execute(program.clone(), settings.clone()))
            .await
            .map_err(|e| e.error)?;
        // Transpile.
        transpile_all_old_sketches_to_new(&exec_outcome, &mut program, fail_fast)
    }
    .await;

    result.map_err(|err| format!("Execution error for `{}`: {err:#?}", path.display()))?;

    // Format the new source.
    Ok(program.recast())
}

async fn execute_source_with_input_settings(source: &str, input_path: &Path) -> Result<(), String> {
    let program =
        Program::parse_no_errs(source).map_err(|err| format!("Failed to parse transpiled source: {err:#?}"))?;
    let settings = executor_settings_for_input(input_path);
    execute_with_retries(&RetryConfig::default(), || execute(program.clone(), settings.clone()))
        .await
        .map(|_| ())
        .map_err(|err| format!("Execution error for `{}`: {:#?}", input_path.display(), err.error))
}

async fn render_source_with_input_settings(source: &str, input_path: &Path) -> Result<image::DynamicImage, String> {
    test_server::execute_and_snapshot(source, Some(input_path.to_path_buf()))
        .await
        .map_err(|err| format!("Render error for `{}`: {err:#?}", input_path.display()))
}

fn executor_settings_for_input(path: &Path) -> ExecutorSettings {
    let project_directory_string = path.parent().map(|p| p.to_string_lossy());
    let project_directory = project_directory_string.map(|p| TypedPath::from(p.as_ref()));
    ExecutorSettings {
        project_directory,
        ..Default::default()
    }
}

/// Execute and close the connection.
async fn execute(program: Program, settings: ExecutorSettings) -> Result<ExecOutcome, KclErrorWithOutputs> {
    let ctx = ExecutorContext::new_with_client(settings, None, None)
        .await
        .map_err(|err| KclErrorWithOutputs::no_outputs(KclError::internal(format!("{err:?}"))))?;
    let result = ctx.run_with_caching(program).await;
    // Always close the context.
    ctx.close().await;

    result
}

#[derive(Debug, Default)]
struct ConvertReport {
    processed: usize,
    succeeded: usize,
    failures: Vec<ConvertFailure>,
}

#[derive(Debug)]
struct ConvertFailure {
    path: PathBuf,
    error: String,
}

#[derive(Debug, Default)]
struct RunReport {
    processed: usize,
    succeeded: usize,
    convert_failures: Vec<RunFailure>,
    run_failures: Vec<RunFailure>,
}

#[derive(Debug)]
struct RunFailure {
    path: PathBuf,
    error: String,
}

#[derive(Debug, Default)]
struct RenderReport {
    processed: usize,
    succeeded: usize,
    convert_failures: Vec<RenderFailure>,
    render_failures: Vec<RenderFailure>,
}

#[derive(Debug)]
struct RenderFailure {
    path: PathBuf,
    error: String,
}

fn render_convert_report(report: &ConvertReport) -> String {
    let mut output = String::new();
    output.push_str(&format!("Processed: {}\n", report.processed));
    output.push_str(&format!("Succeeded: {}\n", report.succeeded));
    output.push_str(&format!("Convert failed: {}\n", report.failures.len()));

    if !report.failures.is_empty() {
        output.push_str("\nConvert failed\n");
        for failure in &report.failures {
            output.push_str(&format!("- {}: {}\n", failure.path.display(), failure.error));
        }
    }

    output
}

fn render_run_report(report: &RunReport) -> String {
    let mut output = String::new();
    output.push_str(&format!("Processed: {}\n", report.processed));
    output.push_str(&format!("Succeeded: {}\n", report.succeeded));
    output.push_str(&format!("Convert failed: {}\n", report.convert_failures.len()));
    output.push_str(&format!("Run failed: {}\n", report.run_failures.len()));

    if !report.convert_failures.is_empty() {
        output.push_str("\nConvert failed\n");
        for failure in &report.convert_failures {
            output.push_str(&format!("- {}: {}\n", failure.path.display(), failure.error));
        }
    }

    if !report.run_failures.is_empty() {
        output.push_str("\nRun failed\n");
        for failure in &report.run_failures {
            output.push_str(&format!("- {}: {}\n", failure.path.display(), failure.error));
        }
    }

    output
}

fn render_render_report(report: &RenderReport) -> String {
    let mut output = String::new();
    output.push_str(&format!("Processed: {}\n", report.processed));
    output.push_str(&format!("Succeeded: {}\n", report.succeeded));
    output.push_str(&format!("Convert failed: {}\n", report.convert_failures.len()));
    output.push_str(&format!("Render failed: {}\n", report.render_failures.len()));

    if !report.convert_failures.is_empty() {
        output.push_str("\nConvert failed\n");
        for failure in &report.convert_failures {
            output.push_str(&format!("- {}: {}\n", failure.path.display(), failure.error));
        }
    }

    if !report.render_failures.is_empty() {
        output.push_str("\nRender failed\n");
        for failure in &report.render_failures {
            output.push_str(&format!("- {}: {}\n", failure.path.display(), failure.error));
        }
    }

    output
}

fn build_ignore_matcher(root: &Path, ignore_file: Option<&Path>) -> Result<Gitignore, std::io::Error> {
    let mut builder = GitignoreBuilder::new(root);
    if let Some(ignore_file) = ignore_file {
        builder.add(ignore_file);
    }
    builder
        .build()
        .map_err(|err| std::io::Error::other(format!("Failed to build ignore matcher: {err}")))
}

fn collect_kcl_files(root: &Path, matcher: &Gitignore) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut files = Vec::new();
    let walker = WalkDir::new(root)
        .into_iter()
        .filter_entry(|entry| !is_ignored(root, matcher, entry));

    for entry in walker {
        let entry =
            entry.map_err(|err| std::io::Error::other(format!("Failed to walk `{}`: {err}", root.display())))?;
        if entry.file_type().is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("kcl"))
        {
            files.push(entry.into_path());
        }
    }

    files.sort();
    Ok(files)
}

fn is_ignored(root: &Path, matcher: &Gitignore, entry: &DirEntry) -> bool {
    let Ok(relative_path) = entry.path().strip_prefix(root) else {
        return false;
    };

    if relative_path.as_os_str().is_empty() {
        return false;
    }

    matcher
        .matched_path_or_any_parents(relative_path, entry.file_type().is_dir())
        .is_ignore()
}

fn relative_output_path(root: &Path, file: &Path) -> Result<PathBuf, std::io::Error> {
    if root.is_file() {
        return file
            .file_name()
            .map(PathBuf::from)
            .ok_or_else(|| std::io::Error::other(format!("File `{}` has no filename", file.display())));
    }

    file.strip_prefix(root).map(PathBuf::from).map_err(|err| {
        std::io::Error::other(format!(
            "Failed to compute relative path for `{}`: {err}",
            file.display()
        ))
    })
}

fn run_log_file_name(file: &Path) -> Result<PathBuf, std::io::Error> {
    let stem = file_stem_string(file)?;
    Ok(PathBuf::from(format!("{stem}-run-log.txt")))
}

fn render_log_file_name(file: &Path) -> Result<PathBuf, std::io::Error> {
    let stem = file_stem_string(file)?;
    Ok(PathBuf::from(format!("{stem}-render-log.txt")))
}

fn file_stem_string(file: &Path) -> Result<String, std::io::Error> {
    let stem = file
        .file_stem()
        .ok_or_else(|| std::io::Error::other(format!("File `{}` has no stem", file.display())))?;
    Ok(stem.to_string_lossy().into_owned())
}

fn write_png(path: &Path, image: &image::DynamicImage) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    image
        .save_with_format(path, image::ImageFormat::Png)
        .map_err(std::io::Error::other)
}
