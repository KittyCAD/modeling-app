//! Experimental bridge for generating sketch suggestion features from native KCL.
//! Usage: cargo run -p kcl-lib --example sketch_constraint_capture -- input.kcl [previews.json]

use std::env;
use std::fs;
use std::sync::Arc;

use kcl_api::Constraint;
use kcl_api::ObjectId;
use kcl_lib::ExecutorContext;
use kcl_lib::Program;
use kcl_lib::engine_connection::EngineManager;
use kcl_lib::front::FrontendState;
use kcl_lib::front::SetProgramOutcome;
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct PreviewRequest {
    sketch_id: usize,
    constraint: Constraint,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = env::args().skip(1);
    let input = args.next().ok_or_else(|| anyhow::anyhow!("missing KCL input"))?;
    let previews = args.next();
    let source = fs::read_to_string(input)?;
    let program = Program::parse_no_errs(&source)?;
    let ctx = ExecutorContext::new_with_engine(Arc::new(EngineManager::new_mock()), Default::default());
    let mut frontend = FrontendState::new();
    match frontend.hack_set_program(&ctx, program).await? {
        SetProgramOutcome::Success { .. } => {}
        SetProgramOutcome::ExecFailure { error } => anyhow::bail!("KCL execution failed: {error:?}"),
    }
    let graph = frontend.scene_graph().clone();

    if let Some(path) = previews {
        let requests: Vec<PreviewRequest> = serde_json::from_slice(&fs::read(path)?)?;
        let mut results = Vec::with_capacity(requests.len());
        for request in requests {
            let mock = ExecutorContext::new_mock(None).await;
            let mut copy = frontend.clone();
            let result = copy
                .preview_constraint(&mock, graph.version, ObjectId(request.sketch_id), request.constraint)
                .await;
            results.push(match result {
                Ok(delta) => json!({"ok": true, "delta": delta}),
                Err(error) => json!({"ok": false, "error": error.error.message()}),
            });
            mock.close().await;
        }
        println!(
            "{}",
            serde_json::to_string(&json!({"graph": graph, "previews": results}))?
        );
    } else {
        println!("{}", serde_json::to_string(&json!({"graph": graph}))?);
    }
    ctx.close().await;
    Ok(())
}
