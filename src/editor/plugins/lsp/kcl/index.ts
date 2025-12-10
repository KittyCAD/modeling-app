import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { LanguageServerOptions } from '@kittycad/codemirror-lsp-client'
import { lspPlugin } from '@kittycad/codemirror-lsp-client'
import {
  updateOutsideEditorEvent,
  editorCodeUpdateEvent,
  type KclManager,
} from '@src/lang/KclManager'

import { copilotPluginEvent } from '@src/editor/plugins/lsp/copilot'
import { processCodeMirrorRanges } from '@src/lib/selections'
import { deferExecution } from '@src/lib/utils'

/** Debounce for execution in ms */
const changesDelay = 600

export function kclPlugin(
  options: LanguageServerOptions,
  systemDeps: {
    kclManager: KclManager
  }
): Extension {
  /**
   * This is a CodeMirror extension that listens for selection events
   * and fires off engine commands to highlight the corresponding engine entities.
   * It is not debounced.
   */
  const highlightEngineEntitiesEffect = EditorView.updateListener.of(
    (update) => {
      if (update.transactions.some((tr) => tr.isUserEvent('select'))) {
        systemDeps.kclManager.handleOnViewUpdate(
          update,
          processCodeMirrorRanges
        )
      }
    }
  )

  const executeKclDeferred = deferExecution(
    async ({ newCode }: { newCode: string }) => {
      void systemDeps.kclManager.writeToFile(newCode)
      await systemDeps.kclManager.executeCode(newCode)
    },
    changesDelay
  )

  /**
   * This is a CodeMirror extension that watches for updates to the document,
   * discerns if the change is a kind that we want to re-execute on,
   * then fires (and forgets) an execution with a debounce.
   */
  const executeKclEffect = EditorView.updateListener.of((update) => {
    const shouldExecute =
      update.docChanged &&
      update.transactions.some((tr) => {
        // The old KCL ViewPlugin had checks that seemed to check for
        // certain events, but really they just set the already-true to true.
        // Leaving here in case we need to switch to an opt-in listener.
        // const relevantEvents = [
        //   tr.isUserEvent('input'),
        //   tr.isUserEvent('delete'),
        //   tr.isUserEvent('undo'),
        //   tr.isUserEvent('redo'),
        //   tr.isUserEvent('move'),
        //   tr.annotation(lspRenameEvent.type),
        //   tr.annotation(lspCodeActionEvent.type),
        // ]
        const ignoredEvents = [
          tr.annotation(editorCodeUpdateEvent.type),
          tr.annotation(copilotPluginEvent.type),
          tr.annotation(updateOutsideEditorEvent.type),
        ]

        return !ignoredEvents.some((v) => Boolean(v))
      })

    if (shouldExecute) {
      const newCode = update.state.doc.toString()
      executeKclDeferred({ newCode })
    }
  })

  return [lspPlugin(options), highlightEngineEntitiesEffect, executeKclEffect]
}
