// A little class for updating the code state when we need to and explicitly
// NOT updating the code state when we don't need to.
// This prevents re-renders of the codemirror editor, when typing.
import { bracket } from 'lib/exampleKcl'
import { isDesktop } from 'lib/isDesktop'
import toast from 'react-hot-toast'
import { editorManager } from 'lib/singletons'
import { Annotation, Transaction } from '@codemirror/state'
import { EditorView, KeyBinding } from '@codemirror/view'
import { recast, Program } from 'lang/wasm'
import { err, reportRejection } from 'lib/trap'
import { Compartment } from '@codemirror/state'
import { history } from '@codemirror/commands'

const PERSIST_CODE_KEY = 'persistCode'

const codeManagerUpdateAnnotation = Annotation.define<boolean>()
export const codeManagerUpdateEvent = codeManagerUpdateAnnotation.of(true)
export const codeManagerHistoryCompartment = new Compartment()

export default class CodeManager {
  private _code: string = bracket
  #updateState: (arg: string) => void = () => {}
  private _currentFilePath: string | null = null
  private _hotkeys: { [key: string]: () => void } = {}
  private timeoutWriter: ReturnType<typeof setTimeout> | undefined = undefined

  public writeCausedByAppCheckedInFileTreeFileSystemWatcher = false

  constructor() {
    if (isDesktop()) {
      this.code = ''
      return
    }

    const storedCode = safeLSGetItem(PERSIST_CODE_KEY)
    // TODO #819 remove zustand persistence logic in a few months
    // short term migration, shouldn't make a difference for desktop app users
    // anyway since that's filesystem based.
    const zustandStore = JSON.parse(safeLSGetItem('store') || '{}')
    if (storedCode === null && zustandStore?.state?.code) {
      this.code = zustandStore.state.code
      zustandStore.state.code = ''
      safeLSSetItem('store', JSON.stringify(zustandStore))
    } else if (storedCode === null) {
      this.code = bracket
    } else {
      this.code = storedCode || ''
    }
  }

  set code(code: string) {
    this._code = code
  }

  get code(): string {
    return this._code
  }

  localStoragePersistCode(): string {
    return safeLSGetItem(PERSIST_CODE_KEY) || ''
  }

  registerCallBacks({ setCode }: { setCode: (arg: string) => void }) {
    this.#updateState = setCode
  }

  registerHotkey(hotkey: string, callback: () => void) {
    this._hotkeys[hotkey] = callback
  }

  getCodemirrorHotkeys(): KeyBinding[] {
    return Object.keys(this._hotkeys).map((key) => ({
      key,
      run: () => {
        this._hotkeys[key]()
        return false
      },
      preventDefault: true,
    }))
  }

  get currentFilePath(): string | null {
    return this._currentFilePath
  }

  updateCurrentFilePath(path: string) {
    this._currentFilePath = path
  }

  /**
   * This updates the code state and calls the updateState function.
   */
  updateCodeState(code: string): void {
    if (this._code !== code) {
      this.code = code
      this.#updateState(code)
    }
  }

  /**
   * Update the code in the editor.
   */
  updateCodeEditor(code: string, clearHistory?: boolean): void {
    this.code = code
    if (editorManager.editorView) {
      if (clearHistory) {
        clearCodeMirrorHistory(editorManager.editorView)
      }
      editorManager.editorView.dispatch({
        changes: {
          from: 0,
          to: editorManager.editorView.state.doc.length,
          insert: code,
        },
        annotations: [
          codeManagerUpdateEvent,
          Transaction.addToHistory.of(!clearHistory),
        ],
      })
    }
  }

  /**
   * Update the code, state, and the code the code mirror editor sees.
   */
  updateCodeStateEditor(code: string, clearHistory?: boolean): void {
    if (this._code !== code) {
      this.code = code
      this.#updateState(code)
      this.updateCodeEditor(code, clearHistory)
    }
  }

  async writeToFile() {
    if (isDesktop()) {
      // Only write our buffer contents to file once per second. Any faster
      // and file-system watchers which read, will receive empty data during
      // writes.

      clearTimeout(this.timeoutWriter)
      this.writeCausedByAppCheckedInFileTreeFileSystemWatcher = true

      return new Promise((resolve, reject) => {
        this.timeoutWriter = setTimeout(() => {
          if (!this._currentFilePath)
            return reject(new Error('currentFilePath not set'))

          // Wait one event loop to give a chance for params to be set
          // Save the file to disk
          window.electron
            .writeFile(this._currentFilePath, this.code ?? '')
            .then(resolve)
            .catch((err: Error) => {
              // TODO: add tracing per GH issue #254 (https://github.com/KittyCAD/modeling-app/issues/254)
              console.error('error saving file', err)
              toast.error('Error saving file, please check file permissions')
              reject(err)
            })
        }, 1000)
      })
    } else {
      safeLSSetItem(PERSIST_CODE_KEY, this.code)
    }
  }

  async updateEditorWithAstAndWriteToFile(ast: Program) {
    const newCode = recast(ast)
    if (err(newCode)) return
    this.updateCodeStateEditor(newCode)
    this.writeToFile().catch(reportRejection)
  }
}

function safeLSGetItem(key: string) {
  if (typeof window === 'undefined') return
  return localStorage?.getItem(key)
}

function safeLSSetItem(key: string, value: string) {
  if (typeof window === 'undefined') return
  localStorage?.setItem(key, value)
}

function clearCodeMirrorHistory(view: EditorView) {
  // Clear history
  view.dispatch({
    effects: [codeManagerHistoryCompartment.reconfigure([])],
    annotations: [codeManagerUpdateEvent],
  })

  // Add history back
  view.dispatch({
    effects: [codeManagerHistoryCompartment.reconfigure([history()])],
    annotations: [codeManagerUpdateEvent],
  })
}
