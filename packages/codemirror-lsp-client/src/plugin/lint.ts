import { Extension } from '@codemirror/state'
import { linter, forEachDiagnostic, Diagnostic } from '@codemirror/lint'

export default function lspLintExt(): Extension {
  return linter((view) => {
    let diagnostics: Diagnostic[] = []
    forEachDiagnostic(view.state, (d: Diagnostic, from: number, to: number) => {
      diagnostics.push(d)
    })
    return diagnostics
  })
}
