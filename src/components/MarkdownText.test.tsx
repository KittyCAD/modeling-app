import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MarkdownText } from '@src/components/MarkdownText'

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
