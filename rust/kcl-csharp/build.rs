fn main() {
    csbindgen::Builder::default()
        .input_extern_file("src/lib.rs")
        .csharp_dll_name("kcl_csharp")
        .generate_csharp_file("../dotnet/Kcl.g.cs")
        .unwrap();
}
