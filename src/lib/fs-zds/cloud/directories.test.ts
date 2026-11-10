import { posix } from '@chainner/node-path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  decodeCloudDirectories,
  encodeCloudDirectories,
} from '@src/lib/fs-zds/cloud/directories'

describe('cloud empty directory metadata', () => {
  const paths = fc.array(
    fc
      .array(
        fc.constantFrom('parts', 'café', '空', 'with space', '🙂', '..hidden'),
        {
          minLength: 1,
          maxLength: 5,
        }
      )
      .map((segments) => posix.join(...segments)),
    { maxLength: 20 }
  )

  it('encodes a sorted, duplicate-free JSON array that other clients can read', () => {
    fc.assert(
      fc.property(paths, (directories) => {
        const encoded = encodeCloudDirectories(directories)
        expect(JSON.parse(new TextDecoder().decode(encoded))).toEqual(
          [...new Set(directories)].sort()
        )
        expect(encodeCloudDirectories(directories.toReversed())).toEqual(
          encoded
        )
      })
    )
  })

  it('reads stored JSON independently of the encoder, preserving first-seen directory order', () => {
    fc.assert(
      fc.property(paths, (directories) => {
        const stored = new TextEncoder().encode(JSON.stringify(directories))
        expect(decodeCloudDirectories(stored)).toEqual([
          ...new Set(directories),
        ])
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
  ])('rejects unsafe stored directory %s', (path) => {
    expect(() =>
      decodeCloudDirectories(new TextEncoder().encode(JSON.stringify([path])))
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
