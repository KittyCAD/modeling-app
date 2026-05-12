import { signal } from '@preact/signals-react'
import { FileMeta } from '@src/lib/types'

type HistorySource = 'CodeEdit' | 'Zookeeper'

export const historyFormatter = (history: HistorySource) => {
  switch (history) {
    case 'CodeEdit':
      return 'edit'
    case 'Zookeeper':
      return 'Zookeeper'
    default:
      ;('unsupported add a history formatter')
  }
}

export interface HistoryEntry {
  type: string
  date: Date
  absoluteFilePath: string
  right: string
  left: string
  wroteToDisk: boolean
  source: HistorySource
  deleted: boolean
}

export class History {
  public entries = signal<HistoryEntry[]>([])
  public lastEntrySelected = signal<HistoryEntry | null>(null)
  private _maxLength = 100
  public filesCachedFromPrompt = signal<FileMeta[]>([])
  constructor() {}

  get maxLength() {
    return this._maxLength
  }

  push(entry: HistoryEntry) {
    this.entries.value = [entry, ...this.entries.value]

    if (this.entries.value.length >= this._maxLength) {
      const allButTheEnd = [...this.entries.value]
      allButTheEnd.pop()
      this.entries.value = allButTheEnd
    }
  }

  markWroteToDisk(index: number) {
    const entries = [...this.entries.value]
    entries[index].wroteToDisk = true
    this.entries.value = entries
  }
}
