import { describe, expect, it } from 'vitest'
import {
  basename,
  dirname,
  extname,
  isPathInside,
  joinPath,
  normalizePath,
  relativePath,
  toDirectoryName,
  uniqueName,
} from '@src/lib/paths'

describe('normalizePath', () => {
  it('converts backslashes and collapses separators', () => {
    expect(normalizePath('a\\b//c')).toBe('a/b/c')
  })

  it('drops a trailing slash so a path is usable as a key', () => {
    expect(normalizePath('/a/b/')).toBe('/a/b')
  })

  it('resolves . and ..', () => {
    expect(normalizePath('/a/./b/../c')).toBe('/a/c')
  })

  it('cannot be walked above an absolute root', () => {
    expect(normalizePath('/a/../../b')).toBe('/b')
  })

  it('keeps a leading .. on a relative path, where it means something', () => {
    expect(normalizePath('../a')).toBe('../a')
  })

  it('preserves a Windows drive prefix', () => {
    expect(normalizePath('C:\\projects\\a\\')).toBe('C:/projects/a')
  })
})

describe('path parts', () => {
  it('joins and normalizes in one step', () => {
    expect(joinPath('/a/', '/b', 'c/')).toBe('/a/b/c')
  })

  it('skips empty segments', () => {
    expect(joinPath('/a', '', 'b')).toBe('/a/b')
  })

  it('reads dirname and basename', () => {
    expect(dirname('/a/b/c.kcl')).toBe('/a/b')
    expect(basename('/a/b/c.kcl')).toBe('c.kcl')
    expect(dirname('/a')).toBe('/')
  })

  it('reads an extension, ignoring a leading dot', () => {
    expect(extname('main.kcl')).toBe('.kcl')
    expect(extname('archive.tar.gz')).toBe('.gz')
    // A dotfile has no extension; the dot is the name.
    expect(extname('.gitignore')).toBe('')
    expect(extname('README')).toBe('')
  })
})

describe('containment', () => {
  it('treats a path as inside itself', () => {
    expect(isPathInside('/a', '/a')).toBe(true)
  })

  it('matches descendants', () => {
    expect(isPathInside('/a', '/a/b/c')).toBe(true)
  })

  it('rejects a sibling with a shared prefix', () => {
    // The bug this guards: '/ab' must not count as inside '/a'.
    expect(isPathInside('/a', '/ab')).toBe(false)
  })

  it('rejects an empty root rather than matching everything', () => {
    expect(isPathInside('', '/a')).toBe(false)
  })

  it('computes a relative path, or nothing when outside', () => {
    expect(relativePath('/a', '/a/b/c')).toBe('b/c')
    expect(relativePath('/a', '/a')).toBe('')
    expect(relativePath('/a', '/b')).toBeNull()
  })
})

describe('naming', () => {
  it('makes a filesystem-safe folder name from a title', () => {
    expect(toDirectoryName('My Bracket v2!')).toBe('my-bracket-v2')
  })

  it('collapses runs and trims edge punctuation', () => {
    expect(toDirectoryName('  --Weird   Name--  ')).toBe('weird-name')
  })

  it('falls back when a title has nothing usable in it', () => {
    expect(toDirectoryName('!!!')).toBe('untitled')
    expect(toDirectoryName('', 'fallback')).toBe('fallback')
  })

  it('suffixes until a name is free', () => {
    expect(uniqueName('bracket', [])).toBe('bracket')
    expect(uniqueName('bracket', ['bracket'])).toBe('bracket-2')
    expect(uniqueName('bracket', ['bracket', 'bracket-2'])).toBe('bracket-3')
  })
})
