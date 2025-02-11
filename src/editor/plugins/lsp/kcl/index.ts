import { Extension } from '@codemirror/state'
import { ViewPlugin, PluginValue, ViewUpdate } from '@codemirror/view'
import {
  LanguageServerOptions,
  LanguageServerClient,
  lspPlugin,
  lspFormatCodeEvent,
} from '@kittycad/codemirror-lsp-client'
import { deferExecution } from 'lib/utils'
import { codeManager, editorManager, kclManager } from 'lib/singletons'
import { UpdateUnitsParams } from 'wasm-lib/kcl/bindings/UpdateUnitsParams'
import { UpdateCanExecuteParams } from 'wasm-lib/kcl/bindings/UpdateCanExecuteParams'
import { UpdateUnitsResponse } from 'wasm-lib/kcl/bindings/UpdateUnitsResponse'
import { UpdateCanExecuteResponse } from 'wasm-lib/kcl/bindings/UpdateCanExecuteResponse'
import { codeManagerUpdateEvent } from 'lang/codeManager'
import { copilotPluginEvent } from '../copilot'
import { updateOutsideEditorEvent } from 'editor/manager'

const changesDelay = 600

// A view plugin that requests completions from the server after a delay
export class KclPlugin implements PluginValue {
  private viewUpdate: ViewUpdate | null = null
  private client: LanguageServerClient

  constructor(client: LanguageServerClient) {
    this.client = client

    // Gotcha: Code can be written into the CodeMirror editor but not propagated to codeManager.code
    // because the update function has not run. We need to initialize the codeManager.code when lsp initializes
    // because new code could have been written into the editor before the update callback is initialized.
    // There appears to be limited ways to safely get the current doc content. This appears to be sync and safe.
    const kclLspPlugin = this.client.plugins.find((plugin) => {
      return plugin.client.name === 'kcl'
    })
    if (kclLspPlugin) {
      // @ts-ignore Ignoring this private dereference of .view on the plugin. I do not have another helper method that can give me doc string
      codeManager.code = kclLspPlugin.view.state.doc.toString()
    }
  }

  // When a doc update needs to be sent to the server, this holds the
  // timeout handle for it. When null, the server has the up-to-date
  // document.
  private sendScheduledInput: number | null = null

  private _deffererUserSelect = deferExecution(() => {
    if (this.viewUpdate === null) {
      return
    }

    editorManager.handleOnViewUpdate(this.viewUpdate)
  }, 50)

  update(viewUpdate: ViewUpdate) {
    this.viewUpdate = viewUpdate
    editorManager.setEditorView(viewUpdate.view)

    let isUserSelect = false
    let isRelevant = viewUpdate.docChanged
    for (const tr of viewUpdate.transactions) {
      if (tr.isUserEvent('select')) {
        isUserSelect = true
      } else if (tr.isUserEvent('input')) {
        isRelevant = true
      } else if (tr.isUserEvent('delete')) {
        isRelevant = true
      } else if (tr.isUserEvent('undo')) {
        isRelevant = true
      } else if (tr.isUserEvent('redo')) {
        isRelevant = true
      } else if (tr.isUserEvent('move')) {
        isRelevant = true
      } else if (tr.annotation(lspFormatCodeEvent.type)) {
        isRelevant = true
      }

      // Don't make this an else.
      if (tr.annotation(codeManagerUpdateEvent.type)) {
        // We want to ignore when we are forcing the editor to update.
        isRelevant = false
        break
      } else if (tr.annotation(copilotPluginEvent.type)) {
        // We want to ignore when copilot is doing stuff.
        isRelevant = false
        break
      } else if (tr.annotation(updateOutsideEditorEvent.type)) {
        // We want to ignore other events outside the editor.
        isRelevant = false
        break
      }
    }

    // If we have a user select event, we want to update what parts are
    // highlighted.
    if (isUserSelect) {
      this._deffererUserSelect(true)
      return
    }

    if (!isRelevant) {
      return
    }

    if (!viewUpdate.docChanged) {
      return
    }

    const newCode = viewUpdate.state.doc.toString()
    codeManager.code = newCode

    void codeManager.writeToFile().then(() => {
      this.scheduleUpdateDoc()
    })
  }

  scheduleUpdateDoc() {
    if (this.sendScheduledInput != null)
      window.clearTimeout(this.sendScheduledInput)
    this.sendScheduledInput = window.setTimeout(
      () => this.updateDoc(),
      changesDelay
    )
  }

  updateDoc() {
    if (this.sendScheduledInput != null) {
      window.clearTimeout(this.sendScheduledInput)
      this.sendScheduledInput = null
    }

    if (!this.client.ready) return
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    kclManager.executeCode()
  }

  ensureDocUpdated() {
    if (this.sendScheduledInput != null) this.updateDoc()
  }

  async updateUnits(
    params: UpdateUnitsParams
  ): Promise<UpdateUnitsResponse | null> {
    return this.client.requestCustom('kcl/updateUnits', params)
  }

  async updateCanExecute(
    params: UpdateCanExecuteParams
  ): Promise<UpdateCanExecuteResponse> {
    return this.client.requestCustom('kcl/updateCanExecute', params)
  }
}

export function kclPlugin(options: LanguageServerOptions): Extension {
  return [
    lspPlugin(options),
    ViewPlugin.define(() => new KclPlugin(options.client)),
  ]
}
