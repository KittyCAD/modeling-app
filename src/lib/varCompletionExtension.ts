import { Extension } from '@codemirror/state'
import {
  CompletionContext,
  autocompletion,
  Completion,
} from '@codemirror/autocomplete'

/// Basically a fork of the `mentions` extension https://github.com/uiwjs/react-codemirror/blob/master/extensions/mentions/src/index.ts
/// But it matches on any word, not just the `@` symbol
export function varMentions(data: Completion[] = []): Extension {
  return autocompletion({
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

export const varMentionsView: Extension = [varMentions()]
