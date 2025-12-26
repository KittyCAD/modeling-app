import { signal } from '@preact/signals-react'

export interface HistoryEntry {
  type: string
  date: Date
  absoluteFilePath: string
  right: string
  left: string
  wroteToDisk: boolean
}

export class History {
  public entries = signal<HistoryEntry[]>([])
  public lastEntrySelected = signal<HistoryEntry | null>(null)
  private _maxLength = 100
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
