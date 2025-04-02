# Stop the script when a cmdlet or a native command fails
# from https://www.meziantou.net/stop-the-script-when-an-error-occurs-in-powershell.htm
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

rm -Recurse -Force rust/kcl-wasm-lib/pkg
mkdir -p rust/kcl-wasm-lib/pkg
if (Test-Path rust/kcl-lib/bindings) {
    rm -Recurse -Force rust/kcl-lib/bindings
}

cd rust
$env:RUSTFLAGS='--cfg getrandom_backend="wasm_js"'
wasm-pack build kcl-wasm-lib --dev --target web --out-dir pkg
$env:RUSTFLAGS=''
cargo test -p kcl-lib export_bindings
cd ..

copy rust\kcl-wasm-lib\pkg\kcl_wasm_lib_bg.wasm public
yarn fmt:generated
