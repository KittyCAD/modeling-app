import { kclErrorsToDiagnostics, KCLError } from './errors'

describe('test kclErrToDiagnostic', () => {
  it('converts KCL errors to CodeMirror diagnostics', () => {
    const errors: KCLError[] = [
      {
        name: '',
        message: '',
        kind: 'semantic',
        msg: 'Semantic error',
        sourceRange: [0, 1, true],
        operations: [],
        artifactCommands: [],
      },
      {
        name: '',
        message: '',
        kind: 'type',
        msg: 'Type error',
        sourceRange: [4, 5, true],
        operations: [],
        artifactCommands: [],
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
        from: 4,
        to: 5,
        message: 'Type error',
        severity: 'error',
      },
    ])
  })
})
