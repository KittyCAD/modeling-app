interface HistoryItem {
  id: string
  label?: string
  undo: () => Promise<boolean>
  redo: () => Promise<boolean>
}

interface HistoryStack {
  queue: HistoryItem[]
  cursor: number | null
  undo: () => Promise<boolean>
  redo: () => Promise<boolean>
  addItem: (item: HistoryItem) => void
  canUndo: () => boolean
}

export class Stack implements HistoryStack {
  queue: HistoryItem[] = []
  _cursor = 0

  async undo() {
    console.log('undoing', this.queue, this.cursor, this.canUndo())
    if (this.canUndo()) {
      const result = await this.queue[this.cursor].undo()
      this.cursor--
      return result
    }
    return false
  }

  get cursor() {
    return this._cursor
  }

  set cursor(newPoint: number) {
    console.log('setting point to ', newPoint)
    this._cursor = newPoint
  }

  async redo() {
    console.log('redoing', this.queue, this.cursor, this.canRedo())
    if (this.canRedo()) {
      const result = await this.queue[this.cursor + 1].redo()
      this.cursor++
      return result
    }
    return false
  }

  canUndo() {
    return this.queue.length > 0 && this.cursor > -1
  }
  canRedo() {
    return this.queue.length > 0 && this.cursor < this.queue.length - 1
  }

  addItem(item: HistoryItem) {
    console.log('adding item', this.canRedo())
    if (this.canRedo()) {
      // Clear the redo portion of the history stack
      this.queue = this.cursor < 0 ? [] : this.queue.slice(0, this.cursor + 1)
    }
    this.queue.push(item)
    this.cursor = this.queue.length - 1
    console.log('adding item', this.queue, this.cursor)
  }
}
