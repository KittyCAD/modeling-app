import type { Completion, CompletionContext } from '@codemirror/autocomplete'
import { autocompletion } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'

type VarMentionsConfig = {
  activateOnTypingDelay?: number
  interactionDelay?: number
}

/// Basically a fork of the `mentions` extension https://github.com/uiwjs/react-codemirror/blob/master/extensions/mentions/src/index.ts
/// But it matches on any word, not just the `@` symbol
export function varMentions(
  data: Completion[] = [],
  config: VarMentionsConfig = {}
): Extension {
  return autocompletion({
    ...config,
    override: [
      (context: CompletionContext) => {
        let word = context.matchBefore(/(\w+)?/)
        if (!word) return null
        if (word && word.from === word.to && !context.explicit) {
          return null
        }
        return {
          from: word?.from,
          options: [...data],
        }
      },
    ],
  })
}
