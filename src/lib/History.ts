import { signal } from '@preact/signals-react'
import { FileMeta } from '@src/lib/types'

type HistorySource = 'CodeEdit' | 'Zookeeper'

export interface HistoryEntry {
  type: string
  date: Date
  absoluteFilePath: string
  right: string
  left: string
  wroteToDisk: boolean
  source: HistorySource
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
