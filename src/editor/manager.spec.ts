import type { Diagnostic } from '@codemirror/lint'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { expect, describe, it } from 'vitest'
import { App } from '@src/lib/app'

describe('EditorManager Class', () => {
  const app = App.fromProvided({
    wasmPromise: Promise.resolve({} as ModuleType),
  })
  const project = app.openProject(
    {
      path: 'some-project',
      name: 'i-should-really-change-this-api',
      children: [],
      default_file: 'main.kcl',
      directory_count: 0,
      kcl_file_count: 1,
      metadata: null,
      readWriteAccess: true,
    },
    'some-file'
  )

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

      const actual = project.executingEditor.value?.makeUniqueDiagnostics(
        duplicatedDiagnostics
      )
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

      const actual = project.executingEditor.value?.makeUniqueDiagnostics(
        duplicatedDiagnostics
      )
      expect(actual).toStrictEqual(expected)
    })
  })
})
