interface ILog {
  time: number
  message: string
  stack: string
  label: string
  metadata: any
}

export class Debugger {
  logs: ILog[];
  constructor () {
    this.logs = []
  }

  addLog ({
    message,
    label,
    metadata
  }:{
    message: string,
    label: string,
    metadata?: any
  }) {
    this.logs.push({
      time: Date.now(),
      message,
      stack: new Error().stack || '',
      label,
      metadata : metadata || null
    })
  }

  writeToDisk () {
    if (window.electron) {
      window.electron.writeFile('/tmp/engineDebug.json', JSON.stringify(this.logs))
    }
  }
}

export const EngineDebugger = new Debugger()
window.logs = EngineDebugger
