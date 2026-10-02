fn main() -> std::process::ExitCode {
    match glb_render::cpu_render_from_disk(std::env::args_os().skip(1).collect()) {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
