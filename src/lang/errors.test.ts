import type { KCLError } from '@src/lang/errors'
import { kclErrorsToDiagnostics, toUtf8, toUtf16 } from '@src/lang/errors'
import { defaultArtifactGraph } from '@src/lang/std/artifactGraph'
import { topLevelRange } from '@src/lang/util'
import { expect, describe, it } from 'vitest'

describe('test UTF conversions', () => {
  it('Converts UTF-8 to UTF-16', () => {
    // This KCL program has an error. The variable `亞當` cannot be +3 because
    // it holds a string. So that variable, on line 2, should be highlighted by
    // a source range.
    const sourceCode = "亞當 = 'adam'\nx = 亞當 + 3"
    // Start with a SourceRange from the KCL interpreter,
    // which is a UTF-8 range, on where the variable is used on the second line.
    const utf8SourceRange = [20, 26, 0]

    // JS string of the program uses UTF-16, so check we can correctly find the
    // source range offset in UTF-16.
    const actualStart = toUtf16(utf8SourceRange[0], sourceCode)
    const actualEnd = toUtf16(utf8SourceRange[1], sourceCode)
    const textInSourceRange = sourceCode.slice(actualStart, actualEnd)
    expect(actualStart).toBe(16)
    expect(actualEnd).toBe(18)
    expect(textInSourceRange).toBe('亞當')

    // Test we can convert the UTF-16 source range back to UTF-8,
    // getting the original source range back.
    const utf16Range: [number, number, number] = [actualStart, actualEnd, 0]
    const actualUtf8Range = toUtf8(utf16Range, sourceCode)
    expect(actualUtf8Range).toStrictEqual(utf8SourceRange)
  })
})

describe('test kclErrToDiagnostic', () => {
  it('converts KCL errors to CodeMirror diagnostics', () => {
    const errors: KCLError[] = [
      {
        name: '',
        message: '',
        kind: 'semantic',
        msg: 'Semantic error',
        sourceRange: topLevelRange(0, 1),
        kclBacktrace: [],
        nonFatal: [],
        variables: {},
        operations: [],
        artifactGraph: defaultArtifactGraph(),
        filenames: {},
        defaultPlanes: null,
      },
      {
        name: '',
        message: '',
        kind: 'type',
        msg: 'Type error',
        sourceRange: topLevelRange(4, 5),
        kclBacktrace: [],
        nonFatal: [],
        variables: {},
        operations: [],
        artifactGraph: defaultArtifactGraph(),
        filenames: {},
        defaultPlanes: null,
      },
    ]
    const diagnostics = kclErrorsToDiagnostics(errors, 'TEST PROGRAM')
    expect(diagnostics).toEqual([
      {
        from: 0,
        to: 1,
        message: 'Semantic error',
        severity: 'error',
      },
      {
        from: 4,
        to: 5,
        message: 'Type error',
        severity: 'error',
      },
    ])
  })
})
