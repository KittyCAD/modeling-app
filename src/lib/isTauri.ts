export function isTauri(): boolean {
  // TODO: fix it this broke in v2
  return true
  if (typeof window !== 'undefined') {
    return '__TAURI__' in window
  }
  return false
}
