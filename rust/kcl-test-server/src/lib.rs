//! Executes KCL programs.
//! The server reuses an engine session while requests use the same KCL version.
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::Ordering;
use std::time::Duration;

use http_body_util::BodyExt;
use http_body_util::Full;
use hyper::Error;
use hyper::Response;
use hyper::body::Bytes;
use hyper::body::Incoming;
use hyper::header::CONTENT_TYPE;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use kcl_lib::ExecState;
use kcl_lib::ExecutorContext;
use kcl_lib::Program;
use kcl_lib::test_server::RequestBody;
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio::time::sleep;

#[derive(Debug)]
pub struct ServerArgs {
    /// What port this server should listen on.
    pub listen_on: SocketAddr,
    /// How many connections to establish with the engine.
    pub num_engine_conns: u8,
    /// Where to find the engine.
    /// If none, uses the prod engine.
    /// This is useful for testing a local engine instance.
    /// Overridden by the $ZOO_HOST environment variable.
    pub engine_address: Option<String>,
}

impl ServerArgs {
    pub fn parse(mut pargs: pico_args::Arguments) -> Result<Self, pico_args::Error> {
        let mut args = ServerArgs {
            listen_on: pargs
                .opt_value_from_str("--listen-on")?
                .unwrap_or("0.0.0.0:3333".parse().unwrap()),
            num_engine_conns: pargs.opt_value_from_str("--num-engine-conns")?.unwrap_or(1),
            engine_address: pargs.opt_value_from_str("--engine-address")?,
        };
        if let Ok(addr) = std::env::var("ZOO_HOST") {
            println!("Overriding engine address via $ZOO_HOST");
            args.engine_address = Some(addr);
        }
        println!("Config is {args:?}");
        Ok(args)
    }
}

/// Sent from the server to each worker.
struct WorkerReq {
    /// A KCL program, in UTF-8.
    body: Bytes,
    /// A channel to send the HTTP response back.
    resp: oneshot::Sender<Response<Full<Bytes>>>,
}

/// Each worker has a connection to the engine, and accepts
/// KCL programs. When it receives one (over the mpsc channel)
/// it executes it and returns the result via a oneshot channel.
fn start_worker(i: u8, engine_addr: Option<String>) -> mpsc::Sender<WorkerReq> {
    println!("Starting worker {i}");
    // Make a work queue for this worker.
    let (tx, mut rx) = mpsc::channel(1);
    tokio::task::spawn(async move {
        let mut state: Option<(kcl_lib::KclVersion, ExecutorContext)> = None;
        println!("Worker {i} ready");
        while let Some(req) = rx.recv().await {
            let req: WorkerReq = req;
            let resp = snapshot_endpoint(req.body, &mut state, engine_addr.clone()).await;
            if req.resp.send(resp).is_err() {
                println!("\tWorker {i} exiting");
            }
        }
        println!("\tWorker {i} exiting");
    });
    tx
}

struct ServerState {
    workers: Vec<mpsc::Sender<WorkerReq>>,
    req_num: AtomicUsize,
}

pub async fn start_server(args: ServerArgs) -> anyhow::Result<()> {
    let ServerArgs {
        listen_on,
        num_engine_conns,
        engine_address,
    } = args;
    let workers: Vec<_> = (0..num_engine_conns)
        .map(|i| start_worker(i, engine_address.clone()))
        .collect();
    let state = Arc::new(ServerState {
        workers,
        req_num: 0.into(),
    });
    let listener = TcpListener::bind(listen_on).await?;
    println!("Listening on {listen_on}");
    println!("PID is {}", std::process::id());
    loop {
        let (stream, _) = listener.accept().await?;
        let state = state.clone();
        tokio::spawn(async move {
            let service = service_fn(move |req| handle_request(req, state.clone()));
            if let Err(error) = http1::Builder::new()
                .serve_connection(TokioIo::new(stream), service)
                .await
            {
                eprintln!("Connection error: {error}");
            }
        });
    }
}

async fn handle_request(
    req: hyper::Request<Incoming>,
    state3: Arc<ServerState>,
) -> Result<Response<Full<Bytes>>, Error> {
    let body = req.into_body().collect().await?.to_bytes();

    // Round robin requests between each available worker.
    let req_num = state3.req_num.fetch_add(1, Ordering::Relaxed);
    let worker_id = req_num % state3.workers.len();
    // println!("Sending request {req_num} to worker {worker_id}");
    let worker = state3.workers[worker_id].clone();
    let (tx, rx) = oneshot::channel();
    let req_sent = worker.send(WorkerReq { body, resp: tx }).await;
    req_sent.unwrap();
    let resp = rx.await.unwrap();
    Ok(resp)
}

/// Execute a KCL program, then respond with a PNG snapshot.
/// KCL errors (from engine or the executor) respond with HTTP Bad Gateway.
/// Malformed requests are HTTP Bad Request.
/// Successful requests contain a PNG as the body.
async fn snapshot_endpoint(
    body: Bytes,
    state: &mut Option<(kcl_lib::KclVersion, ExecutorContext)>,
    engine_addr: Option<String>,
) -> Response<Full<Bytes>> {
    let body = match serde_json::from_slice::<RequestBody>(body.as_ref()) {
        Ok(bd) => bd,
        Err(e) => return bad_request(format!("Invalid request JSON: {e}")),
    };
    let RequestBody { kcl_program, test_name } = body;

    let program = match Program::parse_no_errs(&kcl_program) {
        Ok(pr) => pr,
        Err(e) => return bad_request(format!("Parse error: {e}")),
    };

    let version = match program.language_version() {
        Ok(version) => version,
        Err(error) => return bad_request(format!("Invalid KCL settings: {error}")),
    };
    if state
        .as_ref()
        .is_none_or(|(connected_version, _)| *connected_version != version)
    {
        if let Some((_, old)) = state.take() {
            old.close().await;
        }
        let ctx = match ExecutorContext::new_for_unit_test(engine_addr, version).await {
            Ok(ctx) => ctx,
            Err(error) => return kcl_err(error),
        };
        *state = Some((version, ctx));
    }
    let Some((_, ctxt)) = state.as_ref() else {
        return bad_request("Engine connection was not initialized".to_owned());
    };

    eprintln!("Executing {test_name}");
    let mut exec_state = ExecState::new(ctxt);
    // This is a shitty source range, I don't know what else to use for it though.
    // There's no actual KCL associated with this reset_scene call.
    if let Err(e) = ctxt
        .send_clear_scene(Some(version), &mut exec_state, kcl_lib::SourceRange::default())
        .await
    {
        return kcl_err(e);
    }
    // Let users know if the test is taking a long time.
    let (done_tx, done_rx) = oneshot::channel::<()>();
    let timer = time_until(done_rx);
    if let Err(e) = ctxt.run(&program, &mut exec_state).await {
        return kcl_err(e);
    }
    let snapshot = match ctxt.prepare_snapshot().await {
        Ok(s) => s,
        Err(e) => return kcl_err(e),
    };
    let _ = done_tx.send(());
    timer.abort();
    eprintln!("\tServing response");
    let png_bytes = snapshot.contents.0;
    let mut resp = Response::new(Full::new(Bytes::from(png_bytes)));
    resp.headers_mut().insert(CONTENT_TYPE, "image/png".parse().unwrap());
    resp
}

fn bad_request(msg: String) -> Response<Full<Bytes>> {
    eprintln!("\tBad request");
    let mut resp = Response::new(Full::new(Bytes::from(msg)));
    *resp.status_mut() = hyper::StatusCode::BAD_REQUEST;
    resp
}

fn bad_gateway(msg: String) -> Response<Full<Bytes>> {
    eprintln!("\tBad gateway");
    let mut resp = Response::new(Full::new(Bytes::from(msg)));
    *resp.status_mut() = hyper::StatusCode::BAD_GATEWAY;
    resp
}

fn kcl_err(err: impl std::fmt::Display) -> Response<Full<Bytes>> {
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
