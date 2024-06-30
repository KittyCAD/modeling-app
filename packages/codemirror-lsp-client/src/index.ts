import { Extension } from '@codemirror/state'
import { ViewPlugin } from '@codemirror/view'

import {
  docPathFacet,
  LanguageServerPlugin,
  languageId,
  workspaceFolders,
  LanguageServerOptions,
} from './plugin/lsp'

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
  LanguageServerPluginValue,
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

  return [
    docPathFacet.of(options.documentUri),
    languageId.of('kcl'),
    workspaceFolders.of(options.workspaceFolders),
    viewPlugin,
  ]
}
