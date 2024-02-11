export function isTauri(): boolean {
  if (typeof window !== 'undefined') {
    return '__TAURI__' in window
  }
  return false
}
