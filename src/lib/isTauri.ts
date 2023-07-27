export function isTauri(): boolean {
  return (window as any).__TAURI__
}
