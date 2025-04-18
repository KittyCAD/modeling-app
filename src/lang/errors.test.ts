import type { KCLError } from '@src/lang/errors'
import { kclErrorsToDiagnostics } from '@src/lang/errors'
import { defaultArtifactGraph } from '@src/lang/std/artifactGraph'
import { topLevelRange } from '@src/lang/util'
import { errFromErrWithOutputs } from '@src/lang/wasm'

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

describe('test errFromErrWithOutputs', () => {
  it('converts KclErrorWithOutputs to KclError', () => {
    const blob =
      '{"error":{"kind":"internal","sourceRanges":[],"msg":"Cache busted"},"operations":[],"artifactCommands":[],"artifactGraph":{"map":{}},"filenames":{},"sourceFiles":{},"defaultPlanes":null}'
    const error = errFromErrWithOutputs(blob)
    const errorStr = JSON.stringify(error)
    expect(errorStr).toEqual(
      '{"kind":"internal","sourceRange":[0,0,0],"msg":"Cache busted","operations":[],"artifactCommands":[],"artifactGraph":{},"filenames":{},"defaultPlanes":null}'
    )
  })
})
