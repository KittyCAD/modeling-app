//! Executes KCL programs.
//! The server reuses the same engine session for each KCL program it receives.
use std::net::SocketAddr;
use std::time::Duration;

use hyper::header::CONTENT_TYPE;
use hyper::service::{make_service_fn, service_fn};
use hyper::{Body, Error, Response, Server};
use kcl_lib::executor::ExecutorContext;
use kcl_lib::settings::types::UnitLength;
use kcl_lib::test_server::RequestBody;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio::time::sleep;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Parse the CLI arguments.
    let mut args: Vec<_> = std::env::args().collect();
    args.reverse();
    let _process_name = args.pop().unwrap();
    let listen_on = args.pop().unwrap_or_else(|| "0.0.0.0:3333".to_owned()).parse()?;

    // Run the actual server.
    start(listen_on).await
}

pub async fn start(listen_on: SocketAddr) -> anyhow::Result<()> {
    let state = ExecutorContext::new_for_unit_test(UnitLength::Mm).await?;
    // In hyper, a `MakeService` is basically your server.
    // It makes a `Service` for each connection, which manages the connection.
    let make_service = make_service_fn(
        // This closure is run for each connection.
        move |_conn_info| {
            // eprintln!("Connected to a client");
            let state2 = state.clone();
            async move {
                // This is the `Service` which handles the connection.
                // `service_fn` converts a function which returns a Response
                // into a `Service`.
                Ok::<_, Error>(service_fn(move |req| {
                    // eprintln!("Received a request");
                    let state3 = state2.clone();
                    // TODO: Don't let multiple requests through at once.
                    async move {
                        let whole_body = hyper::body::to_bytes(req.into_body()).await?;
                        Ok::<_, Error>(snapshot_endpoint(whole_body.into(), state3).await)
                    }
                }))
            }
        },
    );
    let server = Server::bind(&listen_on).serve(make_service);
    println!("Listening on {listen_on}");
    println!("PID is {}", std::process::id());
    if let Err(e) = server.await {
        eprintln!("Server error: {e}");
        return Err(e.into());
    }
    Ok(())
}

/// Execute a KCL program, then respond with a PNG snapshot.
/// KCL errors (from engine or the executor) respond with HTTP Bad Gateway.
/// Malformed requests are HTTP Bad Request.
/// Successful requests contain a PNG as the body.
async fn snapshot_endpoint(body: Vec<u8>, state: ExecutorContext) -> Response<Body> {
    let body = match serde_json::from_slice::<RequestBody>(&body) {
        Ok(bd) => bd,
        Err(e) => return bad_request(format!("Invalid request JSON: {e}")),
    };
    let RequestBody { kcl_program, test_name } = body;
    let parser = match kcl_lib::token::lexer(&kcl_program) {
        Ok(ts) => kcl_lib::parser::Parser::new(ts),
        Err(e) => return bad_request(format!("tokenization error: {e}")),
    };
    let program = match parser.ast() {
        Ok(pr) => pr,
        Err(e) => return bad_request(format!("Parse error: {e}")),
    };
    eprintln!("Executing {test_name}");
    if let Err(e) = state.reset_scene().await {
        return kcl_err(e);
    }
    // Let users know if the test is taking a long time.
    let (done_tx, done_rx) = oneshot::channel::<()>();
    let timer = time_until(done_rx);
    let snapshot = match state.execute_and_prepare_snapshot(program).await {
        Ok(sn) => sn,
        Err(e) => return kcl_err(e),
    };
    let _ = done_tx.send(());
    timer.abort();
    eprintln!("\tServing response");
    let png_bytes = snapshot.contents.0;
    let mut resp = Response::new(Body::from(png_bytes));
    resp.headers_mut().insert(CONTENT_TYPE, "image/png".parse().unwrap());
    resp
}

fn bad_request(msg: String) -> Response<Body> {
    eprintln!("\tBad request");
    let mut resp = Response::new(Body::from(msg));
    *resp.status_mut() = hyper::StatusCode::BAD_REQUEST;
    resp
}

fn bad_gateway(msg: String) -> Response<Body> {
    eprintln!("\tBad gateway");
    let mut resp = Response::new(Body::from(msg));
    *resp.status_mut() = hyper::StatusCode::BAD_GATEWAY;
    resp
}

fn kcl_err(err: anyhow::Error) -> Response<Body> {
    eprintln!("\tBad KCL");
    bad_gateway(format!("{err}"))
}

fn time_until(done: oneshot::Receiver<()>) -> JoinHandle<()> {
    tokio::task::spawn(async move {
        let period = 10;
        tokio::pin!(done);
        for i in 1..=3 {
            tokio::select! {
                biased;
                // If the test is done, no need for this timer anymore.
                _ = &mut done => return,
                _ = sleep(Duration::from_secs(period)) => {
                    eprintln!("\tTest has taken {}s", period * i);
                },
            };
        }
    })
}
