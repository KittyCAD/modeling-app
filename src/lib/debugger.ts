import { reportRejection } from '@src/lib/trap'
import { hasProperty } from '@src/lib/utils'

export interface ILog {
  time: number
  message: string
  stack: string
  label: string
  metadata: unknown
}

const REPORT_LOG_LIMIT = 200
const REPORT_STRING_LIMIT = 1024

type ReportMetadata =
  | string
  | number
  | boolean
  | null
  | { [key: string]: ReportMetadata }

interface DebugLogSnapshot {
  logs: {
    time: number
    label: string
    message: string
    metadata: ReportMetadata
  }[]
  totalLogCount: number
  truncated: boolean
}

// Only connection diagnostics belong in automatic reports. In particular, do
// not traverse event targets, settings, file paths, ICE candidates or commands.
const REPORT_METADATA_FIELDS = [
  'id',
  'apiCallId',
  'type',
  'name',
  'message',
  'code',
  'codeSummarized',
  'reason',
  'wasClean',
  'readyState',
  'connectionState',
  'iceConnectionState',
  'iceGatheringState',
  'signalingState',
  'kind',
  'terminal',
  'started',
  'connection',
  'startPingPongNeverCalled',
  'websocketClosed',
  'peerConnectionFailed',
  'peerConnectionDisconnected',
  'peerConnectionClosed',
  'dataChannelClosed',
  'reconnectRequested',
  'event',
  'error',
  'e',
  'options',
  'connectionError',
  'terminalConnectionError',
]

/**
 * A global runtime class that will live for the runtime of the application
 * that any part of the code base can push logs with addLog
 *
 * This is used in many locations to track the flow of code and events
 * that happen for the engine while the application is running.
 *
 * This is very useful when debugging the engine connection process.
 */
export class Debugger {
  logs: ILog[]
  constructor() {
    this.logs = []
  }

  getNow() {
    const isPerformanceSupported =
      window.performance &&
      // @ts-ignore this is a real check.
      window.performance.now &&
      window.performance.timing &&
      window.performance.timing.navigationStart

    const timeStampInMs = isPerformanceSupported
      ? window.performance.now() + window.performance.timing.navigationStart
      : Date.now()

    return timeStampInMs
  }

  addLog({
    message,
    label,
    metadata,
  }: {
    message: string
    label: string
    metadata?: unknown
  }) {
    this.logs.push({
      time: this.getNow(),
      message,
      stack: new Error().stack || '',
      label,
      metadata: metadata || null,
    })
  }

  snapshotForReport(maxLength: number): DebugLogSnapshot {
    const snapshot: DebugLogSnapshot = {
      logs: [],
      totalLogCount: this.logs.length,
      truncated: false,
    }
    const limitString = (value: string) => {
      if (value.length <= REPORT_STRING_LIMIT) return value
      snapshot.truncated = true
      return `${value.slice(0, REPORT_STRING_LIMIT)}[Truncated]`
    }

    let remainingMetadataValues = 0
    const summarizeMetadata = (value: unknown, depth = 0): ReportMetadata => {
      if (remainingMetadataValues-- <= 0 || depth > 3) {
        snapshot.truncated = true
        return '[Truncated]'
      }
      if (typeof value === 'string') return limitString(value)
      if (typeof value === 'number')
        return Number.isFinite(value) ? value : null
      if (typeof value === 'boolean' || value === null) return value
      if (typeof value !== 'object') return null

      const summary: Record<string, ReportMetadata> = {}
      for (const key of REPORT_METADATA_FIELDS) {
        try {
          // Reading named fields also captures non-enumerable Error/Event
          // properties, without invoking toJSON or following circular targets.
          if (hasProperty(value, key) && value[key] !== undefined) {
            summary[key] = summarizeMetadata(value[key], depth + 1)
          }
        } catch {
          snapshot.truncated = true
          summary[key] = '[Unavailable]'
        }
      }
      return summary
    }

    // Count serialized UTF-16 code units, a conservative bound on the API's
    // Unicode character limit. Reserve the envelope, including `false`.
    let length = JSON.stringify(snapshot).length
    const firstLog = Math.max(0, this.logs.length - REPORT_LOG_LIMIT)
    for (let i = this.logs.length - 1; i >= firstLog; i--) {
      const log = this.logs[i]
      remainingMetadataValues = 16
      const entry = {
        time: log.time,
        label: limitString(log.label),
        message: limitString(log.message),
        metadata: summarizeMetadata(log.metadata),
      }
      let entryLength =
        JSON.stringify(entry).length + (snapshot.logs.length ? 1 : 0)
      // Always retain the most recent event, even if its metadata alone would
      // exhaust the budget (JSON escaping can expand a string considerably).
      if (length + entryLength > maxLength && !snapshot.logs.length) {
        entry.metadata = '[Truncated]'
        snapshot.truncated = true
        entryLength = JSON.stringify(entry).length
        // Escaped labels and messages can still exceed the remaining budget.
        while (length + entryLength > maxLength) {
          if (
            entry.message.length >= entry.label.length &&
            entry.message.length > 1
          ) {
            entry.message = entry.message.slice(0, entry.message.length / 2)
          } else if (entry.label.length > 1) {
            entry.label = entry.label.slice(0, entry.label.length / 2)
          } else {
            break
          }
          entryLength = JSON.stringify(entry).length
        }
      }
      if (length + entryLength > maxLength) break
      length += entryLength
      snapshot.logs.push(entry)
    }
    snapshot.logs.reverse()
    snapshot.truncated ||= snapshot.logs.length < snapshot.totalLogCount
    return snapshot
  }

  writeToDisk() {
    if (window.electron) {
      window.electron
        .writeFile('/tmp/engineDebug.json', JSON.stringify(this.logs))
        .catch(reportRejection)
    }
  }
}

export const EngineDebugger = new Debugger()
