import { Extension } from '@codemirror/state'
import { ViewPlugin, PluginValue, ViewUpdate } from '@codemirror/view'
import {
  LanguageServerOptions,
  LanguageServerPlugin,
  updateInfo,
  TransactionInfo,
  RelevantUpdate,
  TransactionAnnotation,
} from '@kittycad/codemirror-lsp-client'
import { deferExecution } from 'lib/utils'
import { codeManager, editorManager, kclManager } from 'lib/singletons'

const changesDelay = 600

export const relevantUpdate = (update: ViewUpdate): RelevantUpdate => {
  const infos = updateInfo(update)
  // Make sure we are not in a snippet
  if (infos.some((info: TransactionInfo) => info.inSnippet)) {
    return {
      overall: false,
      userSelect: false,
      time: null,
    }
  }
  return {
    overall: infos.some(
      (info: TransactionInfo) =>
        info.annotations.includes(TransactionAnnotation.UserSelect) ||
        info.annotations.includes(TransactionAnnotation.UserInput) ||
        info.annotations.includes(TransactionAnnotation.UserDelete) ||
        info.annotations.includes(TransactionAnnotation.UserUndo) ||
        info.annotations.includes(TransactionAnnotation.UserRedo) ||
        info.annotations.includes(TransactionAnnotation.UserMove)
    ),
    userSelect: infos.some((info: TransactionInfo) =>
      info.annotations.includes(TransactionAnnotation.UserSelect)
    ),
    time: infos.length ? infos[0].time : null,
  }
}

// A view plugin that requests completions from the server after a delay
export class KclPlugin implements PluginValue {
  private viewUpdate: ViewUpdate | null = null

  private _deffererCodeUpdate = deferExecution(() => {
    if (this.viewUpdate === null) {
      return
    }

    kclManager.executeCode()
  }, changesDelay)

  private _deffererUserSelect = deferExecution(() => {
    if (this.viewUpdate === null) {
      return
    }

    editorManager.handleOnViewUpdate(this.viewUpdate)
  }, 50)

  update(viewUpdate: ViewUpdate) {
    this.viewUpdate = viewUpdate
    editorManager.setEditorView(viewUpdate.view)

    const isRelevant = relevantUpdate(viewUpdate)
    if (!isRelevant.overall) {
      return
    }

    // If we have a user select event, we want to update what parts are
    // highlighted.
    if (isRelevant.userSelect) {
      this._deffererUserSelect(true)
      return
    }

    if (!viewUpdate.docChanged) {
      return
    }

    const newCode = viewUpdate.state.doc.toString()
    codeManager.code = newCode
    codeManager.writeToFile()

    this._deffererCodeUpdate(true)
  }
}

export function kclPlugin(options: LanguageServerOptions): Extension {
  let plugin: LanguageServerPlugin | null = null
  const viewPlugin = ViewPlugin.define(
    (view) => (plugin = new LanguageServerPlugin(options, view))
  )

  return [viewPlugin, ViewPlugin.define((view) => new KclPlugin())]
}
