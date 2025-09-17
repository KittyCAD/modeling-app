import { uuidv4 } from '@src/lib/utils'
import type EditorManager from '@src/editor/manager'
import { redoDepth, undoDepth } from '@codemirror/commands'

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
  emitChange: () => void
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
  emitChange() {
    for (const fn of this.subscribers) {
      fn()
    }
  }
}

export enum HistoryStackNames {
  Editor = 'editor',
  FileExplorer = 'file-explorer',
  TextToCAD = 'text-to-cad',
}

export class HistoryService implements Subscribable {
  stacks: Map<HistoryStackNames, Stack> = new Map()
  _currentStackId: HistoryStackNames = HistoryStackNames.Editor
  #editorManager: EditorManager
  _snapshot = {
    canUndo: this.canUndo(),
    canRedo: this.canRedo(),
    currentStack: this.stacks.get(this.currentStackId),
    currentStackId: this.currentStackId,
  }
  subscribers = new Set<Listener>()
  id: string

  constructor({ editorManager }: { editorManager: EditorManager }) {
    this.id = uuidv4()
    console.warn('FRANK WHEN DOES THIS RUN?', this.id)
    this.#editorManager = editorManager
    for (const s of Object.values(HistoryStackNames)) {
      this.stacks.set(s as HistoryStackNames, new Stack())
    }
  }

  get currentStackId() {
    return this._currentStackId
  }
  set currentStackId(newStack: HistoryStackNames) {
    this._currentStackId = newStack
    this.takeSnapshot()
    this.emitChange()
  }

  canUndo() {
    if (
      this.#editorManager &&
      this.currentStackId === HistoryStackNames.Editor
    ) {
      return undoDepth(this.#editorManager.state) > 0
    }

    return this.stacks.get(this.currentStackId)?.canUndo() || false
  }
  canRedo() {
    if (
      this.#editorManager &&
      this.currentStackId === HistoryStackNames.Editor
    ) {
      return redoDepth(this.#editorManager.state) > 0
    }

    return this.stacks.get(this.currentStackId)?.canRedo() || false
  }

  async undo() {
    if (this.canUndo()) {
      if (this.currentStackId === HistoryStackNames.Editor) {
        this.#editorManager.undo()
      } else {
        await this.stacks.get(this.currentStackId)?.undo()
      }
      this.emitChange()
    }
  }
  async redo() {
    if (this.canRedo()) {
      if (this.currentStackId === HistoryStackNames.Editor) {
        this.#editorManager.redo()
      } else {
        await this.stacks.get(this.currentStackId)?.redo()
      }
      this.emitChange()
    }
  }
  addItem(newItem: Omit<HistoryItem, 'id'>, stackId = this.currentStackId) {
    this.stacks.get(stackId)?.addItem(newItem)
    this.emitChange()
  }

  subscribe = (fn: Listener) => {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }
  takeSnapshot = () => {
    this._snapshot.canUndo = this.canUndo()
    this._snapshot.canRedo = this.canRedo()
    this._snapshot.currentStackId = this.currentStackId
    this._snapshot.currentStack = this.stacks.get(this.currentStackId)
  }
  getSnapshot = () => this._snapshot
  emitChange() {
    for (const fn of this.subscribers) {
      fn()
    }
  }
}
