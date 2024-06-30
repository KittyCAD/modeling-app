import { foldService } from '@codemirror/language'
import { Extension, EditorState } from '@codemirror/state'
import { ViewPlugin } from '@codemirror/view'

import {
  docPathFacet,
  LanguageServerPlugin,
  LanguageServerPluginSpec,
  languageId,
  workspaceFolders,
  LanguageServerOptions,
} from './plugin/lsp'
import lspAutocompletionExt from './plugin/autocomplete'

export type { LanguageServerClientOptions } from './client'
export { LanguageServerClient } from './client'
export {
  Codec,
  FromServer,
  IntoServer,
  LspWorkerEventType,
} from './client/codec'
export type { LanguageServerOptions } from './plugin/lsp'
export type { TransactionInfo, RelevantUpdate } from './plugin/annotations'
export { updateInfo, TransactionAnnotation } from './plugin/annotations'
export {
  LanguageServerPlugin,
  LanguageServerPluginSpec,
  docPathFacet,
  languageId,
  workspaceFolders,
} from './plugin/lsp'
export { posToOffset, offsetToPos } from './plugin/util'

export function lspPlugin(options: LanguageServerOptions): Extension {
  let plugin: LanguageServerPlugin | null = null
  const viewPlugin = ViewPlugin.define(
    (view) => (plugin = new LanguageServerPlugin(options, view)),
    new LanguageServerPluginSpec()
  )

  let ext = [
    docPathFacet.of(options.documentUri),
    languageId.of('kcl'),
    workspaceFolders.of(options.workspaceFolders),
    viewPlugin,
    //lspAutocompletionExt(plugin),
      foldService.of(
        (state: EditorState, lineStart: number, lineEnd: number) => {
          if (plugin == null) return null
          // Get the folding ranges from the language server.
          // Since this is async we directly need to update the folding ranges after.
          return plugin?.foldingRange(lineStart, lineEnd)
        }
      )
  ]

  if (options.client.getServerCapabilities().foldingRangeProvider) {
    ext.push(
    )
  }

  return ext
}
