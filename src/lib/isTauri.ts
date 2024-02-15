export function isTauri(): boolean {
  if (typeof window !== 'undefined') {
    return '__TAURI_INTERNALS__' in window
  }
  return false
}
