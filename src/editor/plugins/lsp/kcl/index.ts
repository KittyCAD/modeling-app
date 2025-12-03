import type { Extension } from '@codemirror/state'
import type { EditorView, PluginValue, ViewUpdate } from '@codemirror/view'
import { ViewPlugin } from '@codemirror/view'
import type {
  LanguageServerClient,
  LanguageServerOptions,
} from '@kittycad/codemirror-lsp-client'
import {
  lspCodeActionEvent,
  lspFormatCodeEvent,
  lspPlugin,
  lspRenameEvent,
} from '@kittycad/codemirror-lsp-client'
import {
  updateOutsideEditorEvent,
  editorCodeUpdateEvent,
} from '@src/lang/KclManager'
import { kclManager, rustContext } from '@src/lib/singletons'
import { deferExecution } from '@src/lib/utils'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'

import type { UpdateCanExecuteParams } from '@rust/kcl-lib/bindings/UpdateCanExecuteParams'
import type { UpdateCanExecuteResponse } from '@rust/kcl-lib/bindings/UpdateCanExecuteResponse'
import type { UpdateUnitsParams } from '@rust/kcl-lib/bindings/UpdateUnitsParams'
import type { UpdateUnitsResponse } from '@rust/kcl-lib/bindings/UpdateUnitsResponse'

import { copilotPluginEvent } from '@src/editor/plugins/lsp/copilot'
import { processCodeMirrorRanges } from '@src/lib/selections'

const changesDelay = 600

/** A view plugin that requests completions from the server after a delay */
export class KclPlugin implements PluginValue {
  private viewUpdate: ViewUpdate | null = null
  private client: LanguageServerClient

  constructor(client: LanguageServerClient, view: EditorView) {
    this.client = client

    // Gotcha: Code can be written into the CodeMirror editor but not propagated to kclManager.code
    // because the update function has not run. We need to initialize the kclManager.code when lsp initializes
    // because new code could have been written into the editor before the update callback is initialized.
    // There appears to be limited ways to safely get the current doc content. This appears to be sync and safe.
    const kclLspPlugin = this.client.plugins.find((plugin) => {
      return plugin.client.name === 'kcl'
    })
    if (kclLspPlugin) {
      kclManager.code = view.state.doc.toString()
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

    kclManager.handleOnViewUpdate(this.viewUpdate, processCodeMirrorRanges)
  }, 50)

  update(viewUpdate: ViewUpdate) {
    this.viewUpdate = viewUpdate
    kclManager.setEditorView(viewUpdate.view)

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
      // This is ON because the artifact graph and ast will be stale if we
      // don't update the world.
      // Also, then the file won't be saved.
      else if (tr.annotation(lspRenameEvent.type)) {
        isRelevant = true
      } else if (tr.annotation(lspCodeActionEvent.type)) {
        isRelevant = true
      }

      // Don't make this an else.
      if (tr.annotation(editorCodeUpdateEvent.type)) {
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
    kclManager.code = newCode

    void kclManager.writeToFile().then(() => {
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

    const clearSelections = true // no reason to keep them after a manual edit
    if (!this.client.ready)
      return // eslint-disable-next-line @typescript-eslint/no-floating-promises
      // If we're in sketchSolveMode, update Rust state with the latest AST
      // This handles the case where the user directly edits in the CodeMirror editor
      // these are short term hacks while in rapid development for sketch revamp
      // should be clean up.
    ;(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modelingState = (kclManager as any)._modelingState
      if (modelingState?.matches('sketchSolveMode')) {
        try {
          await kclManager.executeCode(clearSelections)
          await rustContext.hackSetProgram(
            kclManager.ast,
            await jsAppSettings()
          )
          console.log('rustContext', rustContext)
        } catch (error) {
          console.error('Error calling hackSetProgram after user edit:', error)
        }
      } else {
        await kclManager.executeCode(clearSelections)
      }
    })().catch((error) => {
      console.error(
        'Unexpected error when updating Rust state after user edit:',
        error
      )
    })
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
    ViewPlugin.define((view) => new KclPlugin(options.client, view)),
  ]
}
