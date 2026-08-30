import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createCallExpressionStdLibKw,
  createExpressionStatement,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createVariableDeclaration,
} from '@src/lang/create'
import { addAppearance } from '@src/lang/modifyAst/transforms'
import type {
  Artifact,
  ArtifactGraph,
  PathToNode,
  Program,
} from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { describe, expect, it } from 'vitest'

describe('Appearance edit input preservation', () => {
  it('preserves the existing object when editing appearance with a downstream composite child', () => {
    const wasmInstance = {} as ModuleType
    const targetPath: PathToNode = [
      ['body', ''],
      [0, 'index'],
    ]
    const appearancePath: PathToNode = [
      ['body', ''],
      [1, 'index'],
      ['expression', 'ExpressionStatement'],
    ]
    const downstreamPath: PathToNode = [
      ['body', ''],
      [2, 'index'],
    ]

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
            'appearance',
            createLocalName('extrude001'),
            [createLabeledArg('color', createLiteral('#FF0000', wasmInstance))]
          )
        ),
        createVariableDeclaration(
          'union001',
          createCallExpressionStdLibKw(
            'union',
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

    const targetPathArtifact: Extract<Artifact, { type: 'path' }> = {
      type: 'path',
      id: 'target-path-id',
      subType: 'sketch',
      planeId: 'plane-id',
      segIds: [],
      consumed: true,
      sweepId: 'target-sweep-id',
      trajectorySweepId: null,
      solid2dId: null,
      compositeSolidId: 'downstream-union-id',
      codeRef: {
        range: [0, 10, 0],
        pathToNode: targetPath,
        nodePath: { steps: [] },
      },
    }
    const targetSweep: Extract<Artifact, { type: 'sweep' }> = {
      type: 'sweep',
      id: 'target-sweep-id',
      subType: 'extrusion',
      pathId: targetPathArtifact.id,
      surfaceIds: [],
      edgeIds: [],
      codeRef: {
        range: [0, 10, 0],
        pathToNode: targetPath,
        nodePath: { steps: [] },
      },
      trajectoryId: null,
      method: 'new',
      consumed: true,
    }
    const downstreamUnion: Extract<Artifact, { type: 'compositeSolid' }> = {
      type: 'compositeSolid',
      id: 'downstream-union-id',
      consumed: false,
      subType: 'union',
      outputIndex: null,
      solidIds: [targetSweep.id],
      toolIds: [],
      codeRef: {
        range: [41, 60, 0],
        pathToNode: downstreamPath,
        nodePath: { steps: [] },
      },
    }
    const artifactGraph: ArtifactGraph = new Map<string, Artifact>([
      [targetPathArtifact.id, targetPathArtifact],
      [targetSweep.id, targetSweep],
      [downstreamUnion.id, downstreamUnion],
    ])
    const objects: Selections = {
      graphSelections: [
        { artifact: targetPathArtifact, codeRef: targetPathArtifact.codeRef },
      ],
      otherSelections: [],
    }

    const result = addAppearance({
      ast,
      artifactGraph,
      objects,
      color: '#00FF00',
      nodeToEdit: appearancePath,
      wasmInstance,
    })
    if (err(result)) {
      throw result
    }

    const editedStatement = result.modifiedAst.body[1]
    expect(editedStatement.type).toBe('ExpressionStatement')
    if (editedStatement.type !== 'ExpressionStatement') {
      throw new Error('Expected edited appearance expression statement')
    }
    const editedCall = editedStatement.expression
    expect(editedCall.type).toBe('CallExpressionKw')
    if (editedCall.type !== 'CallExpressionKw') {
      throw new Error('Expected edited appearance call')
    }
    expect(editedCall.unlabeled).toEqual(createLocalName('extrude001'))
    expect(editedCall.unlabeled).not.toEqual(createLocalName('union001'))
  })
})
