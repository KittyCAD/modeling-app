import tsParser from '@typescript-eslint/parser'
import cssParser from './css-parser.mjs'
import { guardrailRuleNames } from './rules/performance-policy.mjs'

const message =
  'Do not disable performance guardrails. Classify a legitimate functional timer/activity indicator with one adjacent zds-performance-exception comment.'

export default function createPerformanceDirectivesProcessor() {
  // ESLint preprocess/parse/postprocess is synchronous per file. Keep only
  // that file's comment diagnostics, and release them even on a parse failure.
  const pending = new Map()
  return {
    meta: { name: 'zds-performance-directives', version: '1.0.0' },
    supportsAutofix: true,
    preprocess(text, filename) {
      const diagnostics = []
      try {
        const ast = filename.endsWith('.css')
          ? cssParser.parseForESLint(text, { filePath: filename }).ast
          : tsParser.parse(text, {
              filePath: filename,
              ecmaVersion: 'latest',
              sourceType: 'module',
              ecmaFeatures: { jsx: true },
              comment: true,
              loc: true,
              range: true,
            })
        for (const comment of ast.comments ?? []) {
          const directive = comment.value.trim().split('--')[0].trim()
          if (
            !/^eslint(?:-disable(?:-next-line|-line)?|-enable)?\b/.test(
              directive
            )
          )
            continue
          const blanket = /^eslint-disable(?:-next-line|-line)?\s*$/.test(
            directive
          )
          if (
            !blanket &&
            ![...guardrailRuleNames].some((name) => directive.includes(name))
          )
            continue
          diagnostics.push({
            ruleId: 'zds/performance-exceptions',
            severity: 2,
            fatal: true,
            message,
            line: comment.loc.start.line,
            column: comment.loc.start.column + 1,
            endLine: comment.loc.end.line,
            endColumn: comment.loc.end.column + 1,
          })
        }
      } catch {
        // The configured native parser reports invalid source syntax. Do not
        // replace its diagnostic with an exception from this comment check.
      }
      pending.set(filename, diagnostics)
      return [text]
    },
    postprocess(messages, filename) {
      const diagnostics = pending.get(filename) ?? []
      pending.delete(filename)
      // Processor diagnostics run after inline suppression, so even disabling
      // this guardrail rule itself cannot conceal the forbidden directive.
      return [...messages.flat(), ...diagnostics]
    },
  }
}
