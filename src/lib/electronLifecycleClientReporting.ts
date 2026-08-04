import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import type { ElectronLifecycleReport } from '@src/lib/electronLifecycle'

type ReportClientErrorParams = Parameters<typeof reportClientError>[0]

type ElectronLifecycleBridge = {
  drainElectronLifecycleReports: () => Promise<ElectronLifecycleReport[]>
  onElectronLifecycleReportAvailable: (callback: () => void) => () => void
}

type AuthSnapshotBridge = {
  matches: (state: 'loggedIn') => boolean
}

type AuthActorBridge = {
  getSnapshot: () => AuthSnapshotBridge
  subscribe: (listener: (snapshot: AuthSnapshotBridge) => void) => {
    unsubscribe: () => void
  }
}

type ClientErrorReporter = (
  params: ReportClientErrorParams
) => ReturnType<typeof reportClientError>

export const electronLifecycleReportToClientError = (
  report: ElectronLifecycleReport
): ReportClientErrorParams => {
  const common = {
    dedupeKey: `electron-lifecycle:${report.id}`,
    extra: { electronLifecycle: report },
    route: 'electron-lifecycle',
  }

  switch (report.eventType) {
    case 'renderer-unresponsive':
      return {
        ...common,
        code: ClientErrorCode.DesktopRendererUnresponsive,
        errorName: 'ElectronRendererUnresponsive',
        message: 'Electron renderer became unresponsive',
      }
    case 'render-process-gone':
      return {
        ...common,
        code: ClientErrorCode.DesktopRenderProcessGone,
        errorName: 'ElectronRenderProcessGone',
        message: `Electron renderer process exited: ${report.reason} (exit code ${report.exitCode})`,
      }
    case 'child-process-gone':
      return {
        ...common,
        code: ClientErrorCode.DesktopChildProcessGone,
        errorName: 'ElectronChildProcessGone',
        message: `Electron ${report.processType} child process exited: ${report.reason} (exit code ${report.exitCode})`,
      }
  }
}

export const initializeElectronLifecycleClientReporting = (
  electron: ElectronLifecycleBridge,
  authActor: AuthActorBridge,
  clientErrorReporter: ClientErrorReporter = reportClientError
) => {
  let drainRequested = false
  let drainInFlight: Promise<void> | undefined
  let isLoggedIn = authActor.getSnapshot().matches('loggedIn')
  let stopped = false

  const requestDrain = () => {
    if (stopped) {
      return
    }
    drainRequested = true
    if (!isLoggedIn || drainInFlight) {
      return
    }

    drainInFlight = (async () => {
      while (drainRequested && !stopped && isLoggedIn) {
        drainRequested = false

        let reports: ElectronLifecycleReport[]
        try {
          reports = await electron.drainElectronLifecycleReports()
        } catch (error) {
          console.warn('Failed to drain Electron lifecycle reports', error)
          return
        }

        for (const report of reports) {
          try {
            await clientErrorReporter(
              electronLifecycleReportToClientError(report)
            )
          } catch (error) {
            console.warn('Failed to report Electron lifecycle event', error)
          }
        }
      }
    })().finally(() => {
      drainInFlight = undefined
      if (drainRequested && !stopped && isLoggedIn) {
        requestDrain()
      }
    })
  }

  const unsubscribe = electron.onElectronLifecycleReportAvailable(requestDrain)
  const authSubscription = authActor.subscribe((snapshot) => {
    const wasLoggedIn = isLoggedIn
    isLoggedIn = snapshot.matches('loggedIn')
    if (isLoggedIn && !wasLoggedIn) {
      requestDrain()
    }
  })
  requestDrain()

  return () => {
    stopped = true
    unsubscribe()
    authSubscription.unsubscribe()
  }
}
