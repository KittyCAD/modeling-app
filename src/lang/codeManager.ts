// A little class for updating the code state when we need to and explicitly
// NOT updating the code state when we don't need to.
// This prevents re-renders of the codemirror editor, when typing.
import { bracket } from 'lib/exampleKcl'
import { isTauri } from 'lib/isTauri'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import toast from 'react-hot-toast'
import { editorManager } from 'lib/singletons'
import { KeyBinding } from '@uiw/react-codemirror'

const PERSIST_CODE_TOKEN = 'persistCode'

export default class CodeManager {
  private _code: string = bracket
  #updateState: (arg: string) => void = () => {}
  private _currentFilePath: string | null = null
  private _hotkeys: { [key: string]: () => void } = {}

  constructor() {
    if (isTauri()) {
      this.code = ''
      return
    }

    const storedCode = safeLSGetItem(PERSIST_CODE_TOKEN)
    // TODO #819 remove zustand persistence logic in a few months
    // short term migration, shouldn't make a difference for tauri app users
    // anyway since that's filesystem based.
    const zustandStore = JSON.parse(safeLSGetItem('store') || '{}')
    if (storedCode === null && zustandStore?.state?.code) {
      this.code = zustandStore.state.code
      zustandStore.state.code = ''
      safeLSSetItem('store', JSON.stringify(zustandStore))
    } else if (storedCode === null) {
      this.code = bracket
    } else {
      this.code = storedCode
    }
  }

  set code(code: string) {
    this._code = code
  }

  get code(): string {
    return this._code
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
    }))
  }

  updateCurrentFilePath(path: string) {
    this._currentFilePath = path
  }

  // This updates the code state and calls the updateState function.
  updateCodeState(code: string): void {
    if (this._code !== code) {
      this.code = code
      this.#updateState(code)
    }
  }

  // Update the code in the editor.
  updateCodeEditor(code: string): void {
    this.code = code
    if (editorManager.editorView) {
      editorManager.editorView.dispatch({
        changes: {
          from: 0,
          to: editorManager.editorView.state.doc.length,
          insert: code,
        },
      })
    }
  }

  // Update the code, state, and the code the code mirror editor sees.
  updateCodeStateEditor(code: string): void {
    if (this._code !== code) {
      this.code = code
      this.#updateState(code)
      this.updateCodeEditor(code)
    }
  }

  async writeToFile() {
    if (isTauri()) {
      setTimeout(() => {
        // Wait one event loop to give a chance for params to be set
        // Save the file to disk
        this._currentFilePath &&
          writeTextFile(this._currentFilePath, this.code).catch((err) => {
            // TODO: add tracing per GH issue #254 (https://github.com/KittyCAD/modeling-app/issues/254)
            console.error('error saving file', err)
            toast.error('Error saving file, please check file permissions')
          })
      })
    } else {
      safeLSSetItem(PERSIST_CODE_TOKEN, this.code)
    }
  }
}

function safeLSGetItem(key: string) {
  if (typeof window === 'undefined') return null
  return localStorage?.getItem(key)
}

function safeLSSetItem(key: string, value: string) {
  if (typeof window === 'undefined') return
  localStorage?.setItem(key, value)
}
