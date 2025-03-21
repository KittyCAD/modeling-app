import { kclErrorsToDiagnostics, KCLError } from './errors'
import { defaultArtifactGraph, topLevelRange } from 'lang/wasm'

describe('test kclErrToDiagnostic', () => {
  it('converts KCL errors to CodeMirror diagnostics', () => {
    const errors: KCLError[] = [
      {
        name: '',
        message: '',
        kind: 'semantic',
        msg: 'Semantic error',
        sourceRange: topLevelRange(0, 1),
        operations: [],
        artifactCommands: [],
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
        operations: [],
        artifactCommands: [],
        artifactGraph: defaultArtifactGraph(),
        filenames: {},
        defaultPlanes: null,
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
