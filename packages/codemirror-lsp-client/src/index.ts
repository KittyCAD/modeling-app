import { foldService } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { ViewPlugin } from '@codemirror/view'

import type { LanguageServerOptions } from './plugin/lsp'
import {
  LanguageServerPlugin,
  LanguageServerPluginSpec,
  docPathFacet,
  languageId,
  workspaceFolders,
} from './plugin/lsp'

export { LanguageServerClient } from './client'
export type { LanguageServerClientOptions } from './client'
export {
  Codec,
  FromServer,
  IntoServer,
  LspWorkerEventType,
} from './client/codec'
export {
  LanguageServerPlugin,
  LanguageServerPluginSpec,
  docPathFacet,
  languageId,
  lspDiagnosticsEvent,
  lspFormatCodeEvent,
  lspSemanticTokensEvent,
  workspaceFolders,
} from './plugin/lsp'
export type { LanguageServerOptions } from './plugin/lsp'
export { offsetToPos, posToOffset } from './plugin/util'

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
    foldService.of((state: EditorState, lineStart: number, lineEnd: number) => {
      if (plugin == null) return null
      // Get the folding ranges from the language server.
      // Since this is async we directly need to update the folding ranges after.
      const range = plugin?.foldingRange(lineStart, lineEnd)
      return range
    }),
  ]

  return ext
}
