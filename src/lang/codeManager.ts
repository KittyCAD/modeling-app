// A little class for updating the code state when we need to and explicitly
// NOT updating the code state when we don't need to.
// This prevents re-renders of the codemirror editor, when typing.
import { bracket } from 'lib/exampleKcl'
import { isTauri } from 'lib/isTauri'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import toast from 'react-hot-toast'
import { Params } from 'react-router-dom'

const PERSIST_CODE_TOKEN = 'persistCode'

export default class CodeManager {
  private _code: string = bracket
  private _updateState: (arg: string) => void = () => {}
  private _updateEditor: (arg: string) => void = () => {}
  private _params: Params<string> = {}

  constructor() {
    if (isTauri()) {
      this.code = ''
      return
    }

    const storedCode = safeLSGetItem(PERSIST_CODE_TOKEN) || ''
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

  registerCallBacks({
    setCode,
    setEditorCode,
  }: {
    setCode: (arg: string) => void
    setEditorCode: (arg: string) => void
  }) {
    this._updateState = setCode
    this._updateEditor = setEditorCode
  }

  setParams(params: Params<string>) {
    this._params = params
  }

  // This updates the code state and calls the updateState function.
  updateCodeState(code: string): void {
    if (this._code !== code) {
      this.code = code
      this._updateState(code)
    }
  }

  // Update the code in the editor.
  updateCodeEditor(code: string): void {
    if (this._code !== code) {
      this.code = code
      this._updateEditor(code)
    }
    this._updateEditor(code)
  }

  // Update the code, state, and the code the code mirror editor sees.
  updateCodeStateEditor(code: string): void {
    if (this._code !== code) {
      this.code = code
      this._updateState(code)
      this._updateEditor(code)
    }
  }

  async writeToFile() {
    if (isTauri()) {
      setTimeout(() => {
        // Wait one event loop to give a chance for params to be set
        // Save the file to disk
        this._params.id &&
          writeTextFile(this._params.id, this.code).catch((err) => {
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
