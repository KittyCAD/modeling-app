export function isTauri(): boolean {
  if (globalThis.window && typeof globalThis.window !== 'undefined') {
    return '__TAURI_INTERNALS__' in globalThis.window
  }
  return false
}
