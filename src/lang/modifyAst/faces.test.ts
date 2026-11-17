import type {
  Artifact,
  CodeRef,
  CompositeSolidSubType,
} from '@rust/kcl-lib/bindings/Artifact'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { OpArg } from '@rust/kcl-lib/bindings/Operation'
import type { Program } from '@rust/kcl-lib/bindings/Program'

import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createTagDeclarator,
  createVariableDeclaration,
} from '@src/lang/create'
import {
  addOffsetPlane,
  buildSolidsAndFacesExprs,
  retrieveFaceSelectionsFromOpArgs,
} from '@src/lang/modifyAst/faces'
import {
  artifactToEntityRef,
  getNodeFromPath,
  resolveToCodeRef,
} from '@src/lang/queryAst'
import type { ArtifactGraph, CallExpressionKw } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@src/lib/commandBarConfigs/modelingCommandStdLib', () => ({
  modelingStdLibCall: vi.fn(),
  modelingStdLibCommandName: vi.fn(() => 'offsetPlane'),
}))

const codeRef: CodeRef = {
  range: [0, 0, 0],
  pathToNode: [['body', 'Program']],
  nodePath: { steps: [] },
}

describe('retrieveFaceSelectionsFromOpArgs', () => {
  it('retrieves a tagged wall when editing chained holes', () => {
    const path: Artifact = {
      type: 'path',
      id: 'region-1',
      subType: 'region',
      planeId: 'plane-1',
      segIds: ['segment-1'],
      consumed: true,
      sweepId: 'sweep-1',
      trajectorySweepId: null,
      codeRef,
    }
    const segment: Artifact = {
      type: 'segment',
      id: 'segment-1',
      pathId: path.id,
      edgeIds: [],
      commonSurfaceIds: ['wall-1'],
      codeRef,
    }
    const sweep: Artifact = {
      type: 'sweep',
      id: 'sweep-1',
      subType: 'extrusion',
      pathId: path.id,
      surfaceIds: ['wall-1'],
      edgeIds: [],
      codeRef,
      trajectoryId: null,
      method: 'merge',
      consumed: true,
    }
    const wall: Artifact = {
      type: 'wall',
      id: 'wall-1',
      segId: segment.id,
      sweepId: sweep.id,
      pathIds: [],
      edgeCutEdgeIds: [],
      faceCodeRef: codeRef,
      cmdId: 'wall-command-1',
    }
    const holeTool: Artifact = {
      type: 'sweep',
      id: 'hole-tool',
      subType: 'extrusion',
      pathId: 'hole-tool-path',
      surfaceIds: [],
      edgeIds: [],
      codeRef,
      trajectoryId: null,
      method: 'new',
      consumed: true,
    }
    const firstHole: Artifact = {
      type: 'compositeSolid',
      id: 'hole-1',
      consumed: true,
      subType: 'subtract',
      solidIds: [path.id],
      toolIds: [holeTool.id],
      codeRef,
      compositeSolidId: 'hole-2',
    }
    const secondHole: Artifact = {
      type: 'compositeSolid',
      id: 'hole-2',
      consumed: true,
      subType: 'subtract',
      solidIds: [firstHole.id],
      toolIds: [holeTool.id],
      codeRef,
      compositeSolidId: 'hole-3',
    }
    const artifactGraph: ArtifactGraph = new Map(
      [path, segment, sweep, wall, holeTool, firstHole, secondHole].map(
        (artifact) => [artifact.id, artifact]
      )
    )
    const faceArg: OpArg = {
      value: {
        type: 'TagIdentifier',
        value: 'line1',
        artifact_id: segment.id,
      },
      sourceRange: [0, 0, 0],
    }

    for (const hole of [firstHole, secondHole]) {
      const solidArg: OpArg = {
        value: { type: 'Solid', value: { artifactId: hole.id } },
        sourceRange: [0, 0, 0],
      }
      const result = retrieveFaceSelectionsFromOpArgs(
        solidArg,
        faceArg,
        artifactGraph
      )

      if (result instanceof Error) {
        throw result
      }
      expect(result.solids.graphSelections[0].artifact).toBe(hole)
      expect(
        resolveToCodeRef(result.faces.graphSelections[0], artifactGraph)
          ?.artifact
      ).toBe(wall)
    }
  })
})

// These codemods operate on typed ASTs and artifact lineage without executing KCL.
const wasmInstance = {} as ModuleType

type BooleanOperation = Exclude<CompositeSolidSubType, 'split'>

function faceBodyFixture({
  operations = [],
  source = 'target',
  face = 'end',
}: {
  operations?: BooleanOperation[]
  source?: 'target' | 'tool'
  face?: 'start' | 'end' | 'wall'
} = {}) {
  const ast: Node<Program> = {
    type: 'Program',
    body: [],
    start: 0,
    end: 10000,
    moduleId: 0,
    commentStart: 0,
  }
  const graph: ArtifactGraph = new Map()
  const addCall = (
    name: string,
    callee: string,
    input: string | null,
    args: ReturnType<typeof createLabeledArg>[] = []
  ): CodeRef => {
    const index = ast.body.length
    const call = createCallExpressionStdLibKw(
      callee,
      input ? createLocalName(input) : null,
      args
    )
    ast.body.push(createVariableDeclaration(name, call))
    return {
      range: [index * 10, index * 10 + 9, 0],
      pathToNode: [
        ['body', 'Program'],
        [index, 'index'],
        ['declaration', 'VariableDeclaration'],
        ['init', 'VariableDeclarator'],
      ],
      nodePath: { steps: [] },
    }
  }
  const profileRef = addCall('profile', 'line', null, [
    createLabeledArg('tag', createTagDeclarator(`${source}Wall`)),
  ])
  const path: Extract<Artifact, { type: 'path' }> = {
    type: 'path',
    id: 'profile',
    subType: 'region',
    planeId: 'XY',
    segIds: ['segment'],
    consumed: true,
    sweepId: source,
    trajectorySweepId: null,
    codeRef: profileRef,
  }
  const addSweep = (id: string): Extract<Artifact, { type: 'sweep' }> => {
    const sweep: Extract<Artifact, { type: 'sweep' }> = {
      type: 'sweep',
      id,
      subType: 'extrusion',
      pathId: id === source ? path.id : null,
      surfaceIds: [],
      edgeIds: [],
      trajectoryId: null,
      method: 'new',
      consumed: operations.length > 0,
      codeRef: addCall(id, 'extrude', 'profile', [
        createLabeledArg('tagStart', createTagDeclarator(`${id}Start`)),
        createLabeledArg('tagEnd', createTagDeclarator(`${id}End`)),
      ]),
    }
    graph.set(id, sweep)
    return sweep
  }
  const selected = addSweep(source)
  graph.set(path.id, path)
  let owner: Extract<Artifact, { type: 'sweep' | 'compositeSolid' }> = selected
  for (const [index, operation] of operations.entries()) {
    const other = addSweep(`other${index}`)
    const toolId = index === 0 && source === 'tool' ? selected.id : other.id
    const targetId: string =
      index === 0 && source === 'tool' ? other.id : owner.id
    const id = `solid${index}`
    if (owner.type === 'sweep') path.compositeSolidId = id
    else owner.compositeSolidId = id
    const composite: Artifact = {
      type: 'compositeSolid',
      id,
      subType: operation,
      consumed: index < operations.length - 1,
      solidIds: [targetId],
      toolIds: [toolId],
      codeRef: addCall(id, operation, targetId, [
        createLabeledArg('tools', createLocalName(toolId)),
      ]),
    }
    graph.set(id, composite)
    owner = composite
  }
  const segment: Artifact = {
    type: 'segment',
    id: 'segment',
    pathId: path.id,
    edgeIds: [],
    commonSurfaceIds: ['selected-face'],
    codeRef: profileRef,
  }
  const faceBase = {
    id: 'selected-face',
    sweepId: selected.id,
    pathIds: [],
    edgeCutEdgeIds: [],
    faceCodeRef: profileRef,
    cmdId: 'face-command',
  }
  const selectedFace: Artifact =
    face === 'wall'
      ? { ...faceBase, type: 'wall', segId: segment.id }
      : { ...faceBase, type: 'cap', subType: face }
  selected.surfaceIds = [selectedFace.id]
  graph.set(segment.id, segment)
  graph.set(selectedFace.id, selectedFace)
  const faces: Selections = {
    graphSelections: [
      {
        entityRef: artifactToEntityRef(selectedFace.type, selectedFace.id),
        codeRef: profileRef,
      },
    ],
    otherSelections: [],
  }
  return { ast, graph, faces }
}

describe('face body references', () => {
  it('offsets a cut face using the subtraction result instead of its consumed tool (#15234)', () => {
    const { ast, graph, faces } = faceBodyFixture({
      operations: ['subtract'],
      source: 'tool',
      face: 'wall',
    })
    const result = addOffsetPlane({
      ast,
      artifactGraph: graph,
      variables: {},
      plane: faces,
      wasmInstance,
      offset: {
        valueAst: createLiteral(1, wasmInstance),
        valueText: '1',
        valueCalculated: '1',
      },
    })
    if (result instanceof Error) throw result
    const offsetPlane = getNodeFromPath<CallExpressionKw>(
      result.modifiedAst,
      result.pathToNode,
      wasmInstance,
      'CallExpressionKw'
    )
    if (offsetPlane instanceof Error) throw offsetPlane
    expect(offsetPlane.node.unlabeled).toEqual(
      createCallExpressionStdLibKw('planeOf', createLocalName('solid0'), [
        createLabeledArg('face', createLocalName('toolWall')),
      ])
    )
  })

  it.each([
    ['subtract', 'tool', 'wall', 'toolWall'],
    ['subtract', 'target', 'end', 'targetEnd'],
    ['union', 'tool', 'start', 'toolStart'],
    ['union', 'target', 'wall', 'targetWall'],
    ['intersect', 'tool', 'end', 'toolEnd'],
    ['intersect', 'target', 'start', 'targetStart'],
  ] as const)(
    "uses the %s result for the %s input's %s face",
    (operation, source, face, tag) => {
      const { ast, graph, faces } = faceBodyFixture({
        operations: [operation],
        source,
        face,
      })
      const result = buildSolidsAndFacesExprs(faces, graph, ast, wasmInstance)
      if (result instanceof Error) throw result
      expect(result.solidsExpr).toEqual(createLocalName('solid0'))
      expect(result.facesExpr).toEqual(createLocalName(tag))
    }
  )

  it('keeps the selected face while following a chain of boolean results', () => {
    fc.assert(
      fc.property(
        fc.record({
          operations: fc.array(
            fc.constantFrom<BooleanOperation>('subtract', 'union', 'intersect'),
            { maxLength: 8 }
          ),
          source: fc.constantFrom('target' as const, 'tool' as const),
          face: fc.constantFrom(
            'start' as const,
            'end' as const,
            'wall' as const
          ),
        }),
        (options) => {
          const { ast, graph, faces } = faceBodyFixture(options)
          const result = buildSolidsAndFacesExprs(
            faces,
            graph,
            ast,
            wasmInstance
          )
          if (result instanceof Error) throw result
          const expectedBody = options.operations.length
            ? `solid${options.operations.length - 1}`
            : options.source
          const faceTags = { start: 'Start', end: 'End', wall: 'Wall' }
          expect(result.solidsExpr).toEqual(createLocalName(expectedBody))
          expect(result.facesExpr).toEqual(
            createLocalName(`${options.source}${faceTags[options.face]}`)
          )
        }
      ),
      { seed: 15234, numRuns: 200 }
    )
  })
})
