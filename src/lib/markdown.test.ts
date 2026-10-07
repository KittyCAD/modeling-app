import { markdownToPlainText } from '@src/lib/markdown'
import { expect, test } from 'vitest'

test('keeps text while stripping Markdown links and formatting', () => {
  expect(
    markdownToPlainText(
      'Use [**bounded edges**](/docs/kcl-std/types/std-types-BoundedEdge) with `blend` &amp; fillets.'
    )
  ).toBe('Use bounded edges with blend & fillets.')
})
