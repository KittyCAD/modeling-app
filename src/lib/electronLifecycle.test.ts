import {
  compactAppProcessMetrics,
  compactSystemMemoryInfo,
  type ElectronLifecycleDiagnostics,
  type ElectronLifecycleReport,
  ElectronLifecycleReportQueue,
  parseElectronLifecycleReportStore,
  serializeElectronLifecycleReportStore,
} from '@src/lib/electronLifecycle'
import { describe, expect, it } from 'vitest'

const diagnostics: ElectronLifecycleDiagnostics = {
  runtime: {
    appVersion: '1.2.3',
    arch: 'arm64',
    chromeVersion: '140.0.0',
    electronVersion: '40.0.0',
    osRelease: 'test-release',
    platform: 'darwin',
  },
  windowCount: 1,
  windows: [
    {
      id: 1,
      isFocused: true,
      isMinimized: false,
      isVisible: true,
      rendererProcessId: 123,
    },
  ],
}

const makeReport = (id: string): ElectronLifecycleReport => ({
  diagnostics,
  eventType: 'renderer-unresponsive',
  id,
  occurredAt: '2026-08-04T00:00:00.000Z',
})

describe('ElectronLifecycleReportQueue', () => {
  it('drains reports in FIFO order and clears the queue', () => {
    const queue = new ElectronLifecycleReportQueue(3)
    queue.enqueue(makeReport('first'))
    queue.enqueue(makeReport('second'))

    expect(queue.size).toBe(2)
    expect(queue.drain().map(({ id }) => id)).toEqual(['first', 'second'])
    expect(queue.size).toBe(0)
    expect(queue.drain()).toEqual([])
  })

  it('keeps the newest reports when its bound is reached', () => {
    const queue = new ElectronLifecycleReportQueue(2)
    queue.enqueue(makeReport('first'))
    queue.enqueue(makeReport('second'))
    queue.enqueue(makeReport('third'))

    expect(queue.drain().map(({ id }) => id)).toEqual(['second', 'third'])
  })
})

describe('Electron lifecycle report persistence', () => {
  it('round-trips known fields and strips project data and unknown fields', () => {
    const reportWithUnexpectedData = {
      ...makeReport('private-data'),
      diagnostics: {
        ...diagnostics,
        projectContent: 'secret KCL source',
        projectPath: '/Users/example/private-project',
        windows: diagnostics.windows.map((window) => ({
          ...window,
          title: 'private-project/main.kcl',
        })),
      },
      projectPath: '/Users/example/private-project/main.kcl',
    }

    const serialized = serializeElectronLifecycleReportStore([
      reportWithUnexpectedData,
    ])
    const restored = parseElectronLifecycleReportStore(serialized)

    expect(serialized).not.toContain('secret KCL source')
    expect(serialized).not.toContain('private-project')
    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject(makeReport('private-data'))
  })

  it('tolerates corrupt, old, and partially-invalid store data', () => {
    expect(parseElectronLifecycleReportStore('{not json')).toEqual([])
    expect(parseElectronLifecycleReportStore(' '.repeat(1_000_001))).toEqual([])
    expect(
      parseElectronLifecycleReportStore(
        JSON.stringify({
          version: 0,
          reports: [{ invalid: true }, makeReport('valid-from-old-wrapper')],
        })
      ).map(({ id }) => id)
    ).toEqual(['valid-from-old-wrapper'])
    expect(
      parseElectronLifecycleReportStore(
        JSON.stringify([makeReport('valid-from-bare-array')])
      ).map(({ id }) => id)
    ).toEqual(['valid-from-bare-array'])
  })

  it('keeps only the newest 50 persisted reports', () => {
    const reports = Array.from({ length: 60 }, (_, index) =>
      makeReport(`report-${index}`)
    )

    const restored = parseElectronLifecycleReportStore(
      serializeElectronLifecycleReportStore(reports)
    )

    expect(restored).toHaveLength(50)
    expect(restored.at(0)?.id).toBe('report-10')
    expect(restored.at(-1)?.id).toBe('report-59')
  })

  it('serializes an empty store after the queue is drained', () => {
    const queue = new ElectronLifecycleReportQueue()
    queue.enqueue(makeReport('pending'))
    queue.drain()

    expect(
      parseElectronLifecycleReportStore(
        serializeElectronLifecycleReportStore(queue.snapshot())
      )
    ).toEqual([])
  })
})

describe('Electron lifecycle metric compaction', () => {
  it('labels system memory values as kilobytes', () => {
    expect(
      compactSystemMemoryInfo({
        free: 200,
        swapFree: 300,
        swapTotal: 400,
        total: 1000,
      })
    ).toEqual({
      fileBackedKb: undefined,
      freeKb: 200,
      purgeableKb: undefined,
      swapFreeKb: 300,
      swapTotalKb: 400,
      totalKb: 1000,
    })
  })

  it('keeps compact CPU and memory fields and bounds process count', () => {
    const metrics = Array.from({ length: 40 }, (_, index) => ({
      cpu: { percentCPUUsage: index + 0.5 },
      memory: {
        peakWorkingSetSize: index + 20,
        privateBytes: index + 30,
        workingSetSize: index + 10,
      },
      pid: index,
      type: index === 0 ? 'Browser' : 'Tab',
    }))

    const compact = compactAppProcessMetrics(metrics)

    expect(compact).toHaveLength(32)
    expect(compact?.[0]).toEqual({
      cpuPercent: 0.5,
      name: undefined,
      peakWorkingSetKb: 20,
      pid: 0,
      privateBytesKb: 30,
      serviceName: undefined,
      type: 'Browser',
      workingSetKb: 10,
    })
  })
})
