import { describe, it, expect } from 'vitest'
import { createLiteral } from '@src/lang/create'

describe('createLiteral', () => {
  describe('string values', () => {
    it('should wrap simple strings in double quotes', () => {
      const node = createLiteral('hello')
      expect(node.raw).toBe('"hello"')
      expect(node.value).toBe('hello')
    })

    it('should handle empty strings', () => {
      const node = createLiteral('')
      expect(node.raw).toBe('""')
      expect(node.value).toBe('')
    })

    it('should escape double quotes within strings', () => {
      const node = createLiteral('say "hello"')
      expect(node.raw).toBe('"say \\"hello\\""')
      expect(node.value).toBe('say "hello"')
    })

    it('should escape backslashes', () => {
      const node = createLiteral('path\\to\\file')
      expect(node.raw).toBe('"path\\\\to\\\\file"')
      expect(node.value).toBe('path\\to\\file')
    })

    it('should escape backslashes before quotes correctly', () => {
      const node = createLiteral('escape\\"this')
      expect(node.raw).toBe('"escape\\\\\\"this"')
      expect(node.value).toBe('escape\\"this')
    })

    it('should handle strings with single quotes (no escaping needed)', () => {
      const node = createLiteral("it's a test")
      expect(node.raw).toBe('"it\'s a test"')
      expect(node.value).toBe("it's a test")
    })

    it('should handle strings with newlines', () => {
      const node = createLiteral('line1\nline2')
      expect(node.raw).toBe('"line1\nline2"')
      expect(node.value).toBe('line1\nline2')
    })

    it('should handle strings with tabs', () => {
      const node = createLiteral('col1\tcol2')
      expect(node.raw).toBe('"col1\tcol2"')
      expect(node.value).toBe('col1\tcol2')
    })

    it('should handle complex escape sequences', () => {
      const node = createLiteral('\\"\\\\"\\')
      expect(node.raw).toBe('"\\\\\\"\\\\\\\\\\"\\\\"')
      expect(node.value).toBe('\\"\\\\"\\')
    })
  })

  describe('number values', () => {
    it('should format integers without suffix', () => {
      const node = createLiteral(42)
      expect(node.raw).toBe('42')
      expect(node.value).toEqual({ value: 42, suffix: 'None' })
    })

    it('should format decimals without suffix', () => {
      const node = createLiteral(3.14)
      expect(node.raw).toBe('3.14')
      expect(node.value).toEqual({ value: 3.14, suffix: 'None' })
    })

    it('should format negative numbers', () => {
      const node = createLiteral(-100)
      expect(node.raw).toBe('-100')
      expect(node.value).toEqual({ value: -100, suffix: 'None' })
    })

    it('should format zero', () => {
      const node = createLiteral(0)
      expect(node.raw).toBe('0')
      expect(node.value).toEqual({ value: 0, suffix: 'None' })
    })
  })

  describe('boolean values', () => {
    it('should format true', () => {
      const node = createLiteral(true)
      expect(node.raw).toBe('true')
      expect(node.value).toBe(true)
    })

    it('should format false', () => {
      const node = createLiteral(false)
      expect(node.raw).toBe('false')
      expect(node.value).toBe(false)
    })
  })

  describe('AST node structure', () => {
    it('should create valid AST node with all required fields', () => {
      const node = createLiteral('test')
      expect(node.type).toBe('Literal')
      expect(node.start).toBe(0)
      expect(node.end).toBe(0)
      expect(node.moduleId).toBe(0)
      expect(node.outerAttrs).toEqual([])
      expect(node.preComments).toEqual([])
      expect(node.commentStart).toBe(0)
    })
  })
})
