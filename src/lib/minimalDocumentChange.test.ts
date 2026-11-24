import fc from 'fast-check'
import { expect, it } from 'vitest'
import { buildMinimalDocumentChange } from '@src/lib/minimalDocumentChange'

it('reconstructs the requested text while preserving every shared prefix and suffix', () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), (current, next) => {
      const change = buildMinimalDocumentChange(current, next)
      if (current === next) {
        expect(change).toBeNull()
        return
      }
      expect(change).not.toBeNull()
      if (!change) throw new Error('Different text requires a replacement')
      expect(
        current.slice(0, change.from) + change.insert + current.slice(change.to)
      ).toBe(next)
      expect(change.from).toBeGreaterThanOrEqual(0)
      expect(change.to).toBeGreaterThanOrEqual(change.from)
      expect(change.to).toBeLessThanOrEqual(current.length)
      if (change.from < Math.min(current.length, next.length))
        expect(current[change.from]).not.toBe(next[change.from])
      const nextEnd = change.from + change.insert.length
      if (change.to > change.from && nextEnd > change.from)
        expect(current[change.to - 1]).not.toBe(next[nextEnd - 1])
    })
  )
})

it('does not replace unchanged text', () => {
  fc.assert(
    fc.property(fc.string(), (text) => {
      expect(buildMinimalDocumentChange(text, text)).toBeNull()
    })
  )
})
