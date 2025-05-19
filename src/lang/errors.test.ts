import type { KCLError } from '@src/lang/errors'
import { kclErrorsToDiagnostics } from '@src/lang/errors'
import { defaultArtifactGraph } from '@src/lang/std/artifactGraph'
import { topLevelRange } from '@src/lang/util'

describe('test kclErrToDiagnostic', () => {
  it('converts KCL errors to CodeMirror diagnostics', () => {
    const errors: KCLError[] = [
      {
        name: '',
        message: '',
        kind: 'semantic',
        msg: 'Semantic error',
        sourceRange: topLevelRange(0, 1),
        backtrace: [],
        nonFatal: [],
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
        backtrace: [],
        nonFatal: [],
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
