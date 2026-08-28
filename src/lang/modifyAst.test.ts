import type { Node } from '@rust/kcl-lib/bindings/Node'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLocalName,
  createVariableDeclaration,
  nonCodeMetaEmpty,
} from '@src/lang/create'
import { pathsReferToSamePipe, replaceCallInPlace } from '@src/lang/modifyAst'
import { addClone } from '@src/lang/modifyAst/transforms'
import type {
  Artifact,
  ArtifactGraph,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/commandBarConfigs/modelingCommandStdLibCommands', () => ({
  STD_LIB_COMMANDS: {},
}))

describe('editing calls in place', () => {
  it('preserves an existing unlabeled argument when reconstruction fails', () => {
    const inlineInput = createCallExpressionStdLibKw(
      'extrude',
      createLocalName('profile'),
      []
    )
    const existingCall = createCallExpressionStdLibKw(
      'translate',
      inlineInput,
      [createLabeledArg('x', createLocalName('oldX'))]
    )
    const replacementCall = createCallExpressionStdLibKw('translate', null, [
      createLabeledArg('x', createLocalName('newX')),
    ])

    replaceCallInPlace(existingCall, replacementCall)

    expect(existingCall.unlabeled).toEqual(inlineInput)
    expect(existingCall.arguments).toEqual(replacementCall.arguments)
    expect(replacementCall.unlabeled).toBeNull()
  })

  it('uses a reconstructed unlabeled argument when available', () => {
    const existingCall = createCallExpressionStdLibKw(
      'translate',
      createLocalName('oldBody'),
      []
    )
    const replacementInput = createLocalName('newBody')
    const replacementCall = createCallExpressionStdLibKw(
      'translate',
      replacementInput,
      []
    )

    replaceCallInPlace(existingCall, replacementCall)

    expect(existingCall.unlabeled).toEqual(replacementInput)
  })

  it('recognizes different calls in the same pipe', () => {
    const first: PathToNode = [
      ['body', ''],
      [0, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
      ['body', 'PipeExpression'],
      [1, 'index'],
    ]
    const second: PathToNode = [...first.slice(0, -1), [2, 'index']]

    expect(pathsReferToSamePipe(first, second)).toBe(true)
  })

  it('rejects paths from different pipes', () => {
    const first: PathToNode = [
      ['body', ''],
      [0, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
      ['body', 'PipeExpression'],
      [1, 'index'],
    ]
    const second: PathToNode = [
      ['body', ''],
      [1, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
      ['body', 'PipeExpression'],
      [1, 'index'],
    ]

    expect(pathsReferToSamePipe(first, second)).toBe(false)
  })

  it('rejects identical paths that are not inside a pipe', () => {
    const path: PathToNode = [
      ['body', ''],
      [0, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
    ]

    expect(pathsReferToSamePipe(path, path)).toBe(false)
  })

  it('edits clone calls in place instead of appending a duplicate declaration', () => {
    const sourceBodyPath: PathToNode = [
      ['body', ''],
      [0, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
    ]
    const cloneCallPath: PathToNode = [
      ['body', ''],
      [2, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
    ]
    const ast: Node<Program> = {
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],
      preComments: [],
      commentStart: 0,
      body: [
        createVariableDeclaration('extrude001', createLocalName('sourceBody')),
        createVariableDeclaration(
          'pattern001',
          createCallExpressionStdLibKw(
            'patternLinear3d',
            createLocalName('extrude001'),
            []
          )
        ),
        createVariableDeclaration(
          'clone001',
          createCallExpressionStdLibKw(
            'clone',
            createLocalName('originalInput'),
            []
          )
        ),
      ],
      nonCodeMeta: nonCodeMetaEmpty(),
    }
    const sourceSweep: Artifact = {
      type: 'sweep',
      id: 'source-sweep',
      subType: 'extrusion',
      pathId: 'source-path',
      surfaceIds: [],
      edgeIds: [],
      codeRef: {
        range: [0, 10, 0],
        nodePath: { steps: [] },
        pathToNode: sourceBodyPath,
      },
      sourceSweepId: null,
      trajectoryId: null,
      method: 'new',
      consumed: false,
    }
    const artifactGraph: ArtifactGraph = new Map([
      [sourceSweep.id, sourceSweep],
    ])

    const result = addClone({
      ast,
      artifactGraph,
      objects: {
        graphSelections: [
          { artifact: sourceSweep, codeRef: sourceSweep.codeRef },
        ],
        otherSelections: [],
      },
      variableName: 'clone001',
      nodeToEdit: cloneCallPath,
      wasmInstance: {} as ModuleType,
    })
    if (err(result)) {
      throw result
    }

    expect(result.pathToNode).toEqual(cloneCallPath)
    expect(result.modifiedAst.body).toHaveLength(ast.body.length)
    const cloneDeclaration = result.modifiedAst.body[2]
    expect(cloneDeclaration.type).toBe('VariableDeclaration')
    if (cloneDeclaration.type !== 'VariableDeclaration') {
      throw new Error('Expected clone declaration')
    }
    expect(cloneDeclaration.declaration.init).toMatchObject(
      createCallExpressionStdLibKw('clone', createLocalName('extrude001'), [])
    )
  })
})
