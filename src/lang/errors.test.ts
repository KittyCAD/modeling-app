import type { BacktraceItem } from '@rust/kcl-lib/bindings/BacktraceItem'
import type { KCLError } from '@src/lang/errors'
import { kclErrorsToDiagnostics, toUtf8, toUtf16 } from '@src/lang/errors'
import { defaultArtifactGraph } from '@src/lang/std/artifactGraph'
import { topLevelRange } from '@src/lang/util'
import { emptyOperationsByModule } from '@src/lang/wasm'
import { describe, expect, it } from 'vitest'

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
        operations: emptyOperationsByModule(),
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
        operations: emptyOperationsByModule(),
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

  it('renders import backtrace frames without call parens', () => {
    // Innermost first: the failing line inside the imported module, the
    // import statement chain, then the top-level import in main.
    const sourceCode =
      'import assemblyValue from "assembly.kcl"\n\nassemblyValue\n'
    const errors: KCLError[] = [
      {
        name: '',
        message: '',
        kind: 'undefined_value',
        msg: '`missingName` is not defined',
        sourceRange: [0, 41, 0],
        kclBacktrace: [
          {
            sourceRange: [21, 32, 2],
            fnName: 'import broken.kcl',
            kind: 'import',
          },
          {
            sourceRange: [0, 36, 1],
            fnName: 'import assembly.kcl',
            kind: 'import',
          },
          { sourceRange: [0, 41, 0], fnName: null, kind: 'call' },
        ],
        nonFatal: [],
        variables: {},
        operations: emptyOperationsByModule(),
        artifactGraph: defaultArtifactGraph(),
        filenames: {},
        defaultPlanes: null,
      },
    ]
    const diagnostics = kclErrorsToDiagnostics(errors, sourceCode)
    expect(diagnostics).toEqual([
      {
        from: 0,
        to: 41,
        message:
          '`missingName` is not defined\n\nBacktrace:\nimport broken.kcl\nimport assembly.kcl',
        severity: 'error',
      },
    ])
  })

  it('shows the backtrace for a direct import with a single frame', () => {
    // One-level import: the only named frame is the import itself, which is
    // the only sign the error lives in another file.
    const sourceCode = 'import partValue from "part.kcl"\n\npartValue\n'
    const errors: KCLError[] = [
      {
        name: '',
        message: '',
        kind: 'undefined_value',
        msg: '`missingName` is not defined',
        sourceRange: [0, 32, 0],
        kclBacktrace: [
          {
            sourceRange: [21, 32, 1],
            fnName: 'import part.kcl',
            kind: 'import',
          },
          { sourceRange: [0, 32, 0], fnName: null, kind: 'call' },
        ],
        nonFatal: [],
        variables: {},
        operations: emptyOperationsByModule(),
        artifactGraph: defaultArtifactGraph(),
        filenames: {},
        defaultPlanes: null,
      },
    ]
    const diagnostics = kclErrorsToDiagnostics(errors, sourceCode)
    expect(diagnostics).toEqual([
      {
        from: 0,
        to: 32,
        message: '`missingName` is not defined\n\nBacktrace:\nimport part.kcl',
        severity: 'error',
      },
    ])
  })

  it('still suppresses a single function frame', () => {
    // A one-frame function backtrace repeats what the squiggle already
    // points at, so it is not shown.
    const sourceCode =
      'fn f(@x) {\n  return assert(x, isGreaterThan = 0)\n}\n\nf(0)\n'
    const errors: KCLError[] = [
      {
        name: '',
        message: '',
        kind: 'user_defined',
        msg: 'assert failed',
        sourceRange: [20, 47, 0],
        kclBacktrace: [
          { sourceRange: [20, 47, 0], fnName: 'f', kind: 'call' },
          { sourceRange: [52, 56, 0], fnName: null, kind: 'call' },
        ],
        nonFatal: [],
        variables: {},
        operations: emptyOperationsByModule(),
        artifactGraph: defaultArtifactGraph(),
        filenames: {},
        defaultPlanes: null,
      },
    ]
    const diagnostics = kclErrorsToDiagnostics(errors, sourceCode)
    expect(diagnostics).toEqual([
      {
        from: 52,
        to: 56,
        message: 'Part of the error backtrace',
        severity: 'hint',
      },
      {
        from: 20,
        to: 47,
        message: 'assert failed',
        severity: 'error',
      },
    ])
  })

  it('renders function frames with parens alongside import frames', () => {
    const sourceCode =
      'import assemblyValue from "assembly.kcl"\n\nassemblyValue\n'
    const errors: KCLError[] = [
      {
        name: '',
        message: '',
        kind: 'undefined_value',
        msg: '`missingName` is not defined',
        sourceRange: [0, 41, 0],
        kclBacktrace: [
          { sourceRange: [27, 38, 2], fnName: 'inner', kind: 'call' },
          { sourceRange: [68, 75, 2], fnName: 'outer', kind: 'call' },
          {
            sourceRange: [55, 62, 1],
            fnName: 'import assembly.kcl',
            kind: 'import',
          },
          { sourceRange: [0, 41, 0], fnName: null, kind: 'call' },
        ],
        nonFatal: [],
        variables: {},
        operations: emptyOperationsByModule(),
        artifactGraph: defaultArtifactGraph(),
        filenames: {},
        defaultPlanes: null,
      },
    ]
    const diagnostics = kclErrorsToDiagnostics(errors, sourceCode)
    expect(diagnostics).toEqual([
      {
        from: 0,
        to: 41,
        message:
          '`missingName` is not defined\n\nBacktrace:\ninner()\nouter()\nimport assembly.kcl',
        severity: 'error',
      },
    ])
  })

  // A recursive function whose backtrace has `namedFrames` frames named `f`,
  // ending at the unnamed top-level call.
  const recursiveSourceCode =
    'fn f(@n) {\n  assert(n, isGreaterThan = 0)\n  return f(n - 1)\n}\n\nf(40)\n'
  function recursiveError(namedFrames: number): KCLError {
    const recursiveCallSite: BacktraceItem = {
      sourceRange: [51, 59, 0],
      fnName: 'f',
      kind: 'call',
    }
    return {
      name: '',
      message: '',
      kind: 'user_defined',
      msg: 'assert failed',
      sourceRange: [13, 41, 0],
      kclBacktrace: [
        { sourceRange: [13, 41, 0], fnName: 'f', kind: 'call' },
        ...Array(namedFrames - 1).fill(recursiveCallSite),
        { sourceRange: [63, 68, 0], fnName: null, kind: 'call' },
      ],
      nonFatal: [],
      variables: {},
      operations: emptyOperationsByModule(),
      artifactGraph: defaultArtifactGraph(),
      filenames: {},
      defaultPlanes: null,
    }
  }
  // Every recursive frame repeats the same call site, so it produces one
  // deduped hint, plus one for the top-level call.
  const recursiveHints = [
    {
      from: 51,
      to: 59,
      message: 'Part of the error backtrace',
      severity: 'hint',
    },
    {
      from: 63,
      to: 68,
      message: 'Part of the error backtrace',
      severity: 'hint',
    },
  ]

  it('shows a 30-frame backtrace in full', () => {
    const diagnostics = kclErrorsToDiagnostics(
      [recursiveError(30)],
      recursiveSourceCode
    )
    expect(diagnostics).toEqual([
      ...recursiveHints,
      {
        from: 13,
        to: 41,
        message: `assert failed\n\nBacktrace:\n${Array(30).fill('f()').join('\n')}`,
        severity: 'error',
      },
    ])
  })

  it('elides the middle of a backtrace just over the limit', () => {
    const diagnostics = kclErrorsToDiagnostics(
      [recursiveError(31)],
      recursiveSourceCode
    )
    const lines = [
      ...Array(15).fill('f()'),
      '(1 frame omitted)',
      ...Array(15).fill('f()'),
    ]
    expect(diagnostics).toEqual([
      ...recursiveHints,
      {
        from: 13,
        to: 41,
        message: `assert failed\n\nBacktrace:\n${lines.join('\n')}`,
        severity: 'error',
      },
    ])
  })

  it('elides the middle of a deep backtrace', () => {
    const diagnostics = kclErrorsToDiagnostics(
      [recursiveError(40)],
      recursiveSourceCode
    )
    const lines = [
      ...Array(15).fill('f()'),
      '(10 frames omitted)',
      ...Array(15).fill('f()'),
    ]
    expect(diagnostics).toEqual([
      ...recursiveHints,
      {
        from: 13,
        to: 41,
        message: `assert failed\n\nBacktrace:\n${lines.join('\n')}`,
        severity: 'error',
      },
    ])
  })
})
