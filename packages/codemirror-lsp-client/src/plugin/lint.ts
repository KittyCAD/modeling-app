import { Extension } from '@codemirror/state'
import { linter, forEachDiagnostic, Diagnostic } from '@codemirror/lint'

import { LanguageServerPlugin } from './lsp'

export default function lspLintExt(plugin: LanguageServerPlugin): Extension {
  return linter((view) => {
    let diagnostics: Diagnostic[] = []
    forEachDiagnostic(view.state, (d: Diagnostic, from: number, to: number) => {
      diagnostics.push(d)
    })
    return diagnostics
  })
}
