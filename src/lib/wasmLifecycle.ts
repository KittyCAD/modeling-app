import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

/**
 * Hooks for code that needs to react whenever a WASM module becomes active.
 *
 * First starts and restarts both notify this listener set, so callers can keep
 * WASM-backed runtime state in sync without coupling themselves to the specific
 * startup or crash-recovery path that produced the new module.
 */
type ActiveWasmInstanceListener = (
  wasmInstance: ModuleType
) => void | Promise<void>

const activeWasmInstanceListeners = new Set<ActiveWasmInstanceListener>()

export function onActiveWasmInstance(listener: ActiveWasmInstanceListener) {
  activeWasmInstanceListeners.add(listener)
  return () => activeWasmInstanceListeners.delete(listener)
}

export async function notifyActiveWasmInstance(wasmInstance: ModuleType) {
  for (const listener of activeWasmInstanceListeners) {
    await listener(wasmInstance)
  }
}
