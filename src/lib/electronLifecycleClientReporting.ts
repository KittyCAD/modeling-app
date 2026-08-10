import type { IElectronAPI } from '@root/interface'
import type { ReadonlySignal } from '@preact/signals-core'
import { ClientErrorCode, reportClientError } from '@src/lib/clientErrors'
import type { ElectronLifecycleReport } from '@src/lib/electronLifecycle'

type ReportClientErrorParams = Parameters<typeof reportClientError>[0]

type ElectronLifecycleBridge = Pick<
  IElectronAPI,
  'drainElectronLifecycleReports' | 'onElectronLifecycleReportAvailable'
>

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
  isLoggedInSignal: ReadonlySignal<boolean>,
  clientErrorReporter: ClientErrorReporter = reportClientError
) => {
  let drainRequested = false
  let drainInFlight: Promise<void> | undefined
  let isLoggedIn = isLoggedInSignal.value
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
  const unsubscribeFromAuth = isLoggedInSignal.subscribe((nextIsLoggedIn) => {
    const wasLoggedIn = isLoggedIn
    isLoggedIn = nextIsLoggedIn
    if (isLoggedIn && !wasLoggedIn) {
      requestDrain()
    }
  })
  requestDrain()

  return () => {
    stopped = true
    unsubscribe()
    unsubscribeFromAuth()
  }
}
