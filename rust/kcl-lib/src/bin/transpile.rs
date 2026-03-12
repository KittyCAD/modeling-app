//! A binary to transpile KCL files with old sketch syntax (startProfile in pipe
//! expressions) to the new sketch block syntax. This is only a temporary dev
//! tool before we integrate it into the app.
use std::{env, fs::File, io::Read, path::PathBuf, process::ExitCode};

use kcl_lib::{
    ExecOutcome, ExecutorContext, ExecutorSettings, KclError, KclErrorWithOutputs, Program, TypedPath,
    exec::{RetryConfig, execute_with_retries},
    transpile_all_old_sketches_to_new,
};

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
    let settings = ExecutorSettings {
        project_directory,
        ..Default::default()
    };

    let result = async {
        // Execute.
        let exec_outcome = execute_with_retries(&RetryConfig::default(), || execute(program.clone(), settings.clone()))
            .await
            .map_err(|e| e.error)?;
        // Transpile.
        transpile_all_old_sketches_to_new(&exec_outcome, &mut program)
    }
    .await;

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
