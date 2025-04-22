import type { CompletionContext } from '@codemirror/autocomplete'

import { usePreviousVariables } from '@src/lib/usePreviousVariables'

/// Basically a fork of the `mentions` extension https://github.com/uiwjs/react-codemirror/blob/master/extensions/mentions/src/index.ts
/// But it matches on any word, not just the `@` symbol
export function usePreviousVarMentions(context: CompletionContext) {
  const previousVariables = usePreviousVariables()
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
