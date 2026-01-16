import { type Extension } from '@codemirror/state'
import type { LanguageServerOptions } from '@kittycad/codemirror-lsp-client'
import { lspPlugin } from '@kittycad/codemirror-lsp-client'

export function kclPlugin(options: LanguageServerOptions): Extension {
  return [lspPlugin(options)]
}
