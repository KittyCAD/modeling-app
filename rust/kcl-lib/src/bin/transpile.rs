//! A binary to transpile KCL files with old sketch syntax (startProfile in pipe
//! expressions) to the new sketch block syntax. This is only a temporary dev
//! tool before we integrate it into the app.
use std::{env, fs::File, io::Read, path::PathBuf, process::ExitCode};

use kcl_lib::{ExecutorContext, ExecutorSettings, Program, TypedPath, transpile_all_old_sketches_to_new};

#[tokio::main]
async fn main() -> Result<ExitCode, std::io::Error> {
    let mut args = env::args();
    args.next();
    let Some(filename) = args.next() else {
        eprintln!("Usage: transpile <filename.kcl>");
        return Ok(ExitCode::FAILURE);
    };
    let mut path = PathBuf::from(&filename);
    if let Some(ext) = path.extension() {
        if !ext.eq_ignore_ascii_case("kcl") {
            eprintln!("Error: file must have .kcl extension");
            return Ok(ExitCode::FAILURE);
        }
    } else {
        // Given a directory. Use main.kcl in that directory.
        path = path.join("main.kcl");
    }

    // Read the file.
    let mut f = File::open(&path)?;
    let mut text = String::new();
    f.read_to_string(&mut text)?;

    // Parse.
    let (program, errs) = Program::parse(&text).unwrap();
    if !errs.is_empty() {
        for e in errs {
            eprintln!("{e:#?}");
        }
        return Ok(ExitCode::FAILURE);
    }
    let mut program = program.unwrap();

    let project_directory_string = path.parent().map(|p| p.to_string_lossy());
    let project_directory = project_directory_string.map(|p| TypedPath::from(p.as_ref()));

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
    let result = async {
        // Execute.
        let exec_outcome = ctx.run_with_caching(program.clone()).await.map_err(|e| e.error)?;
        // Transpile.
        transpile_all_old_sketches_to_new(&exec_outcome, &mut program)
    }
    .await;
    // Always close the context.
    ctx.close().await;

    match result {
        Ok(_) => {}
        Err(err) => {
            eprintln!("Execution error: {err:#?}");
            return Ok(ExitCode::FAILURE);
        }
    }

    // Format the new source.
    let new_source = program.recast();
    // Output it. In the future, we should support imported files and write them
    // all to an output directory.
    println!("{}", new_source);

    Ok(ExitCode::SUCCESS)
}
