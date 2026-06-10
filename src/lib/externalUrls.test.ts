import { getAllowedExternalURL } from '@src/lib/externalUrls'
import { describe, expect, it } from 'vitest'

describe('getAllowedExternalURL', () => {
  it('allows absolute http and https URLs', () => {
    expect(getAllowedExternalURL('https://zoo.dev/docs')).toBe(
      'https://zoo.dev/docs'
    )
    expect(getAllowedExternalURL('http://localhost:3000/settings')).toBe(
      'http://localhost:3000/settings'
    )
  })

  it('rejects non-web URL schemes', () => {
    expect(() => getAllowedExternalURL('file:///tmp/payload.exe')).toThrow(
      'External URL protocol is not allowed: file:'
    )
    expect(() =>
      getAllowedExternalURL('data:text/html,<script></script>')
    ).toThrow('External URL protocol is not allowed: data:')
  })

  it('rejects non-string and relative URLs', () => {
    expect(() => getAllowedExternalURL(undefined)).toThrow(
      'External URL must be a string'
    )
    expect(() => getAllowedExternalURL('/docs')).toThrow(
      'External URL must be absolute'
    )
  })
})
