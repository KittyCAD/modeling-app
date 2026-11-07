import { posix } from '@chainner/node-path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  decodeCloudDirectories,
  encodeCloudDirectories,
} from '@src/lib/fs-zds/cloud/directories'

describe('cloud empty directory metadata', () => {
  it('round-trips generated directory paths deterministically', () => {
    const segment = fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/)
    const path = fc
      .array(segment, { minLength: 1, maxLength: 5 })
      .map((parts) => posix.join(...parts))
    fc.assert(
      fc.property(fc.array(path), (paths) => {
        expect(decodeCloudDirectories(encodeCloudDirectories(paths))).toEqual(
          [...new Set(paths)].sort()
        )
        expect(encodeCloudDirectories(paths.toReversed())).toEqual(
          encodeCloudDirectories(paths)
        )
      })
    )
  })
  it.each([
    '../escape',
    '/absolute',
    '.',
    'a/../b',
    'a\\b',
    'C:/escape',
    '.zoo-directories.json/nested',
    'nul\0path',
  ])('rejects unsafe directory %s', (path) => {
    expect(() =>
      decodeCloudDirectories(encodeCloudDirectories([path]))
    ).toThrow('invalid project path')
  })
  it.each(['{}', '[1]', 'null', 'not json'])(
    'rejects invalid metadata %s',
    (value) => {
      expect(() =>
        decodeCloudDirectories(new TextEncoder().encode(value))
      ).toThrow()
    }
  )
})
