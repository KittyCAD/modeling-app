import { describe, expect, it } from 'vitest'

import { onlyAcceptsBodySelectionTypes } from '@src/lib/selectionFilterUtils'

describe('onlyAcceptsBodySelectionTypes', () => {
  it('includes region-backed objects', () => {
    expect(
      onlyAcceptsBodySelectionTypes([
        'path',
        'pathRegion',
        'sweep',
        'compositeSolid',
      ])
    ).toBe(true)
  })

  it('rejects arguments that also accept non-body selections', () => {
    expect(onlyAcceptsBodySelectionTypes(['path', 'wall'])).toBe(false)
  })
})
