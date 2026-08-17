use std::env;
use std::fs::File;
use std::io::Read;
use std::process::ExitCode;

use kcl_lib::ExecState;
use kcl_lib::ExecutorContext;
use kcl_lib::ExecutorSettings;
use kcl_lib::Program;

// An extremely simple script, definitely not to be released or used for anything important, but
// sometimes useful for debugging. It reads in a file specified on the command line and runs it.
// It will report any errors in a developer-oriented way and discard the result.
//
// e.g., `cargo run -- foo.kcl`
#[tokio::main]
async fn main() -> ExitCode {
    let mut args = env::args();
    args.next();
    let mut filename = args.next().unwrap_or_else(|| "main.kcl".to_owned());
    if !filename.ends_with(".kcl") {
        if !filename.ends_with('/') && !filename.ends_with('\\') {
            filename += "/";
        }
        filename += "main.kcl";
    }

    let mut f = match File::open(&filename) {
        Ok(f) => f,
        Err(err) => {
            eprintln!("{err}; {filename}");
            return ExitCode::FAILURE;
        }
    };
    let mut text = String::new();
    f.read_to_string(&mut text).unwrap();

    let (program, errs) = Program::parse(&text).unwrap();
    let mut has_error = false;
    for e in errs {
        if e.is_err() {
            has_error = true;
        }
        eprintln!("{e:#?}");
    }
    let program = program.unwrap();

    let project_directory = filename.rfind('/').map(|i| filename[..i].into());
    let ctx = ExecutorContext::new_with_client(
        ExecutorSettings {
            project_directory,
            ..Default::default()
        },
        None,
        None,
    )
    .await
    .unwrap();
    let mut exec_state = ExecState::new(&ctx);
    let result = ctx.run(&program, &mut exec_state).await;
    for e in exec_state.issues() {
        if e.is_err() {
            has_error = true;
        }
        eprintln!("{e:#?}");
    }
    if let Err(e) = result {
        eprintln!("{:#?}", e.error);
        return ExitCode::FAILURE;
    }
    if has_error {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}
