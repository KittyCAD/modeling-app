import { reportRejection } from '@src/lib/trap'

export interface ILog {
  time: number
  message: string
  stack: string
  label: string
  metadata: any
}

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
    metadata?: any
  }) {
    this.logs.push({
      time: this.getNow(),
      message,
      stack: new Error().stack || '',
      label,
      metadata: metadata || null,
    })
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
