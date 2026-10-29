import {
  animationExceptionCategories,
  timerExceptionCategories,
} from './performance-policy.mjs'

const categories = new Set([
  ...timerExceptionCategories,
  ...animationExceptionCategories,
])

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      invalid:
        'Performance exceptions need a supported functional category and a specific reason of at least 20 characters. Each comment covers only the immediately adjacent site.',
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const text = comment.value.trim()
          if (!text.startsWith('zds-performance-exception')) continue
          const match = text.match(
            /^zds-performance-exception: ([a-z-]+) -- (\S[\s\S]*)$/
          )
          if (
            !match ||
            !categories.has(match[1]) ||
            match[2].trim().length < 20
          ) {
            context.report({ loc: comment.loc, messageId: 'invalid' })
          }
        }
      },
    }
  },
}
