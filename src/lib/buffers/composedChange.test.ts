import { describe, expect, it } from 'vitest'
import {
  type EditorCapability,
  type BufferChange,
  combineCapabilities,
} from '@src/contracts/buffers'
import { composedChange } from '@src/lib/buffers/composedChange'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'

const bufferWith = (contents: string) =>
  createFileBackedTextBuffer({
    path: 'main.kcl',
    contents,
    languageId: 'kcl',
    capabilities: combineCapabilities([] as EditorCapability[]),
  })

/** The change a dispatch published. */
const publishedBy = (
  contents: string,
  dispatch: (buffer: ReturnType<typeof bufferWith>) => void
) => {
  const buffer = bufferWith(contents)
  let published: BufferChange | null = null
  buffer.onChange((change) => {
    published = change
  })
  dispatch(buffer)
  return { published, buffer }
}

describe('composedChange', () => {
  it('reports one transaction as itself', () => {
    const { published } = publishedBy('width = 10\n', (buffer) =>
      buffer.dispatch({ changes: { from: 0, to: 5, insert: 'depth' } })
    )
    expect(published).not.toBeNull()
    if (published === null) return

    const composed = composedChange(published)
    expect(composed).not.toBeNull()
    if (composed === null) return

    expect(composed.docBefore.toString()).toBe('width = 10\n')
    expect(composed.changes.apply(composed.docBefore).toString()).toBe(
      'depth = 10\n'
    )
  })

  /**
   * The reason this composes rather than reading the last transaction. Two specs
   * in one dispatch are sequential, so the second's offsets are against the
   * document the first produced — taking only one of them would describe a change
   * nobody made.
   */
  it('composes a batch into a single change from the first document', () => {
    const { published } = publishedBy('ab\n', (buffer) =>
      buffer.dispatch(
        { changes: { from: 0, to: 1, insert: 'X' } },
        { changes: { from: 1, to: 2, insert: 'Y' } }
      )
    )
    expect(published).not.toBeNull()
    if (published === null) return

    const composed = composedChange(published)
    expect(composed).not.toBeNull()
    if (composed === null) return

    expect(composed.docBefore.toString()).toBe('ab\n')
    // Both specs, applied to the document the batch started from.
    expect(composed.changes.apply(composed.docBefore).toString()).toBe('XY\n')
  })

  it('reports nothing for a change that moved no text', () => {
    const { published } = publishedBy('width = 10\n', (buffer) =>
      buffer.dispatch({ selection: { anchor: 2 } })
    )
    expect(published).not.toBeNull()
    if (published === null) return

    expect(composedChange(published)).toBeNull()
  })

  it('reports nothing when there are no transactions at all', () => {
    expect(
      composedChange({
        bufferId: 'buffer-1',
        docChanged: true,
        version: 1,
        pathRevision: 0,
        origin: 'user',
        transactions: [],
      })
    ).toBeNull()
  })
})
