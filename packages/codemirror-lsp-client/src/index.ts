import { Extension } from '@codemirror/state'
import { ViewPlugin } from '@codemirror/view'

import {
  docPathFacet,
  LanguageServerPlugin,
  languageId,
  workspaceFolders,
  LanguageServerOptions,
} from './plugin/lsp'
import lspAutocompletionExt from './plugin/autocomplete'
import lspFoldingExt from './plugin/folding'
import lspFormatExt from './plugin/format'
import lspHoverExt from './plugin/hover'
import lspIndentExt from './plugin/indent'
import lspLintExt from './plugin/lint'
import lspSemanticTokensExt from './plugin/semantic-tokens'

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
  docPathFacet,
  languageId,
  workspaceFolders,
} from './plugin/lsp'
export { posToOffset, offsetToPos } from './plugin/util'

export function lspPlugin(options: LanguageServerOptions): Extension {
  let plugin: LanguageServerPlugin | null = null
  const viewPlugin = ViewPlugin.define(
    (view) => (plugin = new LanguageServerPlugin(options, view))
  )

  let ext = [
    docPathFacet.of(options.documentUri),
    languageId.of('kcl'),
    workspaceFolders.of(options.workspaceFolders),
    viewPlugin,
    lspAutocompletionExt(plugin),
    lspFoldingExt(plugin),
    lspFormatExt(plugin),
    lspHoverExt(plugin),
    lspIndentExt(),
    lspLintExt(),
    lspSemanticTokensExt(),
  ]

  return ext
}
