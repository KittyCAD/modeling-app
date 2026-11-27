use std::fs;
use std::io;
use std::io::Read;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
use kcl_lib::KclError;
use kcl_lib::Program;
use kcl_lib::Report;
use miette::NarratableReportHandler;

/// Parse a KCL program.
#[derive(Parser)]
#[command(name = "kcl-parse", version)]
struct Args {
    /// KCL source file. Use '-' to read from standard input.
    #[arg(value_name = "FILE", default_value = "-")]
    file: PathBuf,
}

fn main() -> ExitCode {
    let args = Args::parse();
    match parse_file(&args.file) {
        Ok(status) => status,
        Err(error) => {
            eprintln!("{}: {error}", args.file.display());
            ExitCode::from(2)
        }
    }
}

fn parse_file(file: &Path) -> io::Result<ExitCode> {
    let mut source = String::new();
    let filename = if file == Path::new("-") {
        io::stdin().read_to_string(&mut source)?;
        "<stdin>".to_owned()
    } else {
        source = fs::read_to_string(file)?;
        file.display().to_string()
    };

    let verdict = match Program::parse_no_errs(&source) {
        Ok(_) => "accept",
        Err(error) => {
            let internal_error = matches!(error, KclError::Internal { .. });
            let report = Report {
                error,
                kcl_source: source,
                filename: filename.clone(),
                label: filename,
            };
            let mut diagnostic = String::new();
            NarratableReportHandler::new()
                .render_report(&mut diagnostic, &report)
                .map_err(io::Error::other)?;
            write!(io::stderr().lock(), "{diagnostic}")?;
            if internal_error {
                return Ok(ExitCode::from(2));
            }
            "reject"
        }
    };
    writeln!(io::stdout().lock(), "{verdict}")?;
    Ok(ExitCode::SUCCESS)
}
