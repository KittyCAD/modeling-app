fn main() {
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    if target_arch == "wasm32" {
        return;
    }

    let mut build = cc::Build::new();
    build
        .cpp(true)
        .std("c++17")
        .file("../../packages/occt-command-core/src/occt_command_core.cpp")
        .include("../../packages/occt-command-core/src");

    if std::env::var("ZOO_OCCT_CORE_WITH_OCCT").as_deref() == Ok("1") {
        build.define("ZOO_OCCT_CORE_WITH_OCCT", "1");
        if let Ok(include_dir) = std::env::var("OPENCASCADE_INCLUDE_DIR") {
            build.include(include_dir);
        }
        if let Ok(lib_dir) = std::env::var("OPENCASCADE_LIB_DIR") {
            println!("cargo:rustc-link-search=native={lib_dir}");
        }
        for lib in [
            "TKPrim",
            "TKBRep",
            "TKTopAlgo",
            "TKGProp",
            "TKGeomBase",
            "TKG3d",
            "TKG2d",
            "TKMath",
            "TKernel",
        ] {
            println!("cargo:rustc-link-lib={lib}");
        }
    }

    build.compile("zoo_occt_command_core");

    println!("cargo:rerun-if-changed=../../packages/occt-command-core/src/occt_command_core.cpp");
    println!("cargo:rerun-if-changed=../../packages/occt-command-core/src/occt_command_core.h");
    println!("cargo:rerun-if-env-changed=ZOO_OCCT_CORE_WITH_OCCT");
    println!("cargo:rerun-if-env-changed=OPENCASCADE_INCLUDE_DIR");
    println!("cargo:rerun-if-env-changed=OPENCASCADE_LIB_DIR");
}
