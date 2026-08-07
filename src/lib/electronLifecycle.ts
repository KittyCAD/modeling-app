import { isArray } from '@src/lib/utils'

export const ELECTRON_LIFECYCLE_REPORT_AVAILABLE_CHANNEL =
  'electron-lifecycle-report-available'
export const ELECTRON_LIFECYCLE_DRAIN_REPORTS_CHANNEL =
  'electron-lifecycle-drain-reports'
export const MAX_ELECTRON_LIFECYCLE_REPORTS = 50
export const MAX_ELECTRON_LIFECYCLE_REPORT_STORE_BYTES = 1_000_000

const ELECTRON_LIFECYCLE_REPORT_STORE_VERSION = 1
const MAX_DIAGNOSTIC_STRING_LENGTH = 512
const MAX_WINDOWS = 64
const MAX_PROCESS_METRICS = 32

export type ElectronProcessGoneReason =
  | 'clean-exit'
  | 'abnormal-exit'
  | 'killed'
  | 'crashed'
  | 'oom'
  | 'launch-failed'
  | 'integrity-failure'
  | 'memory-eviction'

export type ElectronWindowDiagnostic = {
  id: number
  isFocused: boolean
  isMinimized: boolean
  isVisible: boolean
  rendererProcessId?: number
}

export type ElectronSystemMemoryDiagnostic = {
  fileBackedKb?: number
  freeKb?: number
  purgeableKb?: number
  swapFreeKb?: number
  swapTotalKb?: number
  totalKb?: number
}

export type ElectronAppProcessDiagnostic = {
  cpuPercent?: number
  name?: string
  peakWorkingSetKb?: number
  pid: number
  privateBytesKb?: number
  serviceName?: string
  type: string
  workingSetKb?: number
}

export type ElectronLifecycleDiagnostics = {
  appProcesses?: ElectronAppProcessDiagnostic[]
  runtime: {
    appVersion: string
    arch: string
    chromeVersion: string
    electronVersion: string
    osRelease: string
    platform: string
  }
  systemMemory?: ElectronSystemMemoryDiagnostic
  targetWindowId?: number
  windowCount: number
  windows: ElectronWindowDiagnostic[]
}

type ElectronLifecycleReportBase = {
  diagnostics: ElectronLifecycleDiagnostics
  id: string
  occurredAt: string
}

export type ElectronLifecycleReport =
  | (ElectronLifecycleReportBase & {
      eventType: 'renderer-unresponsive'
    })
  | (ElectronLifecycleReportBase & {
      eventType: 'render-process-gone'
      exitCode: number
      reason: ElectronProcessGoneReason
    })
  | (ElectronLifecycleReportBase & {
      eventType: 'child-process-gone'
      exitCode: number
      name?: string
      processType: string
      reason: ElectronProcessGoneReason
      serviceName?: string
    })

type SystemMemoryInfoLike = {
  fileBacked?: number
  free?: number
  purgeable?: number
  swapFree?: number
  swapTotal?: number
  total?: number
}

type ProcessMetricLike = {
  cpu?: {
    percentCPUUsage?: number
  }
  memory?: {
    peakWorkingSetSize?: number
    privateBytes?: number
    workingSetSize?: number
  }
  name?: string
  pid: number
  serviceName?: string
  type: string
}

type UnknownRecord = Record<string, unknown>

const asRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === 'object' && value !== null && !isArray(value)
    ? (value as UnknownRecord)
    : undefined

const boundedString = (
  value: unknown,
  maxLength = MAX_DIAGNOSTIC_STRING_LENGTH
) =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined

const finiteUnknownNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const integer = (value: unknown) => {
  const number = finiteUnknownNumber(value)
  return number !== undefined && Number.isInteger(number) ? number : undefined
}

const boolean = (value: unknown) =>
  typeof value === 'boolean' ? value : undefined

const finiteNumber = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export const compactSystemMemoryInfo = (
  memory: SystemMemoryInfoLike | undefined
): ElectronSystemMemoryDiagnostic | undefined => {
  if (!memory) return undefined

  return {
    fileBackedKb: finiteNumber(memory.fileBacked),
    freeKb: finiteNumber(memory.free),
    purgeableKb: finiteNumber(memory.purgeable),
    swapFreeKb: finiteNumber(memory.swapFree),
    swapTotalKb: finiteNumber(memory.swapTotal),
    totalKb: finiteNumber(memory.total),
  }
}

export const compactAppProcessMetrics = (
  metrics: readonly ProcessMetricLike[] | undefined
): ElectronAppProcessDiagnostic[] | undefined => {
  if (!metrics) return undefined

  return metrics.slice(0, MAX_PROCESS_METRICS).map((metric) => ({
    cpuPercent: finiteNumber(metric.cpu?.percentCPUUsage),
    name: metric.name,
    peakWorkingSetKb: finiteNumber(metric.memory?.peakWorkingSetSize),
    pid: metric.pid,
    privateBytesKb: finiteNumber(metric.memory?.privateBytes),
    serviceName: metric.serviceName,
    type: metric.type,
    workingSetKb: finiteNumber(metric.memory?.workingSetSize),
  }))
}

const normalizeWindowDiagnostic = (
  value: unknown
): ElectronWindowDiagnostic | undefined => {
  const record = asRecord(value)
  if (!record) return undefined

  const id = integer(record.id)
  const isFocused = boolean(record.isFocused)
  const isMinimized = boolean(record.isMinimized)
  const isVisible = boolean(record.isVisible)
  if (
    id === undefined ||
    isFocused === undefined ||
    isMinimized === undefined ||
    isVisible === undefined
  ) {
    return undefined
  }

  return {
    id,
    isFocused,
    isMinimized,
    isVisible,
    rendererProcessId: integer(record.rendererProcessId),
  }
}

const normalizeSystemMemoryDiagnostic = (
  value: unknown
): ElectronSystemMemoryDiagnostic | undefined => {
  const record = asRecord(value)
  if (!record) return undefined

  return {
    fileBackedKb: finiteUnknownNumber(record.fileBackedKb),
    freeKb: finiteUnknownNumber(record.freeKb),
    purgeableKb: finiteUnknownNumber(record.purgeableKb),
    swapFreeKb: finiteUnknownNumber(record.swapFreeKb),
    swapTotalKb: finiteUnknownNumber(record.swapTotalKb),
    totalKb: finiteUnknownNumber(record.totalKb),
  }
}

const normalizeAppProcessDiagnostic = (
  value: unknown
): ElectronAppProcessDiagnostic | undefined => {
  const record = asRecord(value)
  if (!record) return undefined

  const pid = integer(record.pid)
  const type = boundedString(record.type)
  if (pid === undefined || type === undefined) return undefined

  return {
    cpuPercent: finiteUnknownNumber(record.cpuPercent),
    name: boundedString(record.name),
    peakWorkingSetKb: finiteUnknownNumber(record.peakWorkingSetKb),
    pid,
    privateBytesKb: finiteUnknownNumber(record.privateBytesKb),
    serviceName: boundedString(record.serviceName),
    type,
    workingSetKb: finiteUnknownNumber(record.workingSetKb),
  }
}

const normalizeLifecycleDiagnostics = (
  value: unknown
): ElectronLifecycleDiagnostics | undefined => {
  const record = asRecord(value)
  const runtime = asRecord(record?.runtime)
  if (!record || !runtime || !isArray(record.windows)) return undefined

  const appVersion = boundedString(runtime.appVersion)
  const arch = boundedString(runtime.arch)
  const chromeVersion = boundedString(runtime.chromeVersion)
  const electronVersion = boundedString(runtime.electronVersion)
  const osRelease = boundedString(runtime.osRelease)
  const platform = boundedString(runtime.platform)
  const windowCount = integer(record.windowCount)
  if (
    appVersion === undefined ||
    arch === undefined ||
    chromeVersion === undefined ||
    electronVersion === undefined ||
    osRelease === undefined ||
    platform === undefined ||
    windowCount === undefined
  ) {
    return undefined
  }

  const windows = record.windows
    .slice(0, MAX_WINDOWS)
    .map(normalizeWindowDiagnostic)
    .filter(
      (window): window is ElectronWindowDiagnostic => window !== undefined
    )
  const appProcesses = isArray(record.appProcesses)
    ? record.appProcesses
        .slice(0, MAX_PROCESS_METRICS)
        .map(normalizeAppProcessDiagnostic)
        .filter(
          (process): process is ElectronAppProcessDiagnostic =>
            process !== undefined
        )
    : undefined

  return {
    appProcesses,
    runtime: {
      appVersion,
      arch,
      chromeVersion,
      electronVersion,
      osRelease,
      platform,
    },
    systemMemory: normalizeSystemMemoryDiagnostic(record.systemMemory),
    targetWindowId: integer(record.targetWindowId),
    windowCount,
    windows,
  }
}

const processGoneReasons = new Set<ElectronProcessGoneReason>([
  'clean-exit',
  'abnormal-exit',
  'killed',
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
  'memory-eviction',
])

const normalizeProcessGoneReason = (
  value: unknown
): ElectronProcessGoneReason | undefined =>
  typeof value === 'string' &&
  processGoneReasons.has(value as ElectronProcessGoneReason)
    ? (value as ElectronProcessGoneReason)
    : undefined

/**
 * Rebuilds the report from known fields so corrupt or future data cannot add
 * document paths, project content, or other unexpected values to a report.
 */
export const normalizeElectronLifecycleReport = (
  value: unknown
): ElectronLifecycleReport | undefined => {
  const record = asRecord(value)
  const diagnostics = normalizeLifecycleDiagnostics(record?.diagnostics)
  const id = boundedString(record?.id, 128)
  const occurredAt = boundedString(record?.occurredAt, 64)
  if (!record || !diagnostics || !id || !occurredAt) return undefined

  const base = { diagnostics, id, occurredAt }
  switch (record.eventType) {
    case 'renderer-unresponsive':
      return { ...base, eventType: 'renderer-unresponsive' }
    case 'render-process-gone': {
      const exitCode = integer(record.exitCode)
      const reason = normalizeProcessGoneReason(record.reason)
      return exitCode !== undefined && reason
        ? { ...base, eventType: 'render-process-gone', exitCode, reason }
        : undefined
    }
    case 'child-process-gone': {
      const exitCode = integer(record.exitCode)
      const processType = boundedString(record.processType)
      const reason = normalizeProcessGoneReason(record.reason)
      return exitCode !== undefined && processType && reason
        ? {
            ...base,
            eventType: 'child-process-gone',
            exitCode,
            name: boundedString(record.name),
            processType,
            reason,
            serviceName: boundedString(record.serviceName),
          }
        : undefined
    }
    default:
      return undefined
  }
}

const normalizeElectronLifecycleReports = (values: readonly unknown[]) =>
  values
    .map(normalizeElectronLifecycleReport)
    .filter((report): report is ElectronLifecycleReport => report !== undefined)
    .slice(-MAX_ELECTRON_LIFECYCLE_REPORTS)

export const parseElectronLifecycleReportStore = (
  serialized: string
): ElectronLifecycleReport[] => {
  if (serialized.length > MAX_ELECTRON_LIFECYCLE_REPORT_STORE_BYTES) return []

  try {
    const parsed: unknown = JSON.parse(serialized)
    const record = asRecord(parsed)
    const reports = isArray(parsed)
      ? parsed
      : isArray(record?.reports)
        ? record.reports
        : []
    return normalizeElectronLifecycleReports(reports)
  } catch {
    return []
  }
}

export const serializeElectronLifecycleReportStore = (
  reports: readonly unknown[]
) =>
  JSON.stringify({
    version: ELECTRON_LIFECYCLE_REPORT_STORE_VERSION,
    reports: normalizeElectronLifecycleReports(reports),
  })

/**
 * Main process reports must wait for a usable renderer because the affected
 * renderer may be unable to make the client-error API request itself.
 */
export class ElectronLifecycleReportQueue {
  private readonly reports: ElectronLifecycleReport[] = []
  private readonly maxSize: number

  constructor(maxSize = MAX_ELECTRON_LIFECYCLE_REPORTS) {
    this.maxSize = Math.max(1, Math.floor(maxSize))
  }

  enqueue(report: ElectronLifecycleReport) {
    if (this.reports.length === this.maxSize) {
      this.reports.shift()
    }
    this.reports.push(report)
  }

  drain(): ElectronLifecycleReport[] {
    return this.reports.splice(0, this.reports.length)
  }

  snapshot(): ElectronLifecycleReport[] {
    return [...this.reports]
  }

  get size() {
    return this.reports.length
  }
}
