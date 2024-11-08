import { kclErrorsToDiagnostics, KCLError } from './errors'

describe('test kclErrToDiagnostic', () => {
  it('converts KCL errors to CodeMirror diagnostics', () => {
    const errors: KCLError[] = [
      {
        name: '',
        message: '',
        kind: 'semantic',
        msg: 'Semantic error',
        sourceRanges: [
          [0, 1, 0],
          [2, 3, 0],
        ],
      },
      {
        name: '',
        message: '',
        kind: 'type',
        msg: 'Type error',
        sourceRanges: [
          [4, 5, 0],
          [6, 7, 0],
        ],
      },
    ]
    const diagnostics = kclErrorsToDiagnostics(errors)
    expect(diagnostics).toEqual([
      {
        from: 0,
        to: 1,
        message: 'Semantic error',
        severity: 'error',
      },
      {
        from: 2,
        to: 3,
        message: 'Semantic error',
        severity: 'error',
      },
      {
        from: 4,
        to: 5,
        message: 'Type error',
        severity: 'error',
      },
      {
        from: 6,
        to: 7,
        message: 'Type error',
        severity: 'error',
      },
    ])
  })
})
