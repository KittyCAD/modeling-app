import { editorManager } from 'lib/singletons'
import { Diagnostic } from '@codemirror/lint'

describe('EditorManager Class', () => {
  describe('makeUniqueDiagnostics', () => {
    it('should filter out duplicated diagnostics', () => {
      const duplicatedDiagnostics: Diagnostic[] = [
        {
          from: 2,
          to: 10,
          severity: 'hint',
          message: 'my cool message',
        },
        {
          from: 2,
          to: 10,
          severity: 'hint',
          message: 'my cool message',
        },
        {
          from: 2,
          to: 10,
          severity: 'hint',
          message: 'my cool message',
        },
      ]

      const expected: Diagnostic[] = [
        {
          from: 2,
          to: 10,
          severity: 'hint',
          message: 'my cool message',
        },
      ]

      const actual = editorManager.makeUniqueDiagnostics(duplicatedDiagnostics)
      expect(actual).toStrictEqual(expected)
    })
    it('should filter out duplicated diagnostic and keep some original ones', () => {
      const duplicatedDiagnostics: Diagnostic[] = [
        {
          from: 0,
          to: 10,
          severity: 'hint',
          message: 'my cool message',
        },
        {
          from: 0,
          to: 10,
          severity: 'hint',
          message: 'my cool message',
        },
        {
          from: 88,
          to: 99,
          severity: 'hint',
          message: 'my super cool message',
        },
      ]

      const expected: Diagnostic[] = [
        {
          from: 0,
          to: 10,
          severity: 'hint',
          message: 'my cool message',
        },
        {
          from: 88,
          to: 99,
          severity: 'hint',
          message: 'my super cool message',
        },
      ]

      const actual = editorManager.makeUniqueDiagnostics(duplicatedDiagnostics)
      expect(actual).toStrictEqual(expected)
    })
  })
})
