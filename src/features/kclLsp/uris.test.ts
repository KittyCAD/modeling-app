import { describe, expect, it } from 'vitest'
import { pathToUri, uriToPath } from '@src/features/kclLsp/uris'

describe('uris', () => {
  it('addresses an ordinary path', () => {
    expect(pathToUri('/projects/bracket/main.kcl')).toBe(
      'file:///projects/bracket/main.kcl'
    )
  })

  it('roots a relative path, since a URI has nowhere else to start', () => {
    expect(pathToUri('main.kcl')).toBe('file:///main.kcl')
  })

  it('escapes what a path may contain and a URI may not', () => {
    expect(pathToUri('/p/my part.kcl')).toBe('file:///p/my%20part.kcl')
    expect(pathToUri('/p/100% scale.kcl')).toBe('file:///p/100%25%20scale.kcl')
  })

  it('keeps the separators as separators', () => {
    expect(pathToUri('/a/b/c.kcl')).toBe('file:///a/b/c.kcl')
  })

  /** The conversion has to be exactly reversible or a response finds no file. */
  it('round-trips', () => {
    for (const path of [
      '/projects/bracket/main.kcl',
      '/p/my part.kcl',
      '/p/100% scale.kcl',
      '/p/π.kcl',
      '/p/a+b.kcl',
      '/p/#hash.kcl',
      '/p/q?uery.kcl',
    ]) {
      expect(uriToPath(pathToUri(path))).toBe(path)
    }
  })

  it('has nothing to say about a URI that is not a file', () => {
    expect(uriToPath('https://zoo.dev/main.kcl')).toBeNull()
    expect(uriToPath('untitled:1')).toBeNull()
  })

  it('refuses a malformed escape rather than guessing', () => {
    expect(uriToPath('file:///p/%zz.kcl')).toBeNull()
  })
})
