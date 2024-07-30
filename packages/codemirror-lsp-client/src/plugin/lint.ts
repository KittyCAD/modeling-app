import { Extension } from '@codemirror/state'
import { linter } from '@codemirror/lint'

export default function lspLintExt(): Extension {
  return linter(() => {
    // We add diagnostics on the fly so this is fine.
    // This just ensures they get the right styling.
    return []
  })
}
