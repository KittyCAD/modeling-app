import { useMemo, useSyncExternalStore } from 'react'
import { uuidv4 } from '@src/lib/utils'

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

type Listener = () => void
interface Subscribable {
  subscribers: Set<Listener>
  subscribe: (l: Listener) => () => void
  getSnapshot: () => object
  emit: () => void
}

export class Stack implements HistoryStack, Subscribable {
  queue: HistoryItem[] = []
  _cursor = 0
  _snapshot = {
    queue: this.queue,
    cursor: this._cursor,
    canUndo: this.canUndo(),
    canRedo: this.canRedo(),
  }
  subscribers = new Set<Listener>()

  async undo() {
    console.log('undoing', this.queue, this.cursor, this.canUndo())
    if (this.canUndo()) {
      const result = await this.queue[this.cursor].undo()
      this.cursor--
      this._snapshot = this.takeSnapshot()
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
    this._snapshot = this.takeSnapshot()
  }

  async redo() {
    console.log('redoing', this.queue, this.cursor, this.canRedo())
    if (this.canRedo()) {
      const result = await this.queue[this.cursor + 1].redo()
      this.cursor++
      this._snapshot = this.takeSnapshot()
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

  addItem(item: Omit<HistoryItem, 'id'>) {
    console.log('adding item', this.canRedo())
    if (this.canRedo()) {
      // Clear the redo portion of the history stack
      this.queue = this.cursor < 0 ? [] : this.queue.slice(0, this.cursor + 1)
    }
    this.queue.push(Object.assign(item, { id: uuidv4() }))
    this.cursor = this.queue.length - 1
    console.log('adding item', this.queue, this.cursor)
    this._snapshot = this.takeSnapshot()
  }

  subscribe = (fn: Listener) => {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }
  takeSnapshot = () => ({
    queue: this.queue,
    cursor: this._cursor,
    canUndo: this.canUndo(),
    canRedo: this.canRedo(),
  })
  getSnapshot = () => this._snapshot
  emit() {
    for (const fn of this.subscribers) {
      fn()
    }
  }
}

export function useStack(instance?: Stack) {
  const stack = useMemo(() => instance ?? new Stack(), [instance])
  return useSyncExternalStore(stack.subscribe, stack.getSnapshot)
}
