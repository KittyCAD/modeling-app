import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createCallExpressionStdLibKw,
  createExpressionStatement,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createVariableDeclaration,
} from '@src/lang/create'
import { pathsReferToSamePipe, replaceCallInPlace } from '@src/lang/modifyAst'
import { addTranslate } from '@src/lang/modifyAst/transforms'
import type {
  Artifact,
  ArtifactGraph,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { describe, expect, it } from 'vitest'

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

  it('preserves the object input when editing an upstream transform with a downstream pattern', () => {
    const wasmInstance = {} as ModuleType
    const extrudePath: PathToNode = [
      ['body', ''],
      [0, 'index'],
    ]
    const translatePath: PathToNode = [
      ['body', ''],
      [1, 'index'],
      ['expression', 'ExpressionStatement'],
    ]
    const patternPath: PathToNode = [
      ['body', ''],
      [2, 'index'],
    ]
    const extrudeRange: [number, number, number] = [0, 10, 0]
    const patternRange: [number, number, number] = [30, 60, 0]

    const ast: Node<Program> = {
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],
      preComments: [],
      commentStart: 0,
      body: [
        createVariableDeclaration('extrude001', createLiteral(0, wasmInstance)),
        createExpressionStatement(
          createCallExpressionStdLibKw(
            'translate',
            createLocalName('extrude001'),
            [createLabeledArg('x', createLiteral(5, wasmInstance))]
          )
        ),
        createVariableDeclaration(
          'pattern001',
          createCallExpressionStdLibKw(
            'patternLinear3d',
            createLocalName('extrude001'),
            []
          )
        ),
      ],
      nonCodeMeta: {
        nonCodeNodes: {},
        startNodes: [],
      },
    }
    const extrude: Extract<Artifact, { type: 'sweep' }> = {
      type: 'sweep',
      id: 'extrude-id',
      subType: 'extrusion',
      pathId: 'path-id',
      surfaceIds: [],
      edgeIds: [],
      codeRef: {
        range: extrudeRange,
        pathToNode: extrudePath,
        nodePath: { steps: [] },
      },
      trajectoryId: null,
      method: 'new',
      consumed: false,
      patternIds: ['pattern-id'],
    }
    const pattern: Extract<Artifact, { type: 'pattern' }> = {
      type: 'pattern',
      id: 'pattern-id',
      subType: 'linear',
      sourceId: extrude.id,
      copyIds: ['copy-id'],
      copyFaceIds: [],
      copyEdgeIds: [],
      codeRef: {
        range: patternRange,
        pathToNode: patternPath,
        nodePath: { steps: [] },
      },
    }
    const artifactGraph: ArtifactGraph = new Map<string, Artifact>([
      [extrude.id, extrude],
      [pattern.id, pattern],
    ])

    const result = addTranslate({
      ast,
      artifactGraph,
      objects: {
        graphSelections: [{ artifact: extrude, codeRef: extrude.codeRef }],
        otherSelections: [],
      },
      wasmInstance,
      x: {
        valueAst: createLiteral(6, wasmInstance),
        valueText: '6',
        valueCalculated: '6',
      },
      nodeToEdit: translatePath,
    })
    if (err(result)) {
      throw result
    }

    const editedStatement = result.modifiedAst.body[1]
    expect(editedStatement.type).toBe('ExpressionStatement')
    if (editedStatement.type !== 'ExpressionStatement') {
      throw new Error('Expected edited translate expression statement')
    }
    const editedCall = editedStatement.expression
    expect(editedCall.type).toBe('CallExpressionKw')
    if (editedCall.type !== 'CallExpressionKw') {
      throw new Error('Expected edited translate call')
    }
    expect(editedCall.unlabeled).toEqual(createLocalName('extrude001'))
    expect(editedCall.unlabeled).not.toEqual(createLocalName('pattern001'))
    expect(editedCall.arguments[0].arg).toEqual(createLiteral(6, wasmInstance))
  })
})
