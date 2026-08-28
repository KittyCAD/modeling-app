import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  createCallExpressionStdLibKw,
  createLabeledArg,
  createLiteral,
  createLocalName,
  createVariableDeclaration,
} from '@src/lang/create'
import { addSplit } from '@src/lang/modifyAst/boolean'
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

describe('Boolean split edit input preservation', () => {
  it('preserves target and tool inputs when editing an upstream split with a downstream composite child', () => {
    const wasmInstance = {} as ModuleType
    const targetPath: PathToNode = [
      ['body', ''],
      [0, 'index'],
    ]
    const toolPath: PathToNode = [
      ['body', ''],
      [1, 'index'],
    ]
    const splitPath: PathToNode = [
      ['body', ''],
      [2, 'index'],
      ['declaration', 'VariableDeclaration'],
      ['init', 'VariableDeclarator'],
    ]
    const downstreamPath: PathToNode = [
      ['body', ''],
      [3, 'index'],
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
        createVariableDeclaration('extrude002', createLiteral(0, wasmInstance)),
        createVariableDeclaration(
          'split001',
          createCallExpressionStdLibKw('split', createLocalName('extrude001'), [
            createLabeledArg('tools', createLocalName('extrude002')),
            createLabeledArg('merge', createLiteral(false, wasmInstance)),
          ])
        ),
        createVariableDeclaration(
          'union001',
          createCallExpressionStdLibKw('union', createLocalName('split001'), [])
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
      compositeSolidId: 'split-id',
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
    const toolPathArtifact: Extract<Artifact, { type: 'path' }> = {
      ...targetPathArtifact,
      id: 'tool-path-id',
      sweepId: 'tool-sweep-id',
      compositeSolidId: null,
      codeRef: {
        range: [11, 20, 0],
        pathToNode: toolPath,
        nodePath: { steps: [] },
      },
    }
    const toolSweep: Extract<Artifact, { type: 'sweep' }> = {
      ...targetSweep,
      id: 'tool-sweep-id',
      pathId: toolPathArtifact.id,
      consumed: false,
      codeRef: {
        range: [11, 20, 0],
        pathToNode: toolPath,
        nodePath: { steps: [] },
      },
    }
    const splitArtifact: Extract<Artifact, { type: 'compositeSolid' }> = {
      type: 'compositeSolid',
      id: 'split-id',
      consumed: true,
      subType: 'split',
      outputIndex: null,
      solidIds: [targetSweep.id],
      toolIds: [toolSweep.id],
      compositeSolidId: 'downstream-union-id',
      codeRef: {
        range: [21, 40, 0],
        pathToNode: splitPath,
        nodePath: { steps: [] },
      },
    }
    const downstreamUnion: Extract<Artifact, { type: 'compositeSolid' }> = {
      type: 'compositeSolid',
      id: 'downstream-union-id',
      consumed: false,
      subType: 'union',
      outputIndex: null,
      solidIds: [splitArtifact.id],
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
      [toolPathArtifact.id, toolPathArtifact],
      [toolSweep.id, toolSweep],
      [splitArtifact.id, splitArtifact],
      [downstreamUnion.id, downstreamUnion],
    ])
    const targets: Selections = {
      graphSelections: [
        { artifact: targetPathArtifact, codeRef: targetPathArtifact.codeRef },
      ],
      otherSelections: [],
    }
    const tools: Selections = {
      graphSelections: [
        { artifact: toolPathArtifact, codeRef: toolPathArtifact.codeRef },
      ],
      otherSelections: [],
    }

    const result = addSplit({
      ast,
      artifactGraph,
      targets,
      tools,
      merge: true,
      nodeToEdit: splitPath,
      wasmInstance,
    })
    if (err(result)) {
      throw result
    }

    const editedDeclaration = result.modifiedAst.body[2]
    expect(editedDeclaration.type).toBe('VariableDeclaration')
    if (editedDeclaration.type !== 'VariableDeclaration') {
      throw new Error('Expected edited split variable declaration')
    }
    const editedCall = editedDeclaration.declaration.init
    expect(editedCall.type).toBe('CallExpressionKw')
    if (editedCall.type !== 'CallExpressionKw') {
      throw new Error('Expected edited split call')
    }
    expect(editedCall.unlabeled).toEqual(createLocalName('extrude001'))
    expect(editedCall.unlabeled).not.toEqual(createLocalName('union001'))
  })
})
