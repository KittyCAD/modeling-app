import { createProjectPoller } from '@src/lib/fs-zds/cloud/polling'

/** Scope the existing non-overlapping poll schedule to a visible, connected list. */
export function pollProjectList(
  check: () => Promise<boolean>,
  onError: (error: unknown) => void
) {
  const visible = () =>
    document.visibilityState !== 'hidden' && navigator.onLine
  const poller = createProjectPoller({
    check: () => (visible() ? check() : Promise.resolve(false)),
    onError,
  })
  const updateVisibility = () => poller.setEnabled(visible())
  const focus = () => {
    if (visible()) poller.checkNow()
  }
  document.addEventListener('visibilitychange', updateVisibility)
  window.addEventListener('online', updateVisibility)
  window.addEventListener('offline', updateVisibility)
  window.addEventListener('focus', focus)
  updateVisibility()
  return () => {
    poller.dispose()
    document.removeEventListener('visibilitychange', updateVisibility)
    window.removeEventListener('online', updateVisibility)
    window.removeEventListener('offline', updateVisibility)
    window.removeEventListener('focus', focus)
  }
}
