import { getProjectLibraryIconName } from '@src/routes/projectLibraryIcons'
import { describe, expect, test } from 'vitest'

describe('getProjectLibraryIconName', () => {
  test('returns valid custom project library icons', () => {
    expect(
      getProjectLibraryIconName({
        type: 'atproto',
        icon: 'atSign',
      })
    ).toBe('atSign')
  })

  test('falls back to folder for unknown icon names', () => {
    expect(
      getProjectLibraryIconName({
        type: 'directory',
        icon: 'unknown',
      })
    ).toBe('folder')
  })
})
