import type { CompletionContext } from '@codemirror/autocomplete'

import { usePreviousVariables } from '@src/lib/usePreviousVariables'
import type { Program, VariableMap } from '@src/lang/wasm'
import { use } from 'react'
import { useSingletons } from '@src/lib/singletons'

/// Basically a fork of the `mentions` extension https://github.com/uiwjs/react-codemirror/blob/master/extensions/mentions/src/index.ts
/// But it matches on any word, not just the `@` symbol
export function usePreviousVarMentions(
  context: CompletionContext,
  ast: Program,
  variables: VariableMap
) {
  const { kclManager } = useSingletons()
  const wasmInstance = use(kclManager.wasmInstancePromise)
  const previousVariables = usePreviousVariables({
    code: context.view?.state.doc.toString() || '',
    ast,
    variables,
    wasmInstance,
  })
  const data = previousVariables.variables.map((variable) => {
    return {
      label: variable.key,
      detail: variable.value,
    }
  })
  let word = context.matchBefore(/^\w*$/)
  if (!word) return null
  if (word && word.from === word.to && !context.explicit) {
    return null
  }
  return {
    from: word?.from,
    options: [...data],
  }
}
