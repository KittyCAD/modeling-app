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
let monitoredFetch: typeof fetch | undefined
let fetchMonitorInstalled = false
let fetchMonitorInstallCount = 0

function monitorCurrentFetch() {
  originalFetch = globalThis.fetch
  const fetchToMonitor = originalFetch
  monitoredFetch = async (...args) => {
    const response = await Reflect.apply(fetchToMonitor, globalThis, args)
    if (response.status === 401) {
      notifySessionExpired('fetch')
    }

    return response
  }

  globalThis.fetch = monitoredFetch
  fetchMonitorInstalled = true
}

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
    if (monitoredFetch && globalThis.fetch !== monitoredFetch) {
      monitorCurrentFetch()
    }
    return
  }

  monitorCurrentFetch()
}

export function uninstallSessionExpiredFetchMonitor() {
  if (!fetchMonitorInstalled || !originalFetch) {
    return
  }

  fetchMonitorInstallCount = Math.max(0, fetchMonitorInstallCount - 1)
  if (fetchMonitorInstallCount > 0) {
    return
  }

  if (globalThis.fetch === monitoredFetch) {
    globalThis.fetch = originalFetch
  }
  originalFetch = undefined
  monitoredFetch = undefined
  fetchMonitorInstalled = false
}
