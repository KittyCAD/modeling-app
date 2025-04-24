use std::{env, fs::File, io::Read};

use kcl_lib::{ExecState, ExecutorContext, ExecutorSettings, Program};

// An extremely simple script, definitely not to be released or used for anything important, but
// sometimes useful for debugging. It reads in a file specified on the command line and runs it.
// It will report any errors in a developer-oriented way and discard the result.
//
// e.g., `cargo run -- foo.kcl`
#[tokio::main]
async fn main() {
    let mut args = env::args();
    args.next();
    let mut filename = args.next().unwrap_or_else(|| "main.kcl".to_owned());
    if !filename.ends_with(".kcl") {
        if !filename.ends_with('/') && !filename.ends_with('\\') {
            filename += "/";
        }
        filename += "main.kcl";
    }

    let mut f = File::open(&filename).unwrap();
    let mut text = String::new();
    f.read_to_string(&mut text).unwrap();

    let (program, errs) = Program::parse(&text).unwrap();
    if !errs.is_empty() {
        for e in errs {
            eprintln!("{e:#?}");
        }
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
    ctx.run(&program, &mut exec_state).await.map_err(|e| e.error).unwrap();
}
