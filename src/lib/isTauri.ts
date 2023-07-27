export function isTauri(): boolean {
  return '__TAURI__' in window
}
