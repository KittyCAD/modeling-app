/** Browser connectivity is a detection signal, not a guarantee that a request succeeds. */
export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}
