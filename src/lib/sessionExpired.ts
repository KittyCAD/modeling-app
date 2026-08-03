import { signal } from '@preact/signals-core'

export type SessionExpiredSource =
  | 'fetch'
  | 'engine-websocket'
  | 'legacy-engine-websocket'
  | 'unknown'

export type SessionExpiredNotice = {
  source: SessionExpiredSource
  detectedAt: number
}

export const sessionExpiredNotice = signal<SessionExpiredNotice | undefined>(
  undefined
)

let originalFetch: typeof fetch | undefined
let fetchMonitorInstalled = false
let fetchMonitorInstallCount = 0

export function notifySessionExpired(source: SessionExpiredSource = 'unknown') {
  const notice: SessionExpiredNotice = {
    source,
    detectedAt: Date.now(),
  }

  sessionExpiredNotice.value = notice
}

export function clearSessionExpiredNotice() {
  sessionExpiredNotice.value = undefined
}

export function installSessionExpiredFetchMonitor() {
  if (typeof globalThis.fetch !== 'function') {
    return
  }

  fetchMonitorInstallCount += 1
  if (fetchMonitorInstalled) {
    return
  }

  originalFetch = globalThis.fetch
  const fetchToMonitor = originalFetch
  const monitoredFetch: typeof fetch = async (...args) => {
    const response = (await Reflect.apply(
      fetchToMonitor,
      globalThis,
      args
    )) as Response
    if (response.status === 401) {
      notifySessionExpired('fetch')
    }

    return response
  }

  globalThis.fetch = monitoredFetch
  fetchMonitorInstalled = true
}

export function uninstallSessionExpiredFetchMonitor() {
  if (!fetchMonitorInstalled || !originalFetch) {
    return
  }

  fetchMonitorInstallCount = Math.max(0, fetchMonitorInstallCount - 1)
  if (fetchMonitorInstallCount > 0) {
    return
  }

  globalThis.fetch = originalFetch
  originalFetch = undefined
  fetchMonitorInstalled = false
}
