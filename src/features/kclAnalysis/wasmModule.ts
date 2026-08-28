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

export function loadKclWasm(): Promise<KclWasmModule> {
  loading ??= (async () => {
    const module = await import('@rust/kcl-wasm-lib/pkg/kcl_wasm_lib.js')

    /**
     * Initialised with no path on purpose.
     *
     * `wasm-bindgen`'s glue falls back to `new URL('kcl_wasm_lib_bg.wasm',
     * import.meta.url)`, which the bundler rewrites to the emitted asset next to
     * the glue chunk. That is the one form of the URL that stays correct
     * everywhere: it is relative to the *module*, so it survives a relative base
     * under `file://`, and it carries a content hash so a deployed build cannot
     * be served a stale 15MB binary from cache.
     *
     * Passing a path here is what broke the desktop app. Any URL derived from
     * `document.location` is derived from whatever the router last pushed, so
     * opening a project moved the binary to `file:///project/`, and KCL stopped
     * loading with "Failed to fetch" the moment there was anything to run.
     */
    await module.default()
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
