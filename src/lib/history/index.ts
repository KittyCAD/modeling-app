interface HistoryItem {
  id: string
  label?: string
  undo: () => Promise<boolean>
  redo: () => Promise<boolean>
}

interface History {
  queue: HistoryItem[]
  point: number | null
  undo: () => Promise<boolean>
  redo: () => Promise<boolean>
  addItem: (item: HistoryItem) => void
  canUndo: () => boolean
}

export class HistoryService implements History {
  queue: HistoryItem[] = []
  _point = 0
  lastUpdate = Date.now()

  async undo() {
    console.log('undoing', this.queue, this.point, this.canUndo())
    if (this.canUndo()) {
      const result = await this.queue[this.point].undo()
      this.point--
      return result
    }
    return false
  }

  get point() {
    return this._point
  }

  set point(newPoint: number) {
    console.log('setting point to ', newPoint)
    this._point = newPoint
  }

  async redo() {
    console.log('redoing', this.queue, this.point, this.canRedo())
    if (this.canRedo()) {
      const result = await this.queue[this.point + 1].redo()
      this.point++
      return result
    }
    return false
  }

  canUndo() {
    return this.queue.length > 0 && this.point > -1
  }
  canRedo() {
    return this.queue.length > 0 && this.point < this.queue.length - 1
  }

  addItem(item: HistoryItem) {
    console.log('adding item', this.canRedo())
    if (this.canRedo()) {
      // Clear the redo portion of the history stack
      this.queue = this.point < 0 ? [] : this.queue.slice(0, this.point + 1)
    }
    this.queue.push(item)
    this.point = this.queue.length - 1
    this.lastUpdate = Date.now()
    console.log('adding item', this.queue, this.point)
  }
}
