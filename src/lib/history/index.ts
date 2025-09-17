import { useMemo, useSyncExternalStore } from 'react'
import { uuidv4 } from '@src/lib/utils'

interface HistoryItem {
  id: string
  label?: string
  undo: () => Promise<void>
  redo: () => Promise<void>
}

interface HistoryStack {
  stack: HistoryItem[]
  cursor: number | null
  undo: () => Promise<void>
  redo: () => Promise<void>
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
  stack: HistoryItem[] = []
  _cursor = 0
  _snapshot = {
    queue: this.stack,
    cursor: this._cursor,
    canUndo: this.canUndo(),
    canRedo: this.canRedo(),
  }
  subscribers = new Set<Listener>()

  async undo() {
    console.log('undoing', this.stack, this.cursor, this.canUndo())
    if (this.canUndo()) {
      await this.stack[this.cursor]
        .undo()
        .then(() => {
          this.cursor--
          this._snapshot = this.takeSnapshot()
        })
        .catch((e) => console.warn('failed to undo:', e))
    }
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
    console.log('redoing', this.stack, this.cursor, this.canRedo())
    if (this.canRedo()) {
      await this.stack[this.cursor + 1]
        .redo()
        .then(() => {
          this.cursor++
          this._snapshot = this.takeSnapshot()
        })
        .catch((e) => console.warn('failed to redo', e))
    }
  }

  canUndo() {
    return this.stack.length > 0 && this.cursor > -1
  }
  canRedo() {
    return this.stack.length > 0 && this.cursor < this.stack.length - 1
  }

  addItem(item: Omit<HistoryItem, 'id'>) {
    console.log('adding item', this.canRedo())
    if (this.canRedo()) {
      // Clear the redo portion of the history stack
      this.stack = this.cursor < 0 ? [] : this.stack.slice(0, this.cursor + 1)
    }
    this.stack.push(Object.assign(item, { id: uuidv4() }))
    this.cursor = this.stack.length - 1
    console.log('adding item', this.stack, this.cursor)
    this._snapshot = this.takeSnapshot()
  }

  subscribe = (fn: Listener) => {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }
  takeSnapshot = () => ({
    queue: this.stack,
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
