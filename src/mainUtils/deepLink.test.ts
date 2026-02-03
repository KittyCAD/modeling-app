import { describe, expect, it } from 'vitest'

import { parseDeepLink } from '@src/mainUtils/deepLink'

describe('parseDeepLink', () => {
  it('ignores non protocol links', () => {
    expect(parseDeepLink('/tmp/project')).toEqual({ filteredPath: '' })
  })

  it('extracts and decodes environment links', () => {
    expect(
      parseDeepLink('zoo-studio://env/dev.zoo.dev/file/my%20projects/main.kcl')
    ).toEqual({
      environment: 'dev.zoo.dev',
      filteredPath: '/file/my projects/main.kcl',
    })
  })

  it('decodes standard deep links without an environment prefix', () => {
    expect(parseDeepLink('zoo-studio://file/my%20projects/main.kcl')).toEqual({
      filteredPath: 'file/my projects/main.kcl',
    })
  })
})
