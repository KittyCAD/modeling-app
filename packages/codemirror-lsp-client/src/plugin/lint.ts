import { Extension } from '@codemirror/state'
import { linter, Diagnostic } from '@codemirror/lint'

export default function lspLintExt(
  diagnosticsFn: () => Diagnostic[]
): Extension {
  return linter(() => {
    return diagnosticsFn()
  })
}
