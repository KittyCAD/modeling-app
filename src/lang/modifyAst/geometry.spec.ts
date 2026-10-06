import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { KclManager } from '@src/lang/KclManager'
import { createVariableDeclaration } from '@src/lang/create'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { addHelix, getAxisExpression } from '@src/lang/modifyAst/geometry'
import { addExtrude, addRevolve } from '@src/lang/modifyAst/sweeps'
import { artifactToEntityRef, getSketchSegmentName } from '@src/lang/queryAst'
import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import {
  type Artifact,
  type ArtifactGraph,
  type CodeRef,
  type Name,
  assertParse,
  recast,
} from '@src/lang/wasm'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type RustContext from '@src/lib/rustContext'
import {
  createSelectionFromArtifacts,
  createSelectionFromPathArtifact,
  enginelessExecutor,
  getAstAndArtifactGraph,
  getKclCommandValue,
  getWalls,
  runNewAstAndCountSweeps,
} from '@src/lib/testHelpers'
import { err, isErr } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  buildTheWorldAndConnectToEngine,
  buildTheWorldAndNoEngineConnection,
} from '@src/unitTestUtils'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

let instanceInThisFile: ModuleType = null!
let kclManagerInThisFile: KclManager = null!
let engineCommandManagerInThisFile: ConnectionManager = null!
let rustContextInThisFile: RustContext = null!

/**
 * Every it test could build the world and connect to the engine but this is too resource intensive and will
 * spam engine connections.
 *
 * Reuse the world for this file. This is not the same as global singleton imports!
 */
beforeEach(async () => {
  if (instanceInThisFile) {
    return
  }

  const { instance, kclManager, engineCommandManager, rustContext } =
    await buildTheWorldAndConnectToEngine({ webrtc: false, pool: 'cpu' })
  instanceInThisFile = instance
  kclManagerInThisFile = kclManager
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})
afterAll(() => {
  engineCommandManagerInThisFile.tearDown({
    route: 'user-requested',
    initiatedBy: 'client',
  })
})

const faceAxisCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)
sketch001 = sketch(on = XY) {
  line1 = line(start = [0mm, 0mm], end = [10mm, 0mm])
  line2 = line(start = [10mm, 0mm], end = [10mm, 10mm])
  line3 = line(start = [10mm, 10mm], end = [0mm, 10mm])
  line4 = line(start = [0mm, 10mm], end = [0mm, 0mm])
}
region001 = region(segments = [sketch001.line1, sketch001.line2, sketch001.line3, sketch001.line4])
extrude001 = extrude(region001, length = 5mm)
fillet001 = fillet(extrude001, edges = [{ sideFaces = [region001.tags.line1, END] }], radius = 1mm)`

function createFaceAxisFixture() {
  const ast = assertParse(faceAxisCode, instanceInThisFile)
  const codeRef = (text: string): CodeRef => {
    const start = faceAxisCode.indexOf(text)
    if (start < 0) throw new Error(`Missing fixture source: ${text}`)
    return {
      ...codeRefFromRange([start, start + text.length, 0], ast),
      nodePath: { steps: [] },
    }
  }
  const sketchRef = codeRef(
    faceAxisCode.slice(
      faceAxisCode.indexOf('sketch(on'),
      faceAxisCode.indexOf('\nregion001')
    )
  )
  const regionRef = codeRef(
    'region(segments = [sketch001.line1, sketch001.line2, sketch001.line3, sketch001.line4])'
  )
  const sweepRef = codeRef('extrude(region001, length = 5mm)')
  const sketchSegment: Extract<Artifact, { type: 'segment' }> = {
    type: 'segment',
    id: 'sketch-segment',
    pathId: 'sketch-path',
    codeRef: codeRef('line(start = [0mm, 0mm], end = [10mm, 0mm])'),
    edgeIds: [],
    commonSurfaceIds: [],
  }
  const regionSegment: Extract<Artifact, { type: 'segment' }> = {
    ...sketchSegment,
    id: 'region-segment',
    pathId: 'region-path',
    codeRef: regionRef,
    originalSegId: sketchSegment.id,
    commonSurfaceIds: ['wall', 'end-cap'],
  }
  const wall: Extract<Artifact, { type: 'wall' }> = {
    type: 'wall',
    id: 'wall',
    sweepId: 'sweep',
    segId: regionSegment.id,
    edgeCutEdgeIds: [],
    pathIds: [],
    faceCodeRef: regionRef,
    cmdId: 'wall-command',
  }
  const cut: Extract<Artifact, { type: 'edgeCut' }> = {
    type: 'edgeCut',
    id: 'cut',
    subType: 'fillet',
    edgeIds: [],
    codeRef: codeRef(
      faceAxisCode.slice(faceAxisCode.indexOf('fillet(extrude001'))
    ),
  }
  const artifacts: Artifact[] = [
    sketchSegment,
    regionSegment,
    wall,
    cut,
    {
      type: 'path',
      id: 'sketch-path',
      subType: 'sketch',
      planeId: 'plane',
      segIds: [sketchSegment.id],
      consumed: false,
      trajectorySweepId: null,
      codeRef: sketchRef,
    },
    {
      type: 'path',
      id: 'region-path',
      subType: 'region',
      planeId: 'plane',
      segIds: [regionSegment.id],
      consumed: true,
      sweepId: 'sweep',
      trajectorySweepId: null,
      codeRef: regionRef,
    },
    {
      type: 'sweep',
      id: 'sweep',
      subType: 'extrusion',
      pathId: 'region-path',
      surfaceIds: ['wall', 'end-cap', 'start-cap'],
      edgeIds: [],
      trajectoryId: null,
      method: 'new',
      consumed: false,
      codeRef: sweepRef,
    },
    ...(['start', 'end'] as const).map(
      (subType): Artifact => ({
        type: 'cap',
        id: `${subType}-cap`,
        subType,
        sweepId: 'sweep',
        edgeCutEdgeIds: [],
        pathIds: [],
        faceCodeRef: sweepRef,
        cmdId: `${subType}-command`,
      })
    ),
  ]
  const graph: ArtifactGraph = new Map(
    artifacts.map((artifact) => [artifact.id, artifact])
  )
  return { ast, graph, sketchSegment, wall, cut }
}

function createLegacyAxisFixture() {
  const code = `@settings(kclVersion = 1.0)
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 1)`
  const ast = assertParse(code, instanceInThisFile)
  const start = code.indexOf('xLine(')
  const codeRef: CodeRef = {
    ...codeRefFromRange([start, code.length, 0], ast),
    nodePath: { steps: [] },
  }
  const segment: Extract<Artifact, { type: 'segment' }> = {
    type: 'segment',
    id: 'segment',
    pathId: 'path',
    codeRef,
    edgeIds: [],
    commonSurfaceIds: [],
  }
  const graph: ArtifactGraph = new Map([[segment.id, segment]])
  return { ast, graph, segment }
}

function generateAxis(
  ast: ReturnType<typeof assertParse>,
  graph: ArtifactGraph,
  selection: Selection
) {
  const originalAst = structuredClone(ast)
  const result = getAxisExpression(
    undefined,
    { graphSelections: [selection], otherSelections: [] },
    ast,
    instanceInThisFile,
    graph
  )
  if (isErr(result)) throw result
  expect(ast).toEqual(originalAst)
  const output = structuredClone(result.modifiedAst)
  output.body.push(
    createVariableDeclaration('axisResult', result.generatedAxis)
  )
  const code = recast(output, instanceInThisFile)
  if (isErr(code)) throw code
  return code.replace(/\s+/g, '')
}

describe('getAxisExpression', () => {
  it.each(['extrude', 'revolve'] as const)(
    'preserves a face API edge selector when generating %s',
    async (command) => {
      const code = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)
baseSketch = sketch(on = XY) {
  bottom = line(start = [0mm, 0mm], end = [10mm, 0mm])
  right = line(start = [10mm, 0mm], end = [10mm, 10mm])
  top = line(start = [10mm, 10mm], end = [0mm, 10mm])
  left = line(start = [0mm, 10mm], end = [0mm, 0mm])
}
baseRegion = region(segments = [baseSketch.bottom, baseSketch.right, baseSketch.top, baseSketch.left])
body = extrude(baseRegion, length = 5mm, tagStart = $baseStart, tagEnd = $baseEnd)
profileSketch = sketch(on = ${command === 'extrude' ? 'XY' : 'XZ'}) {
  circle1 = circle(start = [21mm, 5mm], center = [20mm, 5mm])
}
profileRegion = region(segments = [profileSketch.circle1])`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const artifacts = [...artifactGraph.values()]
      const walls = ['bottom', 'left'].map((name) => {
        const wall = artifacts.find((artifact) => {
          if (artifact.type !== 'wall') return false
          const segment = artifactGraph.get(artifact.segId)
          return (
            segment?.type === 'segment' &&
            getSketchSegmentName(
              ast,
              segment.originalSegId ?? segment.id,
              artifactGraph,
              instanceInThisFile
            ) === name
          )
        })
        if (wall?.type !== 'wall') throw new Error(`Missing ${name} wall`)
        return wall
      })
      const caps = (['start', 'end'] as const).map((subType) => {
        const cap = artifacts.find(
          (artifact) => artifact.type === 'cap' && artifact.subType === subType
        )
        if (cap?.type !== 'cap') throw new Error(`Missing ${subType} cap`)
        return cap
      })
      const profile = artifacts.findLast((artifact) => artifact.type === 'path')
      if (!profile) throw new Error('Missing profile region')
      const sketches = createSelectionFromArtifacts([profile], artifactGraph)
      const edge: Selections = {
        graphSelections: [
          {
            entityRef: {
              type: 'edge',
              side_faces: walls.map(({ id }) => id),
              end_faces: caps.map(({ id }) => id),
              index: 0,
            },
            codeRef: walls[0].faceCodeRef,
          },
        ],
        otherSelections: [],
      }
      const value = await getKclCommandValue(
        command === 'extrude' ? '3mm' : '90deg',
        instanceInThisFile,
        rustContextInThisFile
      )
      const args = {
        ast,
        artifactGraph,
        sketches,
        wasmInstance: instanceInThisFile,
      }
      const result =
        command === 'extrude'
          ? addExtrude({ ...args, length: value, direction: edge })
          : addRevolve({ ...args, angle: value, edge })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode
      const axisArgument = command === 'extrude' ? 'direction' : 'axis'
      expect(newCode.replace(/\s+/g, '')).toContain(
        `${axisArgument}={sideFaces=[baseRegion.tags.bottom,baseRegion.tags.left],endFaces=[baseStart,baseEnd],index=0}`
      )
      expect(newCode).toContain(`${command}(\n  profileRegion,`)
      await runNewAstAndCountSweeps(
        result.modifiedAst,
        rustContextInThisFile,
        2
      )
    }
  )

  it.each(['X', 'Y', 'Z'])(
    'should return axis expression for default axis %s',
    async (axis) => {
      const { instance } = await buildTheWorldAndNoEngineConnection()
      const ast = assertParse('', instance)
      const result = getAxisExpression(axis, undefined, ast, instanceInThisFile)
      if (err(result)) throw result
      expect(result.generatedAxis.type).toEqual('Name')
      expect((result.generatedAxis as Node<Name>).name.name).toEqual(axis)
    }
  )

  it('should return a generated axis pointing to the selected segment', async () => {
    const { ast, artifactGraph } = await getAstAndArtifactGraph(
      `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 1)`,
      instanceInThisFile,
      kclManagerInThisFile
    )
    const edgeArtifact = [...artifactGraph.values()].find(
      (a) => a.type === 'segment'
    )
    const edge: Selections = createSelectionFromPathArtifact(
      [edgeArtifact!],
      artifactGraph
    )
    const result = getAxisExpression(
      undefined,
      edge,
      ast,
      instanceInThisFile,
      artifactGraph
    )
    if (err(result)) throw result
    expect(result.generatedAxis.type).toEqual('Name')
    expect((result.generatedAxis as Node<Name>).name.name).toEqual('seg01')
    expect(recast(result.modifiedAst, instanceInThisFile)).toContain(
      `xLine(length = 1, tag = $seg01)`
    )
  })

  it('should error if nothing is provided', async () => {
    const { instance } = await buildTheWorldAndNoEngineConnection()
    const result = getAxisExpression(
      undefined,
      undefined,
      assertParse('', instance),
      instanceInThisFile
    )
    expect(result).toBeInstanceOf(Error)
  })

  it('preserves the edge-cut inference contract for a graph with consumed-edge associations', () => {
    const { ast, graph, wall, cut } = createFaceAxisFixture()
    // This is a compatibility fixture for the existing inference branch.
    // Current face-API execution does not produce this consumed-edge association.
    if (!wall.edgeCutEdgeIds) {
      throw new Error('Expected compatibility edge-cut associations')
    }
    wall.edgeCutEdgeIds.push(cut.id)
    const code = generateAxis(ast, graph, {
      entityRef: { type: 'face', face_id: cut.id },
      codeRef: cut.codeRef,
    })
    expect(code).toContain('extrude(region001,length=5mm,tagEnd=$capEnd001)')
    expect(code).toContain(
      'axisResult={sideFaces=[region001.tags.line1,capEnd001]}'
    )
  })

  it('preserves explicit face-reference disambiguators', () => {
    const { ast, graph, sketchSegment } = createFaceAxisFixture()
    const code = generateAxis(ast, graph, {
      entityRef: {
        type: 'edge',
        side_faces: ['wall', 'end-cap'],
        end_faces: ['start-cap'],
        index: 0,
      },
      codeRef: sketchSegment.codeRef,
    })
    expect(code).toContain(
      'axisResult={sideFaces=[region001.tags.line1,capEnd001],endFaces=[capStart001],index=0}'
    )
    expect(code).toContain('tagStart=$capStart001')
  })

  it('uses the selected sketch segment when the legacy artifact describes its wall', () => {
    const { ast, graph, sketchSegment, wall } = createFaceAxisFixture()
    const code = generateAxis(ast, graph, {
      entityRef: {
        type: 'segment',
        path_id: sketchSegment.pathId,
        segment_id: sketchSegment.id,
      },
      artifact: wall,
      codeRef: wall.faceCodeRef,
    })
    expect(code).toContain('axisResult=sketch001.line1')
    expect(code).not.toContain('tag=')
  })

  it.each(['range', 'path'] as const)(
    'recovers a legacy sketch segment by source %s when its entity ID is absent',
    (lookup) => {
      const { ast, graph, segment } = createLegacyAxisFixture()
      const code = generateAxis(ast, graph, {
        entityRef: { type: 'segment', path_id: 'path', segment_id: 'missing' },
        codeRef:
          lookup === 'range'
            ? segment.codeRef
            : { ...segment.codeRef, range: [0, 0, 0] },
      })
      expect(code).toContain('xLine(length=1,tag=$seg01)')
      expect(code).toContain('axisResult=seg01')
    }
  )

  it('resolves a legacy segment entity without a selection code reference', () => {
    const { ast, graph, segment } = createLegacyAxisFixture()
    const code = generateAxis(ast, graph, {
      entityRef: {
        type: 'segment',
        path_id: segment.pathId,
        segment_id: segment.id,
      },
    })
    expect(code).toContain('xLine(length=1,tag=$seg01)')
    expect(code).toContain('axisResult=seg01')
  })

  it('recovers a legacy segment AST path from its source range', () => {
    const { ast, graph, segment } = createLegacyAxisFixture()
    segment.codeRef.pathToNode = []
    const code = generateAxis(ast, graph, {
      entityRef: {
        type: 'segment',
        path_id: segment.pathId,
        segment_id: segment.id,
      },
      codeRef: segment.codeRef,
    })
    expect(code).toContain('xLine(length=1,tag=$seg01)')
    expect(code).toContain('axisResult=seg01')
  })

  it('returns the existing resolution error for a fillet face without consumed-edge lineage', async () => {
    const code = faceAxisCode
      .replace('length = 5mm)', 'length = 5mm, tagEnd = $capEnd001)')
      .replace(', END]', ', capEnd001]')
      .replace('radius = 1mm)', 'radius = 1mm, tag = $roundFace)')
    const { ast, artifactGraph } = await getAstAndArtifactGraph(
      code,
      instanceInThisFile,
      kclManagerInThisFile
    )
    expect(kclManagerInThisFile.errors).toEqual([])
    const cut = [...artifactGraph.values()].find(
      (artifact) => artifact.type === 'edgeCut'
    )
    if (!cut || cut.type !== 'edgeCut') throw new Error('Fillet face not found')
    expect(cut.edgeIds).toEqual([])
    expect(
      [...artifactGraph.values()].some(
        (artifact) =>
          (artifact.type === 'wall' || artifact.type === 'cap') &&
          artifact.edgeCutEdgeIds?.includes(cut.id)
      )
    ).toBe(false)
    const originalAst = structuredClone(ast)
    // Both original helpers failed here: segment tagging needs edge-cut
    // metadata, and the body fallback cannot recover the missing lineage.
    const result = getAxisExpression(
      undefined,
      {
        graphSelections: [
          {
            entityRef: { type: 'face', face_id: cut.id },
            codeRef: cut.codeRef,
          },
        ],
        otherSelections: [],
      },
      ast,
      instanceInThisFile,
      artifactGraph
    )
    expect(result).toEqual(
      new Error(
        'edgeCut artifact has no edge_ids or consumedEdgeId; cannot resolve sweep'
      )
    )
    expect(ast).toEqual(originalAst)
  })
})

describe('geometry.test.ts', () => {
  describe('Testing addHelix', () => {
    it('should add a standalone call on default axis selection', async () => {
      const expectedNewLine = `helix001 = helix(
  axis = X,
  revolutions = 1,
  angleStart = 2,
  radius = 3,
  length = 4,
)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        '',
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addHelix({
        ast,
        artifactGraph,
        axis: 'X',
        revolutions: (await stringToKclExpression(
          '1',
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '2',
          rustContextInThisFile
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '3',
          rustContextInThisFile
        )) as KclCommandValue,
        length: (await stringToKclExpression(
          '4',
          rustContextInThisFile
        )) as KclCommandValue,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(expectedNewLine)
    })

    it('should add a standalone call on default axis selection with ccw true', async () => {
      const expectedNewLine = `helix001 = helix(
  axis = X,
  revolutions = 1,
  angleStart = 2,
  radius = 3,
  length = 4,
  ccw = true,
)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        '',
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addHelix({
        ast,
        artifactGraph,
        axis: 'X',
        revolutions: (await stringToKclExpression(
          '1',
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '2',
          rustContextInThisFile
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '3',
          rustContextInThisFile
        )) as KclCommandValue,
        length: (await stringToKclExpression(
          '4',
          rustContextInThisFile
        )) as KclCommandValue,
        ccw: true,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(expectedNewLine)
    })

    it('should edit a standalone call with default axis selection', async () => {
      const code = `helix001 = helix(
  axis = X,
  revolutions = 1,
  angleStart = 2,
  radius = 3,
  length = 4,
)`
      const expectedNewLine = `helix001 = helix(
  axis = Y,
  revolutions = 11,
  angleStart = 12,
  radius = 13,
  length = 14,
)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addHelix({
        ast,
        artifactGraph,
        axis: 'Y',
        revolutions: (await stringToKclExpression(
          '11',
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '12',
          rustContextInThisFile
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '13',
          rustContextInThisFile
        )) as KclCommandValue,
        length: (await stringToKclExpression(
          '14',
          rustContextInThisFile
        )) as KclCommandValue,
        nodeToEdit: createPathToNodeForLastVariable(ast),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).not.toContain(code)
      expect(newCode).toContain(expectedNewLine)
    })

    const segmentInPath = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0, 0])
  |> yLine(length = 100)
  |> line(endAbsolute = [100, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`

    const helixFromSegmentInPath = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0, 0])
  |> yLine(length = 100, tag = $seg01)
  |> line(endAbsolute = [100, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
helix001 = helix(
  axis = seg01,
  revolutions = 1,
  angleStart = 2,
  radius = 3,
)
`

    it('should add a standalone call on segment selection', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        segmentInPath,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const segment = [...artifactGraph.values()].find(
        (n) => n.type === 'segment'
      )
      const edge = createSelectionFromArtifacts([segment!], artifactGraph)
      const result = addHelix({
        ast,
        artifactGraph,
        edge,
        revolutions: (await stringToKclExpression(
          '1',
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '2',
          rustContextInThisFile
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '3',
          rustContextInThisFile
        )) as KclCommandValue,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toBe(helixFromSegmentInPath)
    })

    it('should edit a standalone call on segment selection', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        helixFromSegmentInPath,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const segment = [...artifactGraph.values()].find(
        (n) => n.type === 'segment'
      )
      const edge: Selections = {
        graphSelections: [
          {
            artifact: segment,
            codeRef: segment!.codeRef,
          },
        ],
        otherSelections: [],
      }
      const result = addHelix({
        ast,
        artifactGraph,
        edge,
        revolutions: (await stringToKclExpression(
          '4',
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '5',
          rustContextInThisFile
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '6',
          rustContextInThisFile
        )) as KclCommandValue,
        ccw: true,
        nodeToEdit: createPathToNodeForLastVariable(ast),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`helix001 = helix(
  axis = seg01,
  revolutions = 4,
  angleStart = 5,
  radius = 6,
  ccw = true,
)`)
    })

    it('should edit a standalone call on segment selection', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        helixFromSegmentInPath,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const segment = [...artifactGraph.values()].find(
        (n) => n.type === 'segment'
      )
      const edge: Selections = {
        graphSelections: [
          {
            entityRef: artifactToEntityRef(segment!.type, segment!.id),
            codeRef: segment!.codeRef,
          },
        ],
        otherSelections: [],
      }
      const result = addHelix({
        ast,
        artifactGraph,
        edge,
        revolutions: (await stringToKclExpression(
          '4',
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '5',
          rustContextInThisFile
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '6',
          rustContextInThisFile
        )) as KclCommandValue,
        ccw: true,
        nodeToEdit: createPathToNodeForLastVariable(ast),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`helix001 = helix(
  axis = seg01,
  revolutions = 4,
  angleStart = 5,
  radius = 6,
  ccw = true,
)`)
    })

    it('should add a standalone call on extruded edge selection using face API axis', async () => {
      const code = `sketch001 = sketch(on = XZ) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 0mm, var 100mm])
  line2 = line(start = [var 0mm, var 100mm], end = [var 100mm, var 0mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 100mm, var 0mm], end = [var 0mm, var 0mm])
  coincident([line2.end, line3.start])
  vertical(line1)
}
region001 = region(segments = [sketch001.line1, sketch001.line2])
extrude001 = extrude(region001, length = 100, tagEnd = $capEnd001)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const segment = [...artifactGraph.values()].find(
        (n) => n.type === 'segment'
      )
      const wall = getWalls(artifactGraph, 1).graphSelections[0]
      const endCap = [...artifactGraph.values()].find(
        (n) => n.type === 'cap' && n.subType === 'end'
      )
      const edge: Selections = {
        graphSelections: [
          {
            entityRef: {
              type: 'edge',
              side_faces: [wall.artifact!.id, endCap!.id],
            },
            codeRef: segment!.codeRef,
          },
        ],
        otherSelections: [],
      }
      const result = addHelix({
        ast,
        artifactGraph,
        edge,
        revolutions: (await stringToKclExpression(
          '20',
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '0',
          rustContextInThisFile
        )) as KclCommandValue,
        radius: (await stringToKclExpression(
          '1',
          rustContextInThisFile
        )) as KclCommandValue,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`helix001 = helix(
  axis = {
    sideFaces = [region001.tags.line1, capEnd001]
  },
  revolutions = 20,
  angleStart = 0,
  radius = 1,
)`)
    })

    const cylinderExtrude = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 100)
extrude001 = extrude(profile001, length = 100)`

    const helixFromCylinder = `${cylinderExtrude}
helix001 = helix(
  cylinder = extrude001,
  revolutions = 1,
  angleStart = 2,
  ccw = true,
)
`

    it('should add a standalone call on cylinder selection', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        cylinderExtrude,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweep = [...artifactGraph.values()].find((n) => n.type === 'sweep')
      const cylinder: Selections = {
        graphSelections: [
          {
            entityRef: artifactToEntityRef(sweep!.type, sweep!.id),
            codeRef: sweep!.codeRef,
          },
        ],
        otherSelections: [],
      }
      const result = addHelix({
        ast,
        artifactGraph,
        cylinder,
        revolutions: (await stringToKclExpression(
          '1',
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '2',
          rustContextInThisFile
        )) as KclCommandValue,
        ccw: true,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toBe(helixFromCylinder)
    })

    it('should edit a standalone call on cylinder selection', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        helixFromCylinder,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweep = [...artifactGraph.values()].find((n) => n.type === 'sweep')
      const cylinder: Selections = {
        graphSelections: [
          {
            entityRef: artifactToEntityRef(sweep!.type, sweep!.id),
            codeRef: sweep!.codeRef,
          },
        ],
        otherSelections: [],
      }
      const result = addHelix({
        ast,
        artifactGraph,
        cylinder,
        revolutions: (await stringToKclExpression(
          '11',
          rustContextInThisFile
        )) as KclCommandValue,
        angleStart: (await stringToKclExpression(
          '22',
          rustContextInThisFile
        )) as KclCommandValue,
        ccw: false,
        nodeToEdit: createPathToNodeForLastVariable(ast),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `helix001 = helix(
  cylinder = extrude001,
  revolutions = 11,
  angleStart = 22,
  ccw = false,
)`
      )
    })
  })
})
