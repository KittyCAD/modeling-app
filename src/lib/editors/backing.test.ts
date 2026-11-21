import { createEditorBacking, parseEditorFile } from '@src/lib/editors/backing'
import type { EditorFileFormat } from '@src/lib/editors/registry/contract'
import fc from 'fast-check'
import { expect, it, vi } from 'vitest'

vi.mock('@src/lib/fs-zds', async () => ({
  default: (await import('node:path')).posix,
}))
const text: EditorFileFormat = { id: 'text', matches: '.txt', type: 'text' }
it('preserves arbitrary bytes for unknown files, with no mutable buffer shared with callers', () => {
  fc.assert(
    fc.property(fc.uint8Array(), (bytes) => {
      const expected = bytes.slice()
      const parsed = parseEditorFile('/project/unknown.dat', bytes, [text])
      expect(parsed.type).toBe('binary')
      const backing = createEditorBacking(parsed)
      if (backing.type !== 'binary')
        return expect.fail('Unknown files must retain their bytes')
      bytes.fill(0)
      expect(backing.readBytes()).toEqual(expected)
      backing.readBytes().fill(0)
      expect(backing.readBytes()).toEqual(expected)
    })
  )
})
it('does not infer editable text from an unknown file containing valid UTF-8', () => {
  expect(
    parseEditorFile('notes.unknown', new TextEncoder().encode('hello'), [text])
      .type
  ).toBe('binary')
})
it.each([
  new Uint8Array([0xff, 0xfe, 0x41]),
  new Uint8Array([0xc3, 0x28]),
  new Uint8Array([65, 0, 66]),
])(
  'keeps invalid text or NUL-containing data binary despite a text extension: %j',
  (bytes) => {
    expect(parseEditorFile('/project/notes.txt', bytes, [text]).type).toBe(
      'binary'
    )
  }
)
it('decodes registered text formats case-insensitively without losing Unicode', () => {
  expect(
    parseEditorFile('/project/NOTES.TXT', new TextEncoder().encode('café\n'), [
      text,
    ])
  ).toEqual({ type: 'text', contents: 'café\n' })
})
it('honors a higher priority binary declaration over a text declaration', () => {
  const formats: EditorFileFormat[] = [
    text,
    { id: 'opaque', type: 'binary', matches: '.txt', priority: 10 },
  ]
  expect(
    parseEditorFile('notes.txt', new TextEncoder().encode('hello'), formats)
      .type
  ).toBe('binary')
})
