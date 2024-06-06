use std::net::SocketAddr;

use hyper::header::CONTENT_TYPE;
use hyper::service::{make_service_fn, service_fn};
use hyper::{Body, Error, Response, Server};
use kcl_lib::executor::ExecutorContext;
use kcl_lib::settings::types::UnitLength;

use crate::new_context;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let listen_on = std::env::args().skip(1).next().unwrap();
    start(listen_on).await?
}

pub async fn start(listen_on: SocketAddr) -> anyhow::Result<()> {
    let state: ExecutorContext = new_context(UnitLength::Mm).await?;
    // In hyper, a `MakeService` is basically your server.
    // It makes a `Service` for each connection, which manages the connection.
    let make_service = make_service_fn(
        // This closure is run for each connection.
        move |_| {
            let state = state.clone();
            async move {
                // This is the `Service` which handles the connection.
                // `service_fn` converts a function which returns a Response
                // into a `Service`.
                Ok::<_, Error>(service_fn(move |req| {
                    // Return a response.

                    async move {
                        let whole_body = hyper::body::to_bytes(req.into_body()).await?;
                        let Ok(kcl_src_code) = String::from_utf8(whole_body.into()) else {
                            return Ok(bad_request("Body was not UTF-8".to_owned()));
                        };
                        let parser = match kcl_lib::token::lexer(&kcl_src_code) {
                            Ok(t) => kcl_lib::parser::Parser::new(t),
                            Err(e) => return Ok(bad_request(format!("tokenization error: {e}"))),
                        };
                        let program = match parser.ast() {
                            Ok(p) => p,
                            Err(e) => return Ok(bad_request(format!("Parse error: {e}"))),
                        };
                        let png_bytes: Vec<u8> = todo!();
                        let mut resp = Response::new(Body::from(png_bytes));
                        resp.headers_mut().insert(CONTENT_TYPE, "image/png".parse().unwrap());
                        Ok::<_, Error>(resp)
                    }
                }))
            }
        },
    );
    let server = Server::bind(&listen_on).serve(make_service);
    println!("Listening on {listen_on}");
    if let Err(e) = server.await {
        eprintln!("Server error: {e}");
        return Err(e.into());
    }
    Ok(())
}

fn bad_request(msg: String) -> Response<Body> {
    let mut resp = Response::new(Body::from(msg));
    *resp.status_mut() = hyper::StatusCode::BAD_REQUEST;
    resp
}
