import { describe, expect, it } from 'vitest'

import { getShowSaveFilePickerOptions } from '@src/lib/browserSaveFile'

describe('getShowSaveFilePickerOptions', () => {
  it('uses the explicit file type passed by the caller', () => {
    expect(getShowSaveFilePickerOptions('main.step', 'step')).toEqual({
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

  it('normalizes dotted and uppercase file types', () => {
    expect(getShowSaveFilePickerOptions('foo', '.STeP')).toEqual({
      suggestedName: 'foo',
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
})
