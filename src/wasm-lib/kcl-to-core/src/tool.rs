use std::{env, fs};

use kcl_to_core::*;

#[tokio::main]
async fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        println!("Usage: kcl-to-core path/to/file.kcl");
        return;
    }

    let file_path = &args[1];
    let kcl = fs::read_to_string(file_path).expect("read file");

    let result = kcl_to_engine_core(&kcl).await.expect("kcl conversion");

    println!("{}", result);
}
