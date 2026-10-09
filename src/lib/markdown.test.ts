import { markdownMessageElement, markdownToPlainText } from '@src/lib/markdown'
import { expect, test } from 'vitest'

test('keeps text while stripping Markdown links and formatting', () => {
  expect(
    markdownToPlainText(
      'Use [**bounded edges**](/docs/kcl-std/types/std-types-BoundedEdge) with `blend` &amp; fillets.'
    )
  ).toBe('Use bounded edges with blend & fillets.')
})

test('renders diagnostic code and bare URLs as safe, clickable Markdown', () => {
  const element = markdownMessageElement(
    '`circle` is deprecated. See https://zoo.dev/docs/kcl-book/sketch2d_constraints.html'
  )

  expect(element.querySelector('code')?.textContent).toBe('circle')
  const link = element.querySelector('a')
  expect(link?.href).toBe(
    'https://zoo.dev/docs/kcl-book/sketch2d_constraints.html'
  )
  expect(link?.getAttribute('data-safe-link')).not.toBeNull()
})
