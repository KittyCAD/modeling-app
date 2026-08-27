/**
 * Loading the KCL WASM module.
 *
 * Lazy and shared: the module is a few megabytes, so it loads on first use
 * rather than at boot, and every caller waits on the same promise instead of
 * racing to instantiate it twice.
 *
 * The bundle is produced by `npm run build:wasm` and gitignored, so a checkout
 * that has not built it will fail here rather than at startup — which is the
 * right place, since everything except execution works without it.
 */

export type KclWasmModule =
  typeof import('@rust/kcl-wasm-lib/pkg/kcl_wasm_lib.js')

let loading: Promise<KclWasmModule> | null = null

/**
 * Where the `.wasm` binary lives.
 *
 * Over http it is served from the origin. Under `file://` — the packaged
 * desktop app — a root-relative URL would resolve to the filesystem root, so the
 * path has to be derived from the document's own location.
 */
export function wasmBinaryUrl(): string {
  const file = 'kcl_wasm_lib_bg.wasm'

  if (document.location.protocol.startsWith('http')) {
    return `${document.location.origin}/${file}`
  }

  const directory = document.location.pathname.split('/').slice(0, -1).join('/')
  return `${document.location.protocol}//${directory}/${file}`
}

export function loadKclWasm(): Promise<KclWasmModule> {
  loading ??= (async () => {
    const module = await import('@rust/kcl-wasm-lib/pkg/kcl_wasm_lib.js')
    await module.default({ module_or_path: wasmBinaryUrl() })
    return module
  })().catch((error) => {
    // Cleared so a transient failure — a slow first load, a dropped request —
    // can be retried instead of poisoning every later attempt.
    loading = null
    throw error
  })

  return loading
}

/** Test seam: replace the loader with a fake module. */
export function setKclWasmForTesting(
  module: Promise<KclWasmModule> | null
): void {
  loading = module
}
