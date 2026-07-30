export type CloudSyncDiagnosticEvent = {
  id: number
  at: string
  type: string
  [key: string]: unknown
}

export type CloudSyncDiagnosticEventInput = {
  type: string
  [key: string]: unknown
}

type CloudSyncDiagnosticsGlobal = {
  dump: () => CloudSyncDiagnosticEvent[]
  clear: () => void
}

const MAX_CLOUD_SYNC_DIAGNOSTIC_EVENTS = 500
const cloudSyncDiagnosticEvents: CloudSyncDiagnosticEvent[] = []
let nextCloudSyncDiagnosticEventId = 1
let installedDiagnosticsGlobal = false

declare global {
  interface Window {
    __zdsCloudSyncDiagnostics?: CloudSyncDiagnosticsGlobal
  }
}

function installCloudSyncDiagnosticsGlobal() {
  if (installedDiagnosticsGlobal || typeof window === 'undefined') {
    return
  }

  window.__zdsCloudSyncDiagnostics = {
    dump: getCloudSyncDiagnosticEvents,
    clear: clearCloudSyncDiagnosticEvents,
  }
  installedDiagnosticsGlobal = true
}

export function recordCloudSyncDiagnosticEvent(
  event: CloudSyncDiagnosticEventInput
) {
  const diagnosticEvent: CloudSyncDiagnosticEvent = {
    id: nextCloudSyncDiagnosticEventId++,
    at: new Date().toISOString(),
    ...event,
  }
  cloudSyncDiagnosticEvents.push(diagnosticEvent)
  if (cloudSyncDiagnosticEvents.length > MAX_CLOUD_SYNC_DIAGNOSTIC_EVENTS) {
    cloudSyncDiagnosticEvents.splice(
      0,
      cloudSyncDiagnosticEvents.length - MAX_CLOUD_SYNC_DIAGNOSTIC_EVENTS
    )
  }
  installCloudSyncDiagnosticsGlobal()
}

export function getCloudSyncDiagnosticEvents() {
  return [...cloudSyncDiagnosticEvents]
}

export function clearCloudSyncDiagnosticEvents() {
  cloudSyncDiagnosticEvents.length = 0
}
