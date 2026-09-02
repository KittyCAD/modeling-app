import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const packageDirectory = path.resolve(
  process.argv[2] ?? 'rust/kcl-wasm-lib/pkg'
)
const kclCargoToml = await readFile('rust/kcl-lib/Cargo.toml', 'utf8')
const expectedVersion = kclCargoToml.match(/^version = "([^"]+)"/m)?.[1]

if (!expectedVersion) {
  throw new Error('Could not read the kcl-lib version from Cargo.toml.')
}

const wasmModule = await import(
  pathToFileURL(path.join(packageDirectory, 'kcl_wasm_lib.js')).href
)
const wasmBytes = await readFile(
  path.join(packageDirectory, 'kcl_wasm_lib_bg.wasm')
)
await wasmModule.default({ module_or_path: wasmBytes })

const actualVersion = wasmModule.get_kcl_version()
if (actualVersion !== expectedVersion) {
  throw new Error(
    `Prepared KCL Wasm version ${actualVersion} does not match source version ${expectedVersion}.`
  )
}

console.log(`Prepared KCL Wasm matches source version ${expectedVersion}.`)
