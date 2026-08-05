import { signal } from '@preact/signals-core'
import { ClientErrorCode } from '@src/lib/clientErrors'
import type {
  ElectronLifecycleDiagnostics,
  ElectronLifecycleReport,
} from '@src/lib/electronLifecycle'
import {
  electronLifecycleReportToClientError,
  initializeElectronLifecycleClientReporting,
} from '@src/lib/electronLifecycleClientReporting'
import { afterEach, describe, expect, it, vi } from 'vitest'

const diagnostics: ElectronLifecycleDiagnostics = {
  runtime: {
    appVersion: '1.2.3',
    arch: 'x64',
    chromeVersion: '140.0.0',
    electronVersion: '40.0.0',
    osRelease: 'test-release',
    platform: 'linux',
  },
  systemMemory: {
    freeKb: 100,
    totalKb: 1000,
  },
  targetWindowId: 7,
  windowCount: 2,
  windows: [
    {
      id: 7,
      isFocused: false,
      isMinimized: false,
      isVisible: true,
    },
  ],
}

const base = {
  diagnostics,
  id: 'report-1',
  occurredAt: '2026-08-04T00:00:00.000Z',
}

const unresponsiveReport: ElectronLifecycleReport = {
  ...base,
  eventType: 'renderer-unresponsive',
}

const createElectronBridge = (
  drainElectronLifecycleReports = vi.fn(async () =>
    Promise.resolve<ElectronLifecycleReport[]>([])
  )
) => {
  let notify: (() => void) | undefined
  const unsubscribe = vi.fn()
  const electron = {
    drainElectronLifecycleReports,
    onElectronLifecycleReportAvailable: vi.fn((callback: () => void) => {
      notify = callback
      return unsubscribe
    }),
  }

  return {
    electron,
    notify: () => notify?.(),
    unsubscribe,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('electronLifecycleReportToClientError', () => {
  const cases: Array<{
    code: ClientErrorCode
    errorName: string
    report: ElectronLifecycleReport
  }> = [
    {
      code: ClientErrorCode.DesktopRendererUnresponsive,
      errorName: 'ElectronRendererUnresponsive',
      report: {
        ...base,
        eventType: 'renderer-unresponsive',
      },
    },
    {
      code: ClientErrorCode.DesktopRenderProcessGone,
      errorName: 'ElectronRenderProcessGone',
      report: {
        ...base,
        eventType: 'render-process-gone',
        exitCode: 137,
        reason: 'oom',
      },
    },
    {
      code: ClientErrorCode.DesktopChildProcessGone,
      errorName: 'ElectronChildProcessGone',
      report: {
        ...base,
        eventType: 'child-process-gone',
        exitCode: 9,
        processType: 'GPU',
        reason: 'crashed',
      },
    },
  ]

  it.each(cases)('maps $errorName to $code', ({ code, errorName, report }) => {
    expect(electronLifecycleReportToClientError(report)).toMatchObject({
      code,
      dedupeKey: 'electron-lifecycle:report-1',
      errorName,
      extra: {
        electronLifecycle: report,
      },
      route: 'electron-lifecycle',
    })
  })

  it('puts renderer exit details in the searchable message', () => {
    const report: ElectronLifecycleReport = {
      ...base,
      eventType: 'render-process-gone',
      exitCode: 137,
      reason: 'oom',
    }

    expect(electronLifecycleReportToClientError(report).message).toBe(
      'Electron renderer process exited: oom (exit code 137)'
    )
  })
})

describe('initializeElectronLifecycleClientReporting', () => {
  it('performs the initial drain for an authenticated renderer', async () => {
    const isLoggedIn = signal(true)
    const drain = vi.fn(async () => [unresponsiveReport])
    const bridge = createElectronBridge(drain)
    const reporter = vi.fn(async () => {})

    const stop = initializeElectronLifecycleClientReporting(
      bridge.electron,
      isLoggedIn,
      reporter
    )

    await vi.waitFor(() => expect(reporter).toHaveBeenCalledTimes(1))
    expect(drain).toHaveBeenCalledTimes(1)
    expect(reporter).toHaveBeenCalledWith(
      electronLifecycleReportToClientError(unresponsiveReport)
    )
    stop()
  })

  it('keeps reports queued until the user is logged in', async () => {
    const isLoggedIn = signal(false)
    const drain = vi.fn(async () => [unresponsiveReport])
    const bridge = createElectronBridge(drain)
    const reporter = vi.fn(async () => {})

    const stop = initializeElectronLifecycleClientReporting(
      bridge.electron,
      isLoggedIn,
      reporter
    )
    bridge.notify()
    await Promise.resolve()

    expect(drain).not.toHaveBeenCalled()

    isLoggedIn.value = true
    await vi.waitFor(() => expect(reporter).toHaveBeenCalledTimes(1))
    expect(drain).toHaveBeenCalledTimes(1)
    stop()
  })

  it('coalesces notifications received while a drain is in flight', async () => {
    const isLoggedIn = signal(true)
    let resolveFirstDrain: (reports: ElectronLifecycleReport[]) => void =
      () => {}
    const firstDrain = new Promise<ElectronLifecycleReport[]>((resolve) => {
      resolveFirstDrain = resolve
    })
    const drain = vi
      .fn<() => Promise<ElectronLifecycleReport[]>>()
      .mockReturnValueOnce(firstDrain)
      .mockResolvedValue([])
    const bridge = createElectronBridge(drain)
    const stop = initializeElectronLifecycleClientReporting(
      bridge.electron,
      isLoggedIn,
      vi.fn(async () => {})
    )

    expect(drain).toHaveBeenCalledTimes(1)
    bridge.notify()
    bridge.notify()
    resolveFirstDrain([])

    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(2))
    await Promise.resolve()
    expect(drain).toHaveBeenCalledTimes(2)
    stop()
  })

  it('logs drain errors and removes lifecycle and auth subscriptions', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const isLoggedIn = signal(true)
    const drain = vi.fn(async () =>
      Promise.reject(new Error('main process unavailable'))
    )
    const bridge = createElectronBridge(drain)
    const reporter = vi.fn(async () => {})
    const stop = initializeElectronLifecycleClientReporting(
      bridge.electron,
      isLoggedIn,
      reporter
    )

    await vi.waitFor(() => expect(warning).toHaveBeenCalledTimes(1))
    expect(reporter).not.toHaveBeenCalled()

    stop()
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1)

    bridge.notify()
    isLoggedIn.value = false
    isLoggedIn.value = true
    await Promise.resolve()
    expect(drain).toHaveBeenCalledTimes(1)
  })
})
