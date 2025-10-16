// A little class for updating the code state when we need to and explicitly
// NOT updating the code state when we don't need to.
// This prevents re-renders of the codemirror editor, when typing.
import { history } from '@codemirror/commands'
import { Annotation, Transaction } from '@codemirror/state'
import type { KeyBinding } from '@codemirror/view'
import toast from 'react-hot-toast'

import { historyCompartment } from '@src/editor/compartments'
import type { Program } from '@src/lang/wasm'
import { parse, recast } from '@src/lang/wasm'
import { bracket } from '@src/lib/exampleKcl'
import { isDesktop } from '@src/lib/isDesktop'
import { err, reportRejection } from '@src/lib/trap'
import type EditorManager from '@src/editor/manager'
import { ModuleType } from '@src/lib/wasm_lib_wrapper'

const PERSIST_CODE_KEY = 'persistCode'

const codeManagerUpdateAnnotation = Annotation.define<boolean>()
export const codeManagerUpdateEvent = codeManagerUpdateAnnotation.of(true)

export default class CodeManager {
  private _code: string = bracket
  #updateState: (arg: string) => void = () => { }
  private _currentFilePath: string | null = null
  private _hotkeys: { [key: string]: () => void } = {}
  private timeoutWriter: ReturnType<typeof setTimeout> | undefined = undefined

  public writeCausedByAppCheckedInFileTreeFileSystemWatcher = false

  public isBufferMode = false
  public editorManager: EditorManager

  constructor({ editorManager }: { editorManager: EditorManager }) {
    this.editorManager = editorManager

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
   * This is invoked when a segment is being dragged on the canvas, among other things.
   */
  updateCodeEditor(code: string, clearHistory?: boolean): void {
    this.code = code
    if (clearHistory) {
      clearCodeMirrorHistory(this.editorManager)
    }
    this.editorManager.dispatch({
      changes: {
        from: 0,
        to: this.editorManager.editorState?.doc.length || 0,
        insert: code,
      },
      annotations: [
        codeManagerUpdateEvent,
        Transaction.addToHistory.of(!clearHistory),
      ],
    })
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
    if (this.isBufferMode) return

    if (window.electron) {
      const electron = window.electron
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
          electron
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

  async updateEditorWithAstAndWriteToFile(
    ast: Program,
    options?: Partial<{ isDeleting: boolean }>,
    wasmInstance?: ModuleType
  ) {
    // We clear the AST when it cannot be parsed. If we are trying to write an
    // empty AST, it's probably because of an earlier error. That's a bad state
    // to be in, and it's not going to be pretty, but at the least, let's not
    // permanently delete the user's code accidentally.
    // if you want to clear the scene, pass in the `isDeleting` option.
    if (ast.body.length === 0 && !options?.isDeleting) return
    const newCode = recast(ast, wasmInstance)
    if (err(newCode)) return
    // Test to see if we can parse the recast code, and never update the editor with bad code.
    // This should never happen ideally and should mean there is a bug in recast.
    const result = parse(newCode, wasmInstance)
    if (err(result)) {
      console.log('Recast code could not be parsed:', result, ast)
      return
    }
    this.updateCodeStateEditor(newCode)
    this.writeToFile().catch(reportRejection)
  }

  goIntoTemporaryWorkspaceModeWithCode(code: string) {
    this.isBufferMode = true
    this.updateCodeStateEditor(code, true)
  }

  exitFromTemporaryWorkspaceMode() {
    this.isBufferMode = false
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

function clearCodeMirrorHistory(editorManager: EditorManager) {
  // Clear history
  editorManager.dispatch({
    effects: [historyCompartment.reconfigure([])],
    annotations: [codeManagerUpdateEvent],
  })

  // Add history back
  editorManager.dispatch({
    effects: [historyCompartment.reconfigure([history()])],
    annotations: [codeManagerUpdateEvent],
  })
}
