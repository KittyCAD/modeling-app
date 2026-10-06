import { fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ openExternal: vi.fn() }))

vi.mock('@src/lib/openWindow', () => ({
  openExternalBrowserIfDesktop:
    (url: string) => (e: { preventDefault(): void }) => {
      e.preventDefault()
      mocks.openExternal(url)
    },
}))

import { MarkdownText } from '@src/components/MarkdownText'
import { markdownToPlainText } from '@src/lib/markdown'

const mixedListResponse = `I made the following updates:

- Added a rectangular base plate.
- Added four corner mounting holes.
- Added a centered circular cutout.
- Added fillets to the outside corners.
- Updated the model dimensions.
1. Changed the plate width to 120 mm.
2. Changed the plate height to 80 mm.
3. Changed the plate thickness to 6 mm.`

const expectedItems = [
  'Added a rectangular base plate.',
  'Added four corner mounting holes.',
  'Added a centered circular cutout.',
  'Added fillets to the outside corners.',
  'Updated the model dimensions.',
  'Changed the plate width to 120 mm.',
  'Changed the plate height to 80 mm.',
  'Changed the plate thickness to 6 mm.',
]

describe('MarkdownText', () => {
  beforeEach(() => {
    mocks.openExternal.mockClear()
  })

  it('provides plain text for accessible descriptions', () => {
    expect(
      markdownToPlainText(
        'Use [**bounded edges**](/docs/kcl-std/types/std-types-BoundedEdge) with `blend` &amp; fillets.'
      )
    ).toBe('Use bounded edges with blend & fillets.')
  })

  it('opens relative KCL docs links externally once, including in StrictMode', () => {
    render(
      <StrictMode>
        <MarkdownText text="Use [**bounded edges**](/docs/kcl-std/types/std-types-BoundedEdge)." />
      </StrictMode>
    )

    const url = 'https://zoo.dev/docs/kcl-std/types/std-types-BoundedEdge'
    const link = screen.getByRole('link', { name: 'bounded edges' })
    expect(link).toHaveAttribute('href', url)
    fireEvent.click(link)
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(url)
  })

  it('can render link labels without interactive links', () => {
    const { container } = render(
      <MarkdownText
        text="Use [**bounded edges**](/docs/kcl-std/types/std-types-BoundedEdge) with `blend`."
        links={false}
      />
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(container.querySelector('strong')).toHaveTextContent('bounded edges')
    expect(container.querySelector('code')).toHaveTextContent('blend')
  })

  it('keeps raw HTML and unsafe links inert', () => {
    const { container } = render(
      <MarkdownText
        text={'<img src="x" onerror="alert(1)"> [unsafe](javascript:alert)'}
      />
    )

    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText(/unsafe/)).toBeInTheDocument()
  })

  it('renders contiguous unordered and ordered items as separate lists', () => {
    const { container } = render(<MarkdownText text={mixedListResponse} />)

    const lists = container.querySelectorAll('ul, ol')
    expect(lists).toHaveLength(2)

    const [unorderedList, orderedList] = lists
    expect(unorderedList.tagName).toBe('UL')
    expect(unorderedList.querySelectorAll(':scope > li')).toHaveLength(5)
    expect(unorderedList.nextElementSibling).toBe(orderedList)
    expect(orderedList.tagName).toBe('OL')
    expect(orderedList.querySelectorAll(':scope > li')).toHaveLength(3)

    expect(
      Array.from(container.querySelectorAll('li'), (item) => item.textContent)
    ).toEqual(expectedItems)
  })
})
