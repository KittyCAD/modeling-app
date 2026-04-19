import { describe, expect, it } from 'vitest'

import { getShowSaveFilePickerOptions } from '@src/lib/browserSaveFile'

describe('getShowSaveFilePickerOptions', () => {
  it('adds extension-constrained picker options when suggestedName has an extension', () => {
    expect(getShowSaveFilePickerOptions('main.step')).toEqual({
      suggestedName: 'main.step',
      types: [
        {
          description: 'STEP files',
          accept: {
            'application/octet-stream': ['.step'],
          },
        },
      ],
      excludeAcceptAllOption: true,
    })
  })

  it('only sets suggestedName when there is no extension', () => {
    expect(getShowSaveFilePickerOptions('foo')).toEqual({
      suggestedName: 'foo',
    })
  })
})
