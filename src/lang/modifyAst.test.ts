import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createArrayExpression,
  createCallExpressionStdLibKw,
  createExpressionStatement,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createVariableDeclaration,
} from '@src/lang/create'
import { pathsReferToSamePipe, replaceCallInPlace } from '@src/lang/modifyAst'
import { addHelix } from '@src/lang/modifyAst/geometry'
import {
  addPatternCircular3D,
  addPatternLinear3D,
} from '@src/lang/modifyAst/pattern3D'
import {
  addAppearance,
  addRotate,
  addScale,
  addTranslate,
} from '@src/lang/modifyAst/transforms'
import type {
  Artifact,
  ArtifactGraph,
  LabeledArg,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/commandBarConfigs/modelingCommandStdLibCommands', () => ({
  STD_LIB_COMMANDS: {},
}))

describe('editing calls in place', () => {
  const commandValue = (
    wasmInstance: ModuleType,
    value: number | string | boolean
  ): KclCommandValue => ({
    valueAst: createLiteral(value, wasmInstance),
    valueText: String(value),
    valueCalculated: String(value),
  })

  const arrayCommandValue = (
    wasmInstance: ModuleType,
    value: number[]
  ): KclCommandValue => ({
    valueAst: createArrayExpression(
      value.map((element) => createLiteral(element, wasmInstance))
    ),
    valueText: `[${value.join(', ')}]`,
    valueCalculated: `[${value.join(', ')}]`,
  })

  const createAstWithExpressionTransformAndDownstreamPattern = (
    wasmInstance: ModuleType,
    transformName: string,
    transformArgs: LabeledArg[]
  ) => {
    const extrudePath: PathToNode = [
      ['body', ''],
      [0, 'index'],
    ]
    const transformPath: PathToNode = [
      ['body', ''],
      [1, 'index'],
      ['expression', 'ExpressionStatement'],
    ]
    const patternPath: PathToNode = [
      ['body', ''],
      [2, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
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
            transformName,
            createLocalName('extrude001'),
            transformArgs
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
      copyIds: [],
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

    return {
      artifactGraph,
      ast,
      extrude,
      transformPath,
    }
  }

  const getEditedExpressionCall = (ast: Node<Program>) => {
    const editedStatement = ast.body[1]
    expect(editedStatement.type).toBe('ExpressionStatement')
    if (editedStatement.type !== 'ExpressionStatement') {
      throw new Error('Expected edited expression statement')
    }
    const editedCall = editedStatement.expression
    expect(editedCall.type).toBe('CallExpressionKw')
    if (editedCall.type !== 'CallExpressionKw') {
      throw new Error('Expected edited call')
    }
    return editedCall
  }

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

  it('preserves the object input when editing upstream rotate, scale, and appearance calls with downstream patterns', () => {
    const wasmInstance = {} as ModuleType

    for (const transformCase of ['rotate', 'scale', 'appearance'] as const) {
      const transformArgs =
        transformCase === 'rotate'
          ? [
              createLabeledArg('axis', createLocalName('Z')),
              createLabeledArg('angle', createLiteral(30, wasmInstance)),
            ]
          : transformCase === 'scale'
            ? [createLabeledArg('factor', createLiteral(2, wasmInstance))]
            : [
                createLabeledArg(
                  'color',
                  createLiteral('#ff0000', wasmInstance)
                ),
              ]
      const { artifactGraph, ast, extrude, transformPath } =
        createAstWithExpressionTransformAndDownstreamPattern(
          wasmInstance,
          transformCase,
          transformArgs
        )
      const objects = {
        graphSelections: [{ artifact: extrude, codeRef: extrude.codeRef }],
        otherSelections: [],
      }
      const result =
        transformCase === 'rotate'
          ? addRotate({
              ast,
              artifactGraph,
              objects,
              axis: 'Y',
              angle: commandValue(wasmInstance, 45),
              nodeToEdit: transformPath,
              wasmInstance,
            })
          : transformCase === 'scale'
            ? addScale({
                ast,
                artifactGraph,
                objects,
                factor: commandValue(wasmInstance, 3),
                nodeToEdit: transformPath,
                wasmInstance,
              })
            : addAppearance({
                ast,
                artifactGraph,
                objects,
                color: '#00ff00',
                nodeToEdit: transformPath,
                wasmInstance,
              })
      if (err(result)) {
        throw result
      }

      const editedCall = getEditedExpressionCall(result.modifiedAst)
      expect(editedCall.unlabeled).toEqual(createLocalName('extrude001'))
      expect(editedCall.unlabeled).not.toEqual(createLocalName('pattern001'))
    }
  })

  it('preserves the solid input when editing an upstream linear pattern with a later pattern child', () => {
    const wasmInstance = {} as ModuleType
    const extrudePath: PathToNode = [
      ['body', ''],
      [0, 'index'],
    ]
    const patternPath: PathToNode = [
      ['body', ''],
      [1, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
    ]
    const downstreamPatternPath: PathToNode = [
      ['body', ''],
      [2, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
    ]
    const extrudeRange: [number, number, number] = [0, 10, 0]
    const patternRange: [number, number, number] = [20, 60, 0]
    const downstreamPatternRange: [number, number, number] = [70, 120, 0]

    const ast: Node<Program> = {
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],
      preComments: [],
      commentStart: 0,
      body: [
        createVariableDeclaration('extrude001', createLiteral(0, wasmInstance)),
        createVariableDeclaration(
          'pattern001',
          createCallExpressionStdLibKw(
            'patternLinear3d',
            createLocalName('extrude001'),
            [
              createLabeledArg('instances', createLiteral(3, wasmInstance)),
              createLabeledArg('distance', createLiteral(5, wasmInstance)),
              createLabeledArg('axis', createLocalName('X')),
            ]
          )
        ),
        createVariableDeclaration(
          'pattern002',
          createCallExpressionStdLibKw(
            'patternCircular3d',
            createLocalName('pattern001'),
            [
              createLabeledArg('instances', createLiteral(3, wasmInstance)),
              createLabeledArg('axis', createLocalName('Z')),
              createLabeledArg(
                'center',
                createArrayExpression([
                  createLiteral(0, wasmInstance),
                  createLiteral(0, wasmInstance),
                  createLiteral(0, wasmInstance),
                ])
              ),
            ]
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
      patternIds: ['pattern-id', 'downstream-pattern-id'],
    }
    const pattern: Extract<Artifact, { type: 'pattern' }> = {
      type: 'pattern',
      id: 'pattern-id',
      subType: 'linear',
      sourceId: extrude.id,
      copyIds: [],
      copyFaceIds: [],
      copyEdgeIds: [],
      codeRef: {
        range: patternRange,
        pathToNode: patternPath,
        nodePath: { steps: [] },
      },
    }
    const downstreamPattern: Extract<Artifact, { type: 'pattern' }> = {
      type: 'pattern',
      id: 'downstream-pattern-id',
      subType: 'circular',
      sourceId: pattern.id,
      copyIds: [],
      copyFaceIds: [],
      copyEdgeIds: [],
      codeRef: {
        range: downstreamPatternRange,
        pathToNode: downstreamPatternPath,
        nodePath: { steps: [] },
      },
    }
    const artifactGraph: ArtifactGraph = new Map<string, Artifact>([
      [extrude.id, extrude],
      [pattern.id, pattern],
      [downstreamPattern.id, downstreamPattern],
    ])

    const result = addPatternLinear3D({
      ast,
      artifactGraph,
      solids: {
        graphSelections: [{ artifact: extrude, codeRef: extrude.codeRef }],
        otherSelections: [],
      },
      instances: commandValue(wasmInstance, 4),
      distance: commandValue(wasmInstance, 6),
      axis: 'Y',
      nodeToEdit: patternPath,
      wasmInstance,
    })
    if (err(result)) {
      throw result
    }

    const editedStatement = result.modifiedAst.body[1]
    expect(editedStatement.type).toBe('VariableDeclaration')
    if (editedStatement.type !== 'VariableDeclaration') {
      throw new Error('Expected edited pattern variable declaration')
    }
    const editedCall = editedStatement.declaration.init
    expect(editedCall.type).toBe('CallExpressionKw')
    if (editedCall.type !== 'CallExpressionKw') {
      throw new Error('Expected edited pattern call')
    }
    expect(editedCall.unlabeled).toEqual(createLocalName('extrude001'))
    expect(editedCall.unlabeled).not.toEqual(createLocalName('pattern002'))
    expect(editedCall.arguments[0].arg).toEqual(createLiteral(4, wasmInstance))
    expect(editedCall.arguments[1].arg).toEqual(createLiteral(6, wasmInstance))
  })

  it('preserves the solid input when editing an upstream circular pattern with a later pattern child', () => {
    const wasmInstance = {} as ModuleType
    const extrudePath: PathToNode = [
      ['body', ''],
      [0, 'index'],
    ]
    const patternPath: PathToNode = [
      ['body', ''],
      [1, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
    ]
    const downstreamPatternPath: PathToNode = [
      ['body', ''],
      [2, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
    ]
    const extrudeRange: [number, number, number] = [0, 10, 0]
    const patternRange: [number, number, number] = [20, 70, 0]
    const downstreamPatternRange: [number, number, number] = [80, 130, 0]

    const ast: Node<Program> = {
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],
      preComments: [],
      commentStart: 0,
      body: [
        createVariableDeclaration('extrude001', createLiteral(0, wasmInstance)),
        createVariableDeclaration(
          'pattern001',
          createCallExpressionStdLibKw(
            'patternCircular3d',
            createLocalName('extrude001'),
            [
              createLabeledArg('instances', createLiteral(3, wasmInstance)),
              createLabeledArg('axis', createLocalName('Z')),
              createLabeledArg(
                'center',
                createArrayExpression([
                  createLiteral(0, wasmInstance),
                  createLiteral(0, wasmInstance),
                  createLiteral(0, wasmInstance),
                ])
              ),
            ]
          )
        ),
        createVariableDeclaration(
          'pattern002',
          createCallExpressionStdLibKw(
            'patternLinear3d',
            createLocalName('pattern001'),
            [
              createLabeledArg('instances', createLiteral(3, wasmInstance)),
              createLabeledArg('distance', createLiteral(5, wasmInstance)),
              createLabeledArg('axis', createLocalName('X')),
            ]
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
      patternIds: ['pattern-id', 'downstream-pattern-id'],
    }
    const pattern: Extract<Artifact, { type: 'pattern' }> = {
      type: 'pattern',
      id: 'pattern-id',
      subType: 'circular',
      sourceId: extrude.id,
      copyIds: [],
      copyFaceIds: [],
      copyEdgeIds: [],
      codeRef: {
        range: patternRange,
        pathToNode: patternPath,
        nodePath: { steps: [] },
      },
    }
    const downstreamPattern: Extract<Artifact, { type: 'pattern' }> = {
      type: 'pattern',
      id: 'downstream-pattern-id',
      subType: 'linear',
      sourceId: pattern.id,
      copyIds: [],
      copyFaceIds: [],
      copyEdgeIds: [],
      codeRef: {
        range: downstreamPatternRange,
        pathToNode: downstreamPatternPath,
        nodePath: { steps: [] },
      },
    }
    const artifactGraph: ArtifactGraph = new Map<string, Artifact>([
      [extrude.id, extrude],
      [pattern.id, pattern],
      [downstreamPattern.id, downstreamPattern],
    ])

    const result = addPatternCircular3D({
      ast,
      artifactGraph,
      solids: {
        graphSelections: [{ artifact: extrude, codeRef: extrude.codeRef }],
        otherSelections: [],
      },
      instances: commandValue(wasmInstance, 4),
      axis: 'Y',
      center: arrayCommandValue(wasmInstance, [1, 2, 3]),
      nodeToEdit: patternPath,
      wasmInstance,
    })
    if (err(result)) {
      throw result
    }

    const editedStatement = result.modifiedAst.body[1]
    expect(editedStatement.type).toBe('VariableDeclaration')
    if (editedStatement.type !== 'VariableDeclaration') {
      throw new Error('Expected edited pattern variable declaration')
    }
    const editedCall = editedStatement.declaration.init
    expect(editedCall.type).toBe('CallExpressionKw')
    if (editedCall.type !== 'CallExpressionKw') {
      throw new Error('Expected edited pattern call')
    }
    expect(editedCall.unlabeled).toEqual(createLocalName('extrude001'))
    expect(editedCall.unlabeled).not.toEqual(createLocalName('pattern002'))
    expect(editedCall.arguments[0].arg).toEqual(createLiteral(4, wasmInstance))
    expect(editedCall.arguments[1].arg).toEqual(createLocalName('Y'))
  })

  it('preserves the cylinder input when editing an upstream helix with a later pattern child', () => {
    const wasmInstance = {} as ModuleType
    const extrudePath: PathToNode = [
      ['body', ''],
      [0, 'index'],
    ]
    const helixPath: PathToNode = [
      ['body', ''],
      [1, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
    ]
    const patternPath: PathToNode = [
      ['body', ''],
      [2, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
    ]
    const extrudeRange: [number, number, number] = [0, 10, 0]
    const patternRange: [number, number, number] = [80, 130, 0]

    const ast: Node<Program> = {
      start: 0,
      end: 0,
      moduleId: 0,
      outerAttrs: [],
      preComments: [],
      commentStart: 0,
      body: [
        createVariableDeclaration('extrude001', createLiteral(0, wasmInstance)),
        createVariableDeclaration(
          'helix001',
          createCallExpressionStdLibKw('helix', null, [
            createLabeledArg('revolutions', createLiteral(3, wasmInstance)),
            createLabeledArg('angleStart', createLiteral(0, wasmInstance)),
            createLabeledArg('cylinder', createLocalName('extrude001')),
          ])
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
      copyIds: [],
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

    const result = addHelix({
      ast,
      artifactGraph,
      cylinder: {
        graphSelections: [{ artifact: extrude, codeRef: extrude.codeRef }],
        otherSelections: [],
      },
      revolutions: commandValue(wasmInstance, 4),
      angleStart: commandValue(wasmInstance, 15),
      nodeToEdit: helixPath,
      wasmInstance,
    })
    if (err(result)) {
      throw result
    }

    const editedStatement = result.modifiedAst.body[1]
    expect(editedStatement.type).toBe('VariableDeclaration')
    if (editedStatement.type !== 'VariableDeclaration') {
      throw new Error('Expected edited helix variable declaration')
    }
    const editedCall = editedStatement.declaration.init
    expect(editedCall.type).toBe('CallExpressionKw')
    if (editedCall.type !== 'CallExpressionKw') {
      throw new Error('Expected edited helix call')
    }
    const cylinderArg = editedCall.arguments.find(
      (argument) => argument.label.name === 'cylinder'
    )
    expect(cylinderArg?.arg).toEqual(createLocalName('extrude001'))
    expect(cylinderArg?.arg).not.toEqual(createLocalName('pattern001'))
  })
})
