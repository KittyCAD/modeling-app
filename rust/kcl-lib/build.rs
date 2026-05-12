fn main() {
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    if target_arch == "wasm32" {
        return;
    }

    cc::Build::new()
        .cpp(true)
        .std("c++17")
        .file("../../packages/occt-command-core/src/occt_command_core.cpp")
        .include("../../packages/occt-command-core/src")
        .compile("zoo_occt_command_core");

    println!("cargo:rerun-if-changed=../../packages/occt-command-core/src/occt_command_core.cpp");
    println!("cargo:rerun-if-changed=../../packages/occt-command-core/src/occt_command_core.h");
}
