import { Compartment, Prec, type Extension } from '@codemirror/state'
import { ViewPlugin } from '@codemirror/view'
import type {
  LanguageServerClient,
  LanguageServerPlugin,
} from '@kittycad/codemirror-lsp-client'
import { effect, untracked, type ReadonlySignal } from '@preact/signals-core'
import { kcl } from '@src/lang/lsp/kcl/language'
import type * as LSP from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'

/** The view owns its document plugin, including rebinding after worker restarts. */
export function createProjectLspExtension({
  documentUri,
  client,
  start,
}: {
  documentUri: string
  client: ReadonlySignal<LanguageServerClient | null>
  start: () => void
}): Extension {
  const compartment = new Compartment()
  return [
    compartment.of([]),
    ViewPlugin.define((view) => {
      let alive = true
      let revision = 0
      untracked(start)
      const stop = effect(() => {
        const current = client.value
        const nextRevision = ++revision
        // CodeMirror forbids dispatch during plugin construction or destruction.
        queueMicrotask(() => {
          if (!alive || revision !== nextRevision) return
          view.dispatch({
            effects: compartment.reconfigure(
              current
                ? Prec.highest(
                    kcl({
                      // The legacy client accepts a path; our boundary accepts a file URI.
                      documentUri: URI.parse(documentUri).fsPath,
                      workspaceFolders: [],
                      client: current,
                      processLspNotification: processKclLspNotification,
                    })
                  )
                : []
            ),
          })
        })
      })
      return {
        destroy: () => {
          alive = false
          stop()
        },
      }
    }),
  ]
}

function processKclLspNotification(
  plugin: LanguageServerPlugin,
  notification: LSP.NotificationMessage
) {
  try {
    switch (notification.method) {
      case 'kcl/astUpdated':
        void plugin.updateFoldingRanges()
        void plugin.requestSemanticTokens()
        break
    }
  } catch (error) {
    console.error(error)
  }
}
