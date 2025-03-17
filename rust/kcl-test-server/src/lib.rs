//! Executes KCL programs.
//! The server reuses the same engine session for each KCL program it receives.
use std::{
    net::SocketAddr,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

use hyper::{
    body::Bytes,
    header::CONTENT_TYPE,
    service::{make_service_fn, service_fn},
    Body, Error, Response, Server,
};
use kcl_lib::{test_server::RequestBody, ExecState, ExecutorContext, Program, UnitLength};
use tokio::{
    sync::{mpsc, oneshot},
    task::JoinHandle,
    time::sleep,
};

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
    resp: oneshot::Sender<Response<Body>>,
}

/// Each worker has a connection to the engine, and accepts
/// KCL programs. When it receives one (over the mpsc channel)
/// it executes it and returns the result via a oneshot channel.
fn start_worker(i: u8, engine_addr: Option<String>) -> mpsc::Sender<WorkerReq> {
    println!("Starting worker {i}");
    // Make a work queue for this worker.
    let (tx, mut rx) = mpsc::channel(1);
    tokio::task::spawn(async move {
        let state = ExecutorContext::new_for_unit_test(UnitLength::Mm, engine_addr)
            .await
            .unwrap();
        println!("Worker {i} ready");
        while let Some(req) = rx.recv().await {
            let req: WorkerReq = req;
            let resp = snapshot_endpoint(req.body, state.clone()).await;
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
    // In hyper, a `MakeService` is basically your server.
    // It makes a `Service` for each connection, which manages the connection.
    let make_service = make_service_fn(
        // This closure is run for each connection.
        move |_conn_info| {
            // eprintln!("Connected to a client");
            let state = state.clone();
            async move {
                // This is the `Service` which handles the connection.
                // `service_fn` converts a function which returns a Response
                // into a `Service`.
                Ok::<_, Error>(service_fn(move |req| {
                    // eprintln!("Received a request");
                    let state = state.clone();
                    async move { handle_request(req, state).await }
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

async fn handle_request(req: hyper::Request<Body>, state3: Arc<ServerState>) -> Result<Response<Body>, Error> {
    let body = hyper::body::to_bytes(req.into_body()).await?;

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
async fn snapshot_endpoint(body: Bytes, ctxt: ExecutorContext) -> Response<Body> {
    let body = match serde_json::from_slice::<RequestBody>(body.as_ref()) {
        Ok(bd) => bd,
        Err(e) => return bad_request(format!("Invalid request JSON: {e}")),
    };
    let RequestBody { kcl_program, test_name } = body;

    let program = match Program::parse_no_errs(&kcl_program) {
        Ok(pr) => pr,
        Err(e) => return bad_request(format!("Parse error: {e}")),
    };

    eprintln!("Executing {test_name}");
    let mut exec_state = ExecState::new(&ctxt);
    // This is a shitty source range, I don't know what else to use for it though.
    // There's no actual KCL associated with this reset_scene call.
    if let Err(e) = ctxt
        .send_clear_scene(&mut exec_state, kcl_lib::SourceRange::default())
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

fn kcl_err(err: impl std::fmt::Display) -> Response<Body> {
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
