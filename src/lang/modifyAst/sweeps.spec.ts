import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { KclManager } from '@src/lang/KclManager'
import { mockExecAstAndReportErrors } from '@src/lang/modelingWorkflows'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import { getAxisExpression } from '@src/lang/modifyAst/geometry'
import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import {
  addExtrude,
  addLoft,
  addRevolve,
  addSweep,
  retrieveAxisOrEdgeSelectionsFromOpArg,
  retrieveBodyTypeFromOpArg,
} from '@src/lang/modifyAst/sweeps'
import {
  type ArtifactGraph,
  type Artifact,
  type Name,
  type PathToNode,
  type Program,
  type SourceRange,
  assertParse,
  defaultNodePath,
  getAllOperations,
  recast,
} from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import {
  createSelectionFromArtifacts,
  createSelectionFromPathArtifact,
  enginelessExecutor,
  getAstAndArtifactGraph,
  getAstAndSketchSelections,
  getCapFromCylinder,
  getKclCommandValue,
  getWalls,
  runNewAstAndCheckForSweep,
  runNewAstAndCountSweeps,
} from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  EngineRegionSelection,
  Selections,
} from '@src/machines/modelingSharedTypes'
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
    await buildTheWorldAndConnectToEngine()
  instanceInThisFile = instance
  kclManagerInThisFile = kclManager
  engineCommandManagerInThisFile = engineCommandManager
  rustContextInThisFile = rustContext
})
afterAll(() => {
  engineCommandManagerInThisFile.tearDown()
})

// TODO: two different methods for the same thing. Why?
async function getAstAndArtifactGraphEngineless(
  code: string,
  instance: ModuleType,
  rustContext: RustContext
) {
  const ast = assertParse(code, instance)
  if (err(ast)) throw ast

  const { artifactGraph } = await enginelessExecutor(ast, rustContext)
  return { ast, artifactGraph }
}

async function getAstAndSketchSelectionsEngineless(
  code: string,
  instance: ModuleType,
  rustContext: RustContext
) {
  const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
    code,
    instance,
    rustContext
  )
  const artifacts = [...artifactGraph.values()].filter((a) => a.type === 'path')
  if (artifacts.length === 0) {
    throw new Error('Artifact not found in the graph')
  }
  const sketches = createSelectionFromPathArtifact(artifacts)
  return { artifactGraph, ast, sketches }
}

function rangeOfText(
  fullCode: string,
  target: string,
  occurrence = 0
): SourceRange {
  let index = -1
  let searchFrom = 0
  for (let i = 0; i <= occurrence; i++) {
    index = fullCode.indexOf(target, searchFrom)
    if (index === -1) {
      throw new Error(`Could not find ${target} in code`)
    }
    searchFrom = index + target.length
  }

  return [index, index + target.length, 0]
}

function codeRefForText(
  fullCode: string,
  target: string,
  ast: Node<Program>,
  occurrence = 0
) {
  return {
    ...codeRefFromRange(rangeOfText(fullCode, target, occurrence), ast),
    nodePath: defaultNodePath(),
  }
}

function createEngineRegionSelectionForSketch({
  artifactGraph,
  sketchId,
  intersectionIndex = 0,
  intersectionCount = 1,
}: {
  artifactGraph: ArtifactGraph
  sketchId: string
  intersectionIndex?: number
  intersectionCount?: number
}): EngineRegionSelection {
  const segmentIds = [...artifactGraph.values()]
    .filter((artifact) => {
      if (artifact.type !== 'segment') return false

      const path = artifactGraph.get(artifact.pathId)
      return path?.type === 'path' && path.sketchBlockId === sketchId
    })
    .map((artifact) => artifact.id)

  if (segmentIds.length === 0) {
    throw new Error('Sketch segment artifacts not found')
  }
  const segment = segmentIds[0]
  if (!segment) {
    throw new Error('Sketch segment artifact not found')
  }
  const intersectionSegment = segmentIds[1] ?? segment

  return {
    type: 'engineRegion',
    id: 'region-1',
    sketchId,
    resolvableIntersectionInfo: {
      segment,
      intersection_segment: intersectionSegment,
      intersection_index: intersectionIndex,
      intersection_count: intersectionCount,
      curve_clockwise: false,
    },
  }
}

describe('sweeps.test.ts', () => {
  const circleProfileCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)`
  const circleAndRectProfilesCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
profile002 = rectangle(
  sketch001,
  corner = [2, 2],
  width = 2,
  height = 2,
)`

  const triangleRegion = `s = sketch(on = XY) {
  line1 = line(start = [0.05, 0.05], end = [3.88, 0.81])
  line2 = line(start = [3.88, 0.81], end = [0.92, 4.67])
  coincident([line1.end, line2.start])
  line3 = line(start = [0.92, 4.67], end = [0.05, 0.05])
  coincident([line2.end, line3.start])
  coincident([line1.start, line3.end])
}`

  describe('Testing addExtrude', () => {
    it('should add a basic extrude call', async () => {
      const { ast, sketches, artifactGraph } = await getAstAndSketchSelections(
        circleProfileCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(`extrude001 = extrude(profile001, length = 1)`)
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a basic extrude call on a cap', async () => {
      const code = `${circleProfileCode}
  extrude001 = extrude(profile001, length = 1)`
      const { ast, artifactGraph } = await getAstAndSketchSelections(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const endCap = [...artifactGraph.values()].findLast(
        (a) => a.type === 'cap'
      )
      expect(endCap).toBeDefined()
      const sketches = createSelectionFromArtifacts([endCap!], artifactGraph)
      const length = await getKclCommandValue(
        '2',
        instanceInThisFile,
        rustContextInThisFile
      )
      const res = addExtrude({
        ast,
        sketches,
        length,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(res)) throw res
      const newCode = recast(res.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`${circleProfileCode}
extrude001 = extrude(profile001, length = 1, tagEnd = $capEnd001)
extrude002 = extrude(capEnd001, length = 2)`)
      await runNewAstAndCountSweeps(res.modifiedAst, rustContextInThisFile, 2)
    })

    it('should add a basic extrude call on a wall', async () => {
      const code = `sketch001 = startSketchOn(YZ)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 2)
  |> yLine(length = 2)
  |> xLine(length = -2)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 2)`
      const { ast, artifactGraph } = await getAstAndSketchSelections(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const endWall = [...artifactGraph.values()].findLast(
        (a) => a.type === 'wall'
      )
      expect(endWall).toBeDefined()
      const sketches = createSelectionFromArtifacts([endWall!], artifactGraph)
      const length = await getKclCommandValue(
        '3',
        instanceInThisFile,
        rustContextInThisFile
      )
      const res = addExtrude({
        ast,
        sketches,
        length,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(res)) throw res
      const newCode = recast(res.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sketch001 = startSketchOn(YZ)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 2)
  |> yLine(length = 2)
  |> xLine(length = -2)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg01)
  |> close()
extrude001 = extrude(profile001, length = 2)
extrude002 = extrude(seg01, length = 3)`)
      await runNewAstAndCountSweeps(res.modifiedAst, rustContextInThisFile, 2)
    })

    it('should add a basic multi-profile extrude call', async () => {
      const { ast, sketches, artifactGraph } =
        await getAstAndSketchSelectionsEngineless(
          circleAndRectProfilesCode,
          instanceInThisFile,
          rustContextInThisFile
        )
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude([profile001, profile002], length = 1)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add an extrude call from a sketch region selection', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
        triangleRegion,
        instanceInThisFile,
        rustContextInThisFile
      )
      const sketch = artifactGraph
        .values()
        .find((a) => a.type === 'sketchBlock')
      const sketches: Selections = {
        graphSelections: [],
        otherSelections: [
          {
            type: 'engineRegion',
            id: 'region-1',
            point: { x: 1, y: 1 },
            sketchId: sketch!.id,
          },
        ],
      }
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `hidden001 = hide(s)
region001 = region(point = [1mm, 1mm], sketch = s)
extrude001 = extrude(region001, length = 1)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add an extrude call from a segments-based sketch region selection', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
        triangleRegion,
        instanceInThisFile,
        rustContextInThisFile
      )
      const sketch = artifactGraph
        .values()
        .find((a) => a.type === 'sketchBlock')
      const sketches: Selections = {
        graphSelections: [],
        otherSelections: [
          createEngineRegionSelectionForSketch({
            artifactGraph,
            sketchId: sketch!.id,
          }),
        ],
      }
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `hidden001 = hide(s)
region001 = region(segments = [s.line1, s.line2])
extrude001 = extrude(region001, length = 1)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should emit intersectionIndex only for ambiguous sketch region intersections', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
        triangleRegion,
        instanceInThisFile,
        rustContextInThisFile
      )
      const sketch = artifactGraph
        .values()
        .find((a) => a.type === 'sketchBlock')
      const sketches: Selections = {
        graphSelections: [],
        otherSelections: [
          createEngineRegionSelectionForSketch({
            artifactGraph,
            sketchId: sketch!.id,
            intersectionIndex: 0,
            intersectionCount: 2,
          }),
        ],
      }
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `region001 = region(segments = [s.line1, s.line2], intersectionIndex = 0)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should omit intersectionIndex when the engine selects the final intersection', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
        triangleRegion,
        instanceInThisFile,
        rustContextInThisFile
      )
      const sketch = artifactGraph
        .values()
        .find((a) => a.type === 'sketchBlock')
      const sketches: Selections = {
        graphSelections: [],
        otherSelections: [
          createEngineRegionSelectionForSketch({
            artifactGraph,
            sketchId: sketch!.id,
            intersectionIndex: 2,
            intersectionCount: 3,
          }),
        ],
      }
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `region001 = region(segments = [s.line1, s.line2])`
      )
      expect(newCode).not.toContain(`intersectionIndex`)
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should edit an extrude call from a sketch region selection', async () => {
      const code = `${triangleRegion}
region001 = region(point = [1mm, 1mm], sketch = s)
extrude001 = extrude(region001, length = 1)`
      const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
        code,
        instanceInThisFile,
        rustContextInThisFile
      )
      const region = [...artifactGraph.values()].findLast(
        (s) => s.type === 'path'
      )
      const sketches = createSelectionFromArtifacts([region!], artifactGraph)
      const length = await getKclCommandValue(
        '2',
        instanceInThisFile,
        rustContextInThisFile
      )
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addExtrude({
        ast,
        sketches,
        length,
        nodeToEdit,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`extrude001 = extrude(region001, length = 2)`)
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a multi-profile extrude call on a profile and a cap', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
profile002 = rectangle(
  sketch001,
  corner = [2, 2],
  width = 2,
  height = 2,
)
extrude001 = extrude(profile002, length = 1)
`
      const { ast, artifactGraph } = await getAstAndSketchSelections(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const profile = [...artifactGraph.values()].find(
        (a) => a.type === 'solid2d'
      )
      const endCap = [...artifactGraph.values()].findLast(
        (a) => a.type === 'cap'
      )
      console.log({ profile, endCap })
      expect(profile).toBeDefined()
      expect(endCap).toBeDefined()
      const sketches = createSelectionFromArtifacts(
        [profile!, endCap!],
        artifactGraph
      )
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const res = addExtrude({
        ast,
        sketches,
        length,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(res)) throw res
      const newCode = recast(res.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
profile002 = rectangle(
  sketch001,
  corner = [2, 2],
  width = 2,
  height = 2,
)
extrude001 = extrude(profile002, length = 1, tagEnd = $capEnd001)
extrude002 = extrude([capEnd001, profile001], length = 1)`)
      await runNewAstAndCountSweeps(res.modifiedAst, rustContextInThisFile, 3)
    })

    it('should add an extrude call with symmetric true', async () => {
      const { ast, sketches, artifactGraph } = await getAstAndSketchSelections(
        circleProfileCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        symmetric: true,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude(profile001, length = 1, symmetric = true)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add an extrude call with a segment direction', async () => {
      const { ast, sketches, artifactGraph } = await getAstAndSketchSelections(
        triangleRegion,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const segment = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'segment'
      )
      if (!segment) {
        throw new Error('segment artifact not found')
      }
      const direction = createSelectionFromArtifacts([segment], artifactGraph)
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        direction,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `${triangleRegion}
extrude001 = extrude(s, length = 1, direction = s.line1)`
      )
    })

    it('should add an extrude call with bidirectional length and twist angle', async () => {
      const { ast, sketches, artifactGraph } = await getAstAndSketchSelections(
        circleProfileCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const length = await getKclCommandValue(
        '10',
        instanceInThisFile,
        rustContextInThisFile
      )
      const bidirectionalLength = await getKclCommandValue(
        '20',
        instanceInThisFile,
        rustContextInThisFile
      )
      const twistAngle = await getKclCommandValue(
        '30',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        bidirectionalLength,
        twistAngle,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(`extrude001 = extrude(
  profile001,
  length = 10,
  bidirectionalLength = 20,
  twistAngle = 30,
)`)
    })

    it('should add an extrude call with draft angle', async () => {
      const { ast, sketches, artifactGraph } = await getAstAndSketchSelections(
        circleProfileCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const length = await getKclCommandValue(
        '10',
        instanceInThisFile,
        rustContextInThisFile
      )
      const draftAngle = await getKclCommandValue(
        '45deg',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        draftAngle,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude(profile001, length = 10, draftAngle = 45deg)`
      )
    })

    it('should edit an extrude call from symmetric true to false and new length', async () => {
      const extrudeCode = `${circleProfileCode}
extrude001 = extrude(profile001, length = 1, symmetric = true)`
      const { ast, sketches, artifactGraph } =
        await getAstAndSketchSelectionsEngineless(
          extrudeCode,
          instanceInThisFile,
          rustContextInThisFile
        )
      const length = await getKclCommandValue(
        '2',
        instanceInThisFile,
        rustContextInThisFile
      )
      const symmetric = false
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addExtrude({
        ast,
        sketches,
        length,
        symmetric,
        nodeToEdit,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`${circleProfileCode}
extrude001 = extrude(profile001, length = 2, symmetric = false)`)
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add an extrude call with method NEW', async () => {
      const { ast, sketches, artifactGraph } = await getAstAndSketchSelections(
        circleProfileCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        method: 'NEW',
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude(profile001, length = 1, method = NEW)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add an extrude call with hideSeams true', async () => {
      const { ast, sketches, artifactGraph } = await getAstAndSketchSelections(
        circleProfileCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        hideSeams: true,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude(profile001, length = 1, hideSeams = true)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add an extrude call with bodyType "surface"', async () => {
      const { ast, sketches, artifactGraph } = await getAstAndSketchSelections(
        circleProfileCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        bodyType: 'SURFACE',
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude(profile001, length = 1, bodyType = SURFACE)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add an extrude call with bodyType "surface" on two sketch solve segments', async () => {
      const { ast, artifactGraph } = await getAstAndSketchSelections(
        triangleRegion,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const segment = createSelectionFromArtifacts(
        artifactGraph
          .values()
          .filter((a) => a.type === 'segment')
          .toArray()
          .slice(0, 2),
        artifactGraph
      )
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches: segment,
        length,
        bodyType: 'SURFACE',
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `${triangleRegion}
extrude001 = extrude([s.line1, s.line2], length = 1, bodyType = SURFACE)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a surface extrude call from a body edge', async () => {
      const code = `@settings(kclVersion = 2.0)

${triangleRegion}
hidden001 = hide(s)
region001 = region(point = [1mm, 1mm], sketch = s)
extrude001 = extrude(region001, length = 1, bodyType = SURFACE)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const sweepEdge = [...artifactGraph.values()].find(
        (artifact) => artifact.type === 'sweepEdge'
      )
      if (!sweepEdge) {
        throw new Error('sweepEdge artifact not found')
      }
      const sketches = createSelectionFromArtifacts([sweepEdge], artifactGraph)
      const length = await getKclCommandValue(
        '2',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        method: 'NEW',
        bodyType: 'SURFACE',
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`extrude002 = extrude(
  getOppositeEdge(extrude001.sketch.tags.line1),
  length = 2,
  method = NEW,
  bodyType = SURFACE,
)`)
      const error = await mockExecAstAndReportErrors(
        result.modifiedAst,
        rustContextInThisFile
      )
      expect(error).not.toBeInstanceOf(Error)
    })

    it('should add a surface extrude from the previous edge of an open profile', async () => {
      const code = `@settings(kclVersion = 2.0)

sketch001 = sketch(on = XZ) {
  line1 = line(start = [var -2.2mm, var 0.4mm], end = [var 3.48mm, var 1.03mm])
}
extrude001 = extrude(sketch001.line1, length = 5, bodyType = SURFACE)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const previousAdjacentEdge = [...artifactGraph.values()].find(
        (artifact) =>
          artifact.type === 'sweepEdge' &&
          artifact.subType === 'previousAdjacent'
      )
      if (!previousAdjacentEdge) {
        throw new Error('previous adjacent sweepEdge artifact not found')
      }

      const sketches = createSelectionFromArtifacts(
        [previousAdjacentEdge],
        artifactGraph
      )
      const length = await getKclCommandValue(
        '5',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        method: 'NEW',
        bodyType: 'SURFACE',
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toBe(`@settings(kclVersion = 2.0)

sketch001 = sketch(on = XZ) {
  line1 = line(start = [var -2.2mm, var 0.4mm], end = [var 3.48mm, var 1.03mm])
}
extrude001 = extrude(sketch001.line1, length = 5, bodyType = SURFACE)
extrude002 = extrude(
  getPreviousAdjacentEdge(extrude001.sketch.tags.line1),
  length = 5,
  method = NEW,
  bodyType = SURFACE,
)
`)
    })

    it('should preserve method and compose edge references for extruded edge profiles', async () => {
      const code = `@settings(kclVersion = 2.0)

sketch001 = sketch(on = XZ) {
  line1 = line(start = [var -2.2mm, var 0.4mm], end = [var 3.48mm, var 1.03mm])
}
extrude001 = extrude(sketch001.line1, length = 5, bodyType = SURFACE)
sketch002 = sketch(on = XZ) {
  line1 = line(start = [var -4.58mm, var 1.54mm], end = [var -7.17mm, var 6.99mm])
}
extrude002 = extrude(
  getNextAdjacentEdge(extrude001.sketch.tags.line1),
  length = 1,
  direction = sketch002.line1,
  method = NEW,
  bodyType = SURFACE,
)`
      const ast = assertParse(code, instanceInThisFile)
      if (err(ast)) throw ast
      const sketch001Ref = codeRefForText(code, 'sketch001 = sketch', ast)
      const line1Ref = codeRefForText(code, 'line1 = line', ast)
      const extrude002Ref = codeRefForText(code, 'extrude002 = extrude', ast)
      const artifactGraph: ArtifactGraph = new Map()
      const segment: Extract<Artifact, { type: 'segment' }> = {
        type: 'segment',
        id: 'segment1',
        pathId: 'path1',
        edgeIds: [],
        codeRef: line1Ref,
        commonSurfaceIds: [],
      }
      const sweep: Extract<Artifact, { type: 'sweep' }> = {
        type: 'sweep',
        id: 'sweep2',
        subType: 'extrusion',
        pathId: 'path1',
        surfaceIds: [],
        edgeIds: ['sweepEdge2'],
        codeRef: extrude002Ref,
        trajectoryId: null,
        method: 'new',
        consumed: false,
        patternIds: [],
      }
      const sweepEdge: Extract<Artifact, { type: 'sweepEdge' }> = {
        type: 'sweepEdge',
        id: 'sweepEdge2',
        sweepId: 'sweep2',
        segId: 'segment1',
        subType: 'opposite',
        cmdId: 'cmd2',
        commonSurfaceIds: [],
      }
      artifactGraph.set('path1', {
        type: 'path',
        id: 'path1',
        subType: 'sketch',
        planeId: 'plane1',
        segIds: ['segment1'],
        consumed: false,
        trajectorySweepId: null,
        codeRef: sketch001Ref,
      })
      artifactGraph.set(segment.id, segment)
      artifactGraph.set(sweep.id, sweep)
      artifactGraph.set(sweepEdge.id, sweepEdge)

      const length = await getKclCommandValue(
        '5',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches: {
          graphSelections: [],
          otherSelections: [
            {
              type: 'enginePrimitive',
              entityId: sweepEdge.id,
              parentEntityId: sweep.id,
              primitiveIndex: 2,
              primitiveType: 'edge',
            },
          ],
        },
        length,
        method: 'MERGE',
        bodyType: 'SURFACE',
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`extrude003 = extrude(
  getOppositeEdge(getNextAdjacentEdge(extrude001.sketch.tags.line1)),
  length = 5,
  method = MERGE,
  bodyType = SURFACE,
)`)
      expect(newCode).not.toContain('edgeId(extrude002')
    })

    it('should use edge expressions for extrude direction body edge selections', async () => {
      const code = `@settings(kclVersion = 2.0)

sketch001 = sketch(on = XZ) {
  line1 = line(start = [var -2.2mm, var 0.4mm], end = [var 3.48mm, var 1.03mm])
}
extrude001 = extrude(sketch001.line1, length = 5, bodyType = SURFACE)
sketch002 = sketch(on = XZ) {
  line1 = line(start = [var -4.58mm, var 1.54mm], end = [var -7.17mm, var 6.99mm])
}`
      const ast = assertParse(code, instanceInThisFile)
      if (err(ast)) throw ast
      const sketch001Ref = codeRefForText(code, 'sketch001 = sketch', ast)
      const sketch002Ref = codeRefForText(code, 'sketch002 = sketch', ast)
      const sourceLineRef = codeRefForText(code, 'line1 = line', ast)
      const profileLineRef = codeRefForText(code, 'line1 = line', ast, 1)
      const extrude001Ref = codeRefForText(code, 'extrude001 = extrude', ast)
      const artifactGraph: ArtifactGraph = new Map()
      const sourceSegment: Extract<Artifact, { type: 'segment' }> = {
        type: 'segment',
        id: 'sourceSegment',
        pathId: 'sourcePath',
        edgeIds: [],
        codeRef: sourceLineRef,
        commonSurfaceIds: [],
      }
      const profile: Extract<Artifact, { type: 'segment' }> = {
        type: 'segment',
        id: 'profileSegment',
        pathId: 'profilePath',
        edgeIds: [],
        codeRef: profileLineRef,
        commonSurfaceIds: [],
      }
      const directionEdge: Extract<Artifact, { type: 'sweepEdge' }> = {
        type: 'sweepEdge',
        id: 'directionEdge',
        sweepId: 'sweep1',
        segId: 'sourceSegment',
        subType: 'adjacent',
        cmdId: 'cmd1',
        commonSurfaceIds: [],
      }
      artifactGraph.set('sourcePath', {
        type: 'path',
        id: 'sourcePath',
        subType: 'sketch',
        planeId: 'plane1',
        segIds: ['sourceSegment'],
        consumed: false,
        trajectorySweepId: null,
        codeRef: sketch001Ref,
      })
      artifactGraph.set('profilePath', {
        type: 'path',
        id: 'profilePath',
        subType: 'sketch',
        planeId: 'plane2',
        segIds: ['profileSegment'],
        consumed: false,
        trajectorySweepId: null,
        codeRef: sketch002Ref,
      })
      artifactGraph.set(sourceSegment.id, sourceSegment)
      artifactGraph.set(profile.id, profile)
      artifactGraph.set('sweep1', {
        type: 'sweep',
        id: 'sweep1',
        subType: 'extrusion',
        pathId: 'sourcePath',
        surfaceIds: [],
        edgeIds: ['directionEdge'],
        codeRef: extrude001Ref,
        trajectoryId: null,
        method: 'new',
        consumed: false,
        patternIds: [],
      })
      artifactGraph.set(directionEdge.id, directionEdge)

      const length = await getKclCommandValue(
        '5',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches: createSelectionFromArtifacts([profile], artifactGraph),
        direction: createSelectionFromArtifacts([directionEdge], artifactGraph),
        length,
        bodyType: 'SURFACE',
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`extrude002 = extrude(
  sketch002.line1,
  length = 5,
  direction = getNextAdjacentEdge(extrude001.sketch.tags.line1),
  bodyType = SURFACE,
)`)
    })

    it('should add an extrude call with bodyType "solid"', async () => {
      const { ast, sketches, artifactGraph } = await getAstAndSketchSelections(
        circleProfileCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const length = await getKclCommandValue(
        '1',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        bodyType: 'SOLID',
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude(profile001, length = 1, bodyType = SOLID)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add an extrude call to a wall', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> angledLine(angle = 0deg, length = 0.07, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90deg, length = 0.07)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 1)
plane001 = offsetPlane(XZ, offset = 1)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 0.1)`
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        1
      )
      const to = getWalls(artifactGraph, 1)
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches,
        to,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `extrude002 = extrude(profile002, to = rectangleSegmentA001)`
      )
      const error = await mockExecAstAndReportErrors(
        result.modifiedAst,
        rustContextInThisFile
      )
      expect(error).not.toBeInstanceOf(Error)
    })

    it('should add an extrude call to an untagged wall', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 1)
  |> line(endAbsolute = [0, 1])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 1)
plane001 = offsetPlane(XZ, offset = 1)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 0.1)`
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        1
      )
      const to = getWalls(artifactGraph, 1)
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches,
        to,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 1, tag = $seg01)
  |> line(endAbsolute = [0, 1])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 1)
plane001 = offsetPlane(XZ, offset = 1)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 0.1)
extrude002 = extrude(profile002, to = seg01)`)
      const error = await mockExecAstAndReportErrors(
        result.modifiedAst,
        rustContextInThisFile
      )
      expect(error).not.toBeInstanceOf(Error)
    })

    it('should add an extrude call to an end cap', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
plane001 = offsetPlane(XY, offset = 2)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 0.1)`
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        1
      )
      const to = getCapFromCylinder(artifactGraph)
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches,
        to,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1, tagEnd = $capEnd001)
plane001 = offsetPlane(XY, offset = 2)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 0.1)
extrude002 = extrude(profile002, to = capEnd001)`)
      const error = await mockExecAstAndReportErrors(
        result.modifiedAst,
        rustContextInThisFile
      )
      expect(error).not.toBeInstanceOf(Error)
    })

    it('should add an extrude call with full twist parameters', async () => {
      const { ast, sketches, artifactGraph } = await getAstAndSketchSelections(
        circleProfileCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const length = await getKclCommandValue(
        '10',
        instanceInThisFile,
        rustContextInThisFile
      )
      const twistAngle = await getKclCommandValue(
        '180deg',
        instanceInThisFile,
        rustContextInThisFile
      )
      const twistAngleStep = await getKclCommandValue(
        '15',
        instanceInThisFile,
        rustContextInThisFile
      )
      const twistCenter = await getKclCommandValue(
        '[0, 0]',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addExtrude({
        ast,
        sketches,
        length,
        twistAngle,
        twistAngleStep,
        twistCenter,
        artifactGraph,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(`extrude001 = extrude(
  profile001,
  length = 10,
  twistAngle = 180deg,
  twistAngleStep = 15,
  twistCenter = [0, 0],
)`)
    })

    // TODO: this isn't producing the right results yet
    // https://github.com/KittyCAD/engine/issues/3855
    // and https://github.com/KittyCAD/modeling-app/issues/8831
    it('should add an extrude call to a chamfer face', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 1, tag = $seg01)
  |> line(endAbsolute = [0, 1])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 1, tagEnd = $capEnd001)
  |> chamfer(
       length = 0.5,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
     )
plane001 = offsetPlane(XY, offset = 2)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 0.1)`
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        1
      )
      const to = createSelectionFromArtifacts(
        [...artifactGraph.values()].filter((a) => a.type === 'edgeCut'),
        artifactGraph
      )
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches,
        to,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 1, tag = $seg01)
  |> line(endAbsolute = [0, 1])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 1, tagEnd = $capEnd001)
  |> chamfer(
       length = 0.5,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
       tag = $seg02,
     )
plane001 = offsetPlane(XY, offset = 2)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 0.1)
extrude002 = extrude(profile002, to = seg02)`)
      const error = await mockExecAstAndReportErrors(
        result.modifiedAst,
        rustContextInThisFile
      )
      expect(error).not.toBeInstanceOf(Error)
    })
  })

  describe('Testing addSweep', () => {
    const circleAndLineCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
sketch002 = startSketchOn(XZ)
profile002 = startProfile(sketch002, at = [0, 0])
  |> xLine(length = -5)
  |> tangentialArc(endAbsolute = [-20, 5])`

    async function getAstAndSketchesForSweep(
      code: string,
      instance: ModuleType,
      kclManager: KclManager
    ) {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instance,
        kclManager
      )
      const artifact1 = [...artifactGraph.values()].find(
        (a) => a.type === 'path'
      )
      const artifact2 = [...artifactGraph.values()].findLast(
        (a) => a.type === 'path'
      )
      if (!artifact1 || !artifact2) {
        throw new Error('Artifact not found in the graph')
      }

      const sketches = createSelectionFromPathArtifact([artifact1])
      const path = createSelectionFromPathArtifact([artifact2])
      return { ast, artifactGraph, sketches, path }
    }

    it('should add a basic sweep call', async () => {
      const { ast, artifactGraph, sketches, path } =
        await getAstAndSketchesForSweep(
          circleAndLineCode,
          instanceInThisFile,
          kclManagerInThisFile
        )
      const result = addSweep({
        ast,
        artifactGraph,
        sketches,
        path,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleAndLineCode)
      expect(newCode).toContain(`sweep001 = sweep(
  profile001,
  path = profile002,
  version = 2,
  translateProfileToPath = false,
  orientProfilePerpendicular = false,
)`)
    })

    it('should add a sweep call on a cap', async () => {
      const code = `${circleProfileCode}
extrude001 = extrude(profile001, length = 1)
sketch002 = startSketchOn(XZ)
profile002 = startProfile(sketch002, at = [0, 0])
  |> yLine(length = 5)`
      const { ast, artifactGraph } = await getAstAndSketchSelections(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const endCap = [...artifactGraph.values()].find(
        (a) => a.type === 'cap' && a.subType === 'end'
      )
      expect(endCap).toBeDefined()
      const pathArtifact = [...artifactGraph.values()].findLast(
        (a) => a.type === 'path'
      )
      expect(pathArtifact).toBeDefined()
      const sketches = createSelectionFromArtifacts([endCap!], artifactGraph)
      const path = createSelectionFromArtifacts([pathArtifact!], artifactGraph)

      const result = addSweep({
        ast,
        artifactGraph,
        sketches,
        path,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `extrude001 = extrude(profile001, length = 1, tagEnd = $capEnd001)`
      )
      expect(newCode).toContain(`sweep001 = sweep(
  capEnd001,
  path = profile002,
  version = 2,
  translateProfileToPath = false,
  orientProfilePerpendicular = false,
)`)
    })

    it('should add a sweep call from a sketch region selection', async () => {
      const code = `${triangleRegion}
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = -5)
  |> tangentialArc(endAbsolute = [-20, 5])`
      const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
        code,
        instanceInThisFile,
        rustContextInThisFile
      )

      const sketch = artifactGraph
        .values()
        .find((s) => s.type === 'sketchBlock')
      const sketches: Selections = {
        graphSelections: [],
        otherSelections: [
          {
            type: 'engineRegion',
            id: 'region-1',
            point: { x: 1, y: 1 },
            sketchId: sketch!.id,
          },
        ],
      }
      const pathArtifact = [...artifactGraph.values()].findLast(
        (s) => s.type === 'path'
      )
      const path = createSelectionFromArtifacts([pathArtifact!], artifactGraph)
      const result = addSweep({
        ast,
        artifactGraph,
        sketches,
        path,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `hidden001 = hide(s)
region001 = region(point = [1mm, 1mm], sketch = s)`
      )
      expect(newCode).toContain(`sweep001 = sweep(
  region001,
  path = profile001,
  version = 2,
  translateProfileToPath = false,
  orientProfilePerpendicular = false,
)`)
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a sweep call from a sketch region selection and sketch solve segment as path', async () => {
      const code = `${triangleRegion}
sketch002 = sketch(on = XZ) {
  line1 = line(start = [var -0.01mm, var 0.02mm], end = [var -0.03mm, var 1.65mm])
  arc1 = arc(start = [var 0.28mm, var 2.48mm], end = [var -0.03mm, var 1.65mm], center = [var 1.2mm, var 1.67mm])
  coincident([line1.end, arc1.end])
  tangent([line1, arc1])
}`
      const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
        code,
        instanceInThisFile,
        rustContextInThisFile
      )

      const sketch = artifactGraph
        .values()
        .find((s) => s.type === 'sketchBlock')
      const sketches: Selections = {
        graphSelections: [],
        otherSelections: [
          {
            type: 'engineRegion',
            id: 'region-1',
            point: { x: 1, y: 1 },
            sketchId: sketch!.id,
          },
        ],
      }
      const pathArtifacts = [...artifactGraph.values()]
        .filter((s) => s.type === 'segment')
        .slice(-2)
      const path = createSelectionFromArtifacts(
        [pathArtifacts[0]],
        artifactGraph
      )
      const result = addSweep({
        ast,
        artifactGraph,
        sketches,
        path,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `hidden001 = hide(s)
region001 = region(point = [1mm, 1mm], sketch = s)`
      )
      expect(newCode).toContain(`sweep001 = sweep(
  region001,
  path = sketch002.line1,
  version = 2,
  translateProfileToPath = false,
  orientProfilePerpendicular = false,
)`)
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a sweep call from region001 with sketch solve line and arc path segments', async () => {
      const code = `sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var -2.38mm, var 2.51mm], center = [var 0mm, var 0mm])
  coincident([circle1.center, ORIGIN])
}
sketch002 = sketch(on = YZ) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 0mm, var 10mm])
  coincident([line1.start, ORIGIN])
  arc1 = arc(start = [var 6.66mm, var 22.81mm], end = [var 0mm, var 10mm], center = [var 15.65mm, var 10mm])
  coincident([line1.end, arc1.end])
  tangent([line1, arc1])
  vertical(line1)
  verticalDistance([line1.start, line1.end]) == 10
}
region001 = region(point = [2.3783mm, -2.5082mm], sketch = sketch001)`
      const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
        code,
        instanceInThisFile,
        rustContextInThisFile
      )

      const regionArtifacts = [...artifactGraph.values()]
        .filter((artifact) => artifact.type === 'path')
        .slice(-1)
      expect(regionArtifacts).toHaveLength(1)
      const sketches = createSelectionFromArtifacts(
        regionArtifacts,
        artifactGraph
      )

      const pathArtifacts = [...artifactGraph.values()]
        .filter((artifact) => artifact.type === 'segment')
        .slice(-2)
      expect(pathArtifacts).toHaveLength(2)
      const path = createSelectionFromArtifacts(pathArtifacts, artifactGraph)

      const result = addSweep({
        ast,
        artifactGraph,
        sketches,
        path,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sweep001 = sweep(
  region001,
  path = [sketch002.line1, sketch002.arc1],
  version = 2,
  translateProfileToPath = false,
  orientProfilePerpendicular = false,
)`)
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should edit a sweep call from a sketch region selection', async () => {
      const code = `${triangleRegion}
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = -5)
  |> tangentialArc(endAbsolute = [-20, 5])
region001 = region(point = [1mm, 1mm], sketch = s)
sweep001 = sweep(region001, path = profile001, sectional = true)`
      const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
        code,
        instanceInThisFile,
        rustContextInThisFile
      )
      const region = [...artifactGraph.values()].findLast(
        (s) => s.type === 'path'
      )
      const sketches = createSelectionFromArtifacts([region!], artifactGraph)
      const pathArtifact = [...artifactGraph.values()].filter(
        (s) => s.type === 'path'
      )[1]
      const path = createSelectionFromArtifacts([pathArtifact], artifactGraph)
      expect(pathArtifact).toBeDefined()
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addSweep({
        ast,
        artifactGraph,
        sketches,
        path,
        sectional: false,
        relativeTo: 'TRAJECTORY',
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sweep001 = sweep(
  region001,
  path = profile001,
  sectional = false,
  relativeTo = sweep::TRAJECTORY,
)`)
    })

    it('should add a sweep call with surface bodyType', async () => {
      const { ast, artifactGraph, sketches, path } =
        await getAstAndSketchesForSweep(
          circleAndLineCode,
          instanceInThisFile,
          kclManagerInThisFile
        )
      const result = addSweep({
        ast,
        artifactGraph,
        sketches,
        path,
        bodyType: 'SURFACE',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleAndLineCode)
      expect(newCode).toContain(`sweep001 = sweep(
  profile001,
  path = profile002,
  bodyType = SURFACE,
  version = 2,
  translateProfileToPath = false,
  orientProfilePerpendicular = false,
)`)
    })

    it('should add a sweep call with surface bodyType on a sketch solve segment', async () => {
      const code = `${triangleRegion}
s2 = sketch(on = XZ) {
  line1 = line(start = [var -0.01mm, var 0.02mm], end = [var -0.03mm, var 1.65mm])
  arc1 = arc(start = [var 0.28mm, var 2.48mm], end = [var -0.03mm, var 1.65mm], center = [var 1.2mm, var 1.67mm])
  coincident([line1.end, arc1.end])
  tangent([line1, arc1])
}`
      const { ast, artifactGraph } = await getAstAndSketchSelections(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const segment = createSelectionFromArtifacts(
        [artifactGraph.values().find((a) => a.type === 'segment')!],
        artifactGraph
      )
      const path = createSelectionFromArtifacts(
        artifactGraph
          .values()
          .toArray()
          .filter((a) => a.type === 'segment')
          .slice(-2),
        artifactGraph
      )
      const result = addSweep({
        ast,
        artifactGraph,
        sketches: segment,
        path,
        bodyType: 'SURFACE',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`sweep001 = sweep(
  s.line1,
  path = [s2.line1, s2.arc1],
  bodyType = SURFACE,
  version = 2,
  translateProfileToPath = false,
  orientProfilePerpendicular = false,
)`)
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a sweep call with sectional true and ignore relativeTo on new calls', async () => {
      const { ast, artifactGraph, sketches, path } =
        await getAstAndSketchesForSweep(
          circleAndLineCode,
          instanceInThisFile,
          kclManagerInThisFile
        )
      const sectional = true
      const relativeTo = 'SKETCH_PLANE'
      const result = addSweep({
        ast,
        artifactGraph,
        sketches,
        path,
        sectional,
        relativeTo,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleAndLineCode)
      expect(newCode).toContain(`sweep001 = sweep(
  profile001,
  path = profile002,
  sectional = true,
  version = 2,
  translateProfileToPath = false,
  orientProfilePerpendicular = false,
)`)
      expect(newCode).not.toContain('relativeTo = sweep::SKETCH_PLANE')
    })

    it('should edit sweep call with sectional from true to false and relativeTo setting change', async () => {
      const circleAndLineCodeWithSweep = `${circleAndLineCode}
sweep001 = sweep(
  profile001,
  path = profile002,
  sectional = true,
  relativeTo = sweep::SKETCH_PLANE,
)`
      const { ast, artifactGraph, sketches, path } =
        await getAstAndSketchesForSweep(
          circleAndLineCodeWithSweep,
          instanceInThisFile,
          kclManagerInThisFile
        )
      const sectional = false
      const relativeTo = 'TRAJECTORY'
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addSweep({
        ast,
        artifactGraph,
        sketches,
        path,
        sectional,
        relativeTo,
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleAndLineCode)
      expect(newCode).toContain(
        `sweep001 = sweep(
  profile001,
  path = profile002,
  sectional = false,
  relativeTo = sweep::TRAJECTORY,
)`
      )
    })

    it('should add a muli-profile sweep call', async () => {
      const circleAndLineAndRectProfilesCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
profile002 = rectangle(
  sketch001,
  corner = [2, 2],
  width = 2,
  height = 2,
)
sketch002 = startSketchOn(XZ)
profile003 = startProfile(sketch002, at = [0, 0])
  |> xLine(length = -5)
  |> tangentialArc(endAbsolute = [-20, 5])`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        circleAndLineAndRectProfilesCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const artifacts = [...artifactGraph.values()].filter(
        (a) => a.type === 'path'
      )
      if (artifacts.length !== 3) {
        throw new Error('Artifacts not found in the graph')
      }

      const sketches = createSelectionFromPathArtifact([
        artifacts[0],
        artifacts[1],
      ])
      const path = createSelectionFromPathArtifact([artifacts[2]])
      const result = addSweep({
        ast,
        artifactGraph,
        sketches,
        path,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleAndLineAndRectProfilesCode)
      expect(newCode).toContain(`sweep001 = sweep(
  [profile001, profile002],
  path = profile003,
  version = 2,
  translateProfileToPath = false,
  orientProfilePerpendicular = false,
)`)
    })

    // Note: helix sweep will be done in e2e since helix artifacts aren't created by the engineless executor

    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
sketch002 = startSketchOn(XZ)
profile002 = startProfile(sketch002, at = [0, 0])
  |> xLine(length = -5)
  |> tangentialArc(endAbsolute = [-20, 5])`

    async function setupSweep(sourceCode = code) {
      const { instance, rustContext } =
        await buildTheWorldAndNoEngineConnection()
      const ast = assertParse(sourceCode, instance)
      if (err(ast)) throw ast

      const { artifactGraph } = await enginelessExecutor(ast, rustContext)
      const paths = [...artifactGraph.values()].filter(
        (artifact) => artifact.type === 'path'
      )
      expect(paths).toHaveLength(2)

      return {
        ast,
        artifactGraph,
        instance,
        rustContext,
        sketches: createSelectionFromArtifacts([paths[0]], artifactGraph),
        path: createSelectionFromArtifacts([paths[1]], artifactGraph),
      }
    }

    it('forces version 2 when no version is provided', async () => {
      const { ast, artifactGraph, sketches, path, instance } =
        await setupSweep()
      const result = addSweep({
        ast,
        artifactGraph,
        sketches,
        path,
        wasmInstance: instance,
      })
      if (err(result)) throw result

      expect(recast(result.modifiedAst, instance)).toContain(`sweep001 = sweep(
  profile001,
  path = profile002,
  version = 2,
  translateProfileToPath = false,
  orientProfilePerpendicular = false,
)`)
    })

    it('preserves an explicit version', async () => {
      const { ast, artifactGraph, sketches, path, instance, rustContext } =
        await setupSweep()
      const version = await getKclCommandValue('1', instance, rustContext)
      const result = addSweep({
        ast,
        artifactGraph,
        sketches,
        path,
        version,
        wasmInstance: instance,
      })
      if (err(result)) throw result

      expect(recast(result.modifiedAst, instance)).toContain(`sweep001 = sweep(
  profile001,
  path = profile002,
  version = 1,
  translateProfileToPath = false,
  orientProfilePerpendicular = false,
)`)
    })

    it('does not add version 2 when editing old sweep code without version', async () => {
      const oldSweepCode = `${code}
sweep001 = sweep(profile001, path = profile002)`
      const { ast, artifactGraph, sketches, path, instance } =
        await setupSweep(oldSweepCode)
      const result = addSweep({
        ast,
        artifactGraph,
        sketches,
        path,
        nodeToEdit: createPathToNodeForLastVariable(ast),
        wasmInstance: instance,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst, instance)
      expect(newCode).toContain(
        'sweep001 = sweep(profile001, path = profile002)'
      )
      expect(newCode).not.toContain('version = 2')
      expect(newCode).not.toContain('translateProfileToPath')
      expect(newCode).not.toContain('orientProfilePerpendicular')
    })
  })

  describe('Testing addLoft', () => {
    const twoCirclesCode = `sketch001 = startSketchOn(XZ)
profile001 = circle(sketch001, center = [0, 0], radius = 30)
plane001 = offsetPlane(XZ, offset = 50)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 20)
`
    it('should add a basic loft call', async () => {
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        twoCirclesCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(sketches.graphSelections).toHaveLength(2)
      const result = addLoft({
        ast,
        artifactGraph,
        sketches,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(twoCirclesCode)
      expect(newCode).toContain(`loft001 = loft([profile001, profile002]`)
      // Don't think we can find the artifact here for loft?
    })

    it('should add a loft call from a sketch region selection', async () => {
      const code = `${triangleRegion}

plane001 = offsetPlane(XY, offset = 10)

t = sketch(on = plane001) {
  edge1 = line(start = [-0.05, -0.01], end = [3.88, 0.81])
  edge2 = line(start = [3.88, 0.81], end = [0.92, 4.67])
  coincident([edge1.end, edge2.start])
  edge3 = line(start = [0.92, 4.67], end = [-0.05, -0.01])
  coincident([edge2.end, edge3.start])
  coincident([edge1.start, edge3.end])
}`
      const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
        code,
        instanceInThisFile,
        rustContextInThisFile
      )
      const sketch1 = artifactGraph
        .values()
        .find((s) => s.type === 'sketchBlock')
      const sketch2 = [...artifactGraph.values()].findLast(
        (s) => s.type === 'sketchBlock'
      )
      const sketches: Selections = {
        graphSelections: [],
        otherSelections: [
          {
            type: 'engineRegion',
            id: 'region-1',
            point: { x: 1, y: 1 },
            sketchId: sketch1!.id,
          },
          {
            type: 'engineRegion',
            id: 'region-2',
            point: { x: 1, y: 1 },
            sketchId: sketch2!.id,
          },
        ],
      }
      const result = addLoft({
        ast,
        artifactGraph,
        sketches,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const error = await mockExecAstAndReportErrors(
        result.modifiedAst,
        rustContextInThisFile
      )
      expect(error).not.toBeInstanceOf(Error)

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`loft001 = loft([`)
      expect(newCode).toContain(`hidden001 = hide(s)`)
      expect(newCode).toContain(`hidden002 = hide(t)`)
      expect(newCode).toContain(`region(point = [1mm, 1mm], sketch = s)`)
      expect(newCode).toContain(`region(point = [1mm, 1mm], sketch = t)`)
      if (err(newCode)) throw newCode
      const { operations } = await getAstAndArtifactGraph(
        newCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const loft = getAllOperations(operations).find(
        (op) => op.type === 'StdLibCall' && op.name === 'loft'
      )
      if (!loft || loft.type !== 'StdLibCall') throw new Error('Op not found')
      expect(loft.isError).toBe(undefined)
    })

    it('should edit a loft call from a sketch region selection', async () => {
      const code = `${triangleRegion}

plane001 = offsetPlane(XY, offset = 10)

t = sketch(on = plane001) {
  edge1 = line(start = [-0.05, -0.01], end = [3.88, 0.81])
  edge2 = line(start = [3.88, 0.81], end = [0.92, 4.67])
  coincident([edge1.end, edge2.start])
  edge3 = line(start = [0.92, 4.67], end = [-0.05, -0.01])
  coincident([edge2.end, edge3.start])
  coincident([edge1.start, edge3.end])
}
region001 = region(point = [1mm, 1mm], sketch = s)
region002 = region(point = [1mm, 1mm], sketch = t)
loft001 = loft([region001, region002])`
      const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
        code,
        instanceInThisFile,
        rustContextInThisFile
      )
      const regions = [...artifactGraph.values()]
        .filter((s) => s.type === 'path')
        .slice(-2)
      const sketches = createSelectionFromArtifacts(regions, artifactGraph)
      const vDegree = await getKclCommandValue(
        '3',
        instanceInThisFile,
        rustContextInThisFile
      )
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addLoft({
        ast,
        artifactGraph,
        sketches,
        vDegree,
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `loft001 = loft([region001, region002], vDegree = 3)`
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a basic loft call with surface bodyType', async () => {
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        twoCirclesCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(sketches.graphSelections).toHaveLength(2)
      const result = addLoft({
        ast,
        artifactGraph,
        sketches,
        bodyType: 'SURFACE',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(twoCirclesCode)
      expect(newCode).toContain(
        `loft001 = loft([profile001, profile002], bodyType = SURFACE)`
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a basic loft call with surface bodyType on sketch solve segments', async () => {
      const code = `sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 5mm, var 0mm])
  coincident([line1.start, ORIGIN])
  horizontal(line1)
  distance([line1.start, line1.end]) == 5
}
plane001 = offsetPlane(XY, offset = 5)
sketch002 = sketch(on = plane001) {
  point2 = point(at = [var 3.12mm, var -0.77mm])
  arc1 = arc(start = [var 0mm, var 0mm], end = [var 7.37mm, var -0.16mm], center = [var 4.4mm, var 4.57mm])
  coincident([point2, arc1])
  coincident([arc1.start, ORIGIN])
  fixed([point2, [2.6mm, -1.34mm]])
  fixed([arc1.end, [7.53mm, -0.41mm]])
}`
      const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
        code,
        instanceInThisFile,
        rustContextInThisFile
      )
      const segments = [...artifactGraph.values()].filter(
        (a) => a.type === 'segment'
      )
      expect(segments.length).toBeGreaterThanOrEqual(2)
      const sketches = createSelectionFromArtifacts(
        [segments[0], segments[segments.length - 1]],
        artifactGraph
      )
      const result = addLoft({
        ast,
        artifactGraph,
        sketches,
        bodyType: 'SURFACE',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `loft001 = loft([sketch001.line1, sketch002.arc1], bodyType = SURFACE)`
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a basic loft call with surface bodyType on open path without engine errors', async () => {
      const openPaths = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2.32, -2.09])
  |> line(end = [9.62, 4.63])
plane001 = offsetPlane(XY, offset = 5)
sketch002 = startSketchOn(plane001)
profile002 = startProfile(sketch002, at = [-0.75, -3.04])
  |> line(end = [8.17, 4.09])`
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        openPaths,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(sketches.graphSelections).toHaveLength(2)
      const result = addLoft({
        ast,
        artifactGraph,
        sketches,
        bodyType: 'SURFACE',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) throw newCode
      expect(newCode).toContain(openPaths)
      expect(newCode).toContain(
        `loft001 = loft([profile001, profile002], bodyType = SURFACE)`
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should add a basic loft call with bezApproximateRational false', async () => {
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        twoCirclesCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(sketches.graphSelections).toHaveLength(2)
      const result = addLoft({
        ast,
        artifactGraph,
        sketches,
        bezApproximateRational: false,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(twoCirclesCode)
      expect(newCode).toContain(
        `loft001 = loft([profile001, profile002], bezApproximateRational = false)`
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })

    it('should edit a loft call with vDegree', async () => {
      const twoCirclesCodeWithLoft = `${twoCirclesCode}
loft001 = loft([profile001, profile002])`
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        twoCirclesCodeWithLoft,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(sketches.graphSelections).toHaveLength(2)
      const vDegree = await getKclCommandValue(
        '3',
        instanceInThisFile,
        rustContextInThisFile
      )
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addLoft({
        ast,
        artifactGraph,
        sketches,
        vDegree,
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(twoCirclesCode)
      expect(newCode).toContain(
        `loft001 = loft([profile001, profile002], vDegree = 3)`
      )
      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
    })
  })

  describe('Testing addRevolve', () => {
    const circleCode = `sketch001 = startSketchOn(XZ)
profile001 = circle(sketch001, center = [3, 0], radius = 1)`

    it('should add basic revolve call', async () => {
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        circleCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(sketches.graphSelections).toHaveLength(1)
      const angle = await getKclCommandValue(
        '10',
        instanceInThisFile,
        rustContextInThisFile
      )
      const axis = 'X'
      const result = addRevolve({
        ast,
        artifactGraph,
        sketches,
        angle,
        axis,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleCode)
      expect(newCode).toContain(
        `revolve001 = revolve(profile001, angle = 10, axis = X)`
      )
    })

    it('should add a revolve call from a sketch region selection', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
        triangleRegion,
        instanceInThisFile,
        rustContextInThisFile
      )
      const sketch = artifactGraph
        .values()
        .find((s) => s.type === 'sketchBlock')
      const sketches: Selections = {
        graphSelections: [],
        otherSelections: [
          {
            type: 'engineRegion',
            id: 'region-1',
            point: { x: 1, y: 1 },
            sketchId: sketch!.id,
          },
        ],
      }
      const angle = await getKclCommandValue(
        '10',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addRevolve({
        ast,
        artifactGraph,
        sketches,
        angle,
        axis: 'X',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `hidden001 = hide(s)
region001 = region(point = [1mm, 1mm], sketch = s)
revolve001 = revolve(region001, angle = 10, axis = X)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should edit a revolve call from a sketch region selection', async () => {
      const code = `${triangleRegion}
region001 = region(point = [1mm, 1mm], sketch = s)
revolve001 = revolve(region001, angle = 10, axis = X)`
      const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
        code,
        instanceInThisFile,
        rustContextInThisFile
      )
      const region = [...artifactGraph.values()].findLast(
        (s) => s.type === 'path'
      )
      const sketches = createSelectionFromArtifacts([region!], artifactGraph)
      const angle = await getKclCommandValue(
        '20',
        instanceInThisFile,
        rustContextInThisFile
      )
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addRevolve({
        ast,
        artifactGraph,
        sketches,
        angle,
        axis: 'Y',
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `revolve001 = revolve(region001, angle = 20, axis = Y)`
      )
    })

    it('should add basic revolve call with surface bodyType', async () => {
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        circleCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(sketches.graphSelections).toHaveLength(1)
      const angle = await getKclCommandValue(
        '10',
        instanceInThisFile,
        rustContextInThisFile
      )
      const axis = 'X'
      const result = addRevolve({
        ast,
        artifactGraph,
        sketches,
        angle,
        axis,
        bodyType: 'SURFACE',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleCode)
      expect(newCode).toContain(
        `revolve001 = revolve(
  profile001,
  angle = 10,
  axis = X,
  bodyType = SURFACE,
)`
      )
    })

    it('should add basic revolve call with surface bodyType on a sketch solve segment', async () => {
      const { ast, artifactGraph } = await getAstAndSketchSelections(
        triangleRegion,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const segment = createSelectionFromArtifacts(
        [artifactGraph.values().find((a) => a.type === 'segment')!],
        artifactGraph
      )
      const angle = await getKclCommandValue(
        '10',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addRevolve({
        ast,
        artifactGraph,
        sketches: segment,
        angle,
        axis: 'X',
        bodyType: 'SURFACE',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`${triangleRegion}
revolve001 = revolve(
  s.line1,
  angle = 10,
  axis = X,
  bodyType = SURFACE,
)`)
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add basic revolve call with symmetric true', async () => {
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        circleCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(sketches.graphSelections).toHaveLength(1)
      const angle = await getKclCommandValue(
        '10',
        instanceInThisFile,
        rustContextInThisFile
      )
      const axis = 'X'
      const symmetric = true
      const result = addRevolve({
        ast,
        artifactGraph,
        sketches,
        angle,
        axis,
        symmetric,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleCode)
      expect(newCode).toContain(`revolve001 = revolve(
  profile001,
  angle = 10,
  axis = X,
  symmetric = true,
)`)
    })

    it('should add basic revolve call with symmetric false', async () => {
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        circleCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      expect(sketches.graphSelections).toHaveLength(1)
      const angle = await getKclCommandValue(
        '10',
        instanceInThisFile,
        rustContextInThisFile
      )
      const axis = 'X'
      const symmetric = false
      const result = addRevolve({
        ast,
        artifactGraph,
        sketches,
        angle,
        axis,
        symmetric,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleCode)
      expect(newCode).toContain(`revolve001 = revolve(
  profile001,
  angle = 10,
  axis = X,
  symmetric = false,
)`)
    })

    it('should add a basic multi-profile revolve call', async () => {
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        circleAndRectProfilesCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const angle = await getKclCommandValue(
        '10',
        instanceInThisFile,
        rustContextInThisFile
      )
      const axis = 'X'
      const result = addRevolve({
        ast,
        artifactGraph,
        sketches,
        angle,
        axis,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `revolve001 = revolve([profile001, profile002], angle = 10, axis = X)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
    })

    it('should add revolve call around edge', async () => {
      const code = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [-102.57, 101.72])
  |> angledLine(angle = 0, length = 202.6, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 202.6, tag = $rectangleSegmentB001)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 50)
sketch002 = startSketchOn(extrude001, face = rectangleSegmentA001)
  |> circle(center = [-11.34, 10.0], radius = 8.69)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const artifacts = [...artifactGraph.values()]
      const circleArtifact = artifacts.findLast((a) => a.type === 'path')
      if (!circleArtifact) throw new Error('Circle artifact not found in graph')
      const sketches = createSelectionFromPathArtifact([circleArtifact])
      const edgeArtifact = artifacts.find((a) => a.type === 'segment')
      if (!edgeArtifact) throw new Error('Edge artifact not found in graph')
      const edge = createSelectionFromPathArtifact([edgeArtifact])
      const angle = await getKclCommandValue(
        '20',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addRevolve({
        ast,
        artifactGraph,
        sketches,
        angle,
        edge,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(code)
      expect(newCode).toContain(
        `revolve001 = revolve(sketch002, angle = 20, axis = rectangleSegmentA001`
      )
    })

    it('should add revolve call around line segment from sketch', async () => {
      const code = `sketch001 = startSketchOn(-XY)
  |> startProfile(at = [-0.48, 1.25])
  |> angledLine(angle = 0, length = 2.38, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 2.4, tag = $rectangleSegmentB001)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 5)
sketch003 = startSketchOn(extrude001, face = START)
  |> circle(center = [-0.69, 0.56], radius = 0.28)
sketch002 = startSketchOn(XY)
  |> startProfile(at = [-2.02, 1.79])
  |> xLine(length = 2.6)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const artifacts = [...artifactGraph.values()]
      const circleArtifact = artifacts.findLast((a) => a.type === 'path')
      if (!circleArtifact) throw new Error('Circle artifact not found in graph')
      const sketches = createSelectionFromPathArtifact([circleArtifact])
      const edgeArtifact = artifacts.findLast((a) => a.type === 'segment')
      if (!edgeArtifact) throw new Error('Edge artifact not found in graph')
      const edge = createSelectionFromPathArtifact([edgeArtifact])
      const angle = await getKclCommandValue(
        '360',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addRevolve({
        ast,
        artifactGraph,
        sketches,
        angle,
        edge,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(
        newCode
      ).toContain(`sketch003 = startSketchOn(extrude001, face = START)
  |> circle(center = [-0.69, 0.56], radius = 0.28)
sketch002 = startSketchOn(XY)
  |> startProfile(at = [-2.02, 1.79])
  |> xLine(length = 2.6, tag = $seg01)
revolve001 = revolve(sketch002, angle = 360, axis = seg01)`)
    })

    it('should add revolve call around a sketch block segment reference', async () => {
      const code = `sketch001 = sketch(on = XZ) {
  line1 = line(start = [var -3.34mm, var -1.89mm], end = [var -1.62mm, var -1.89mm])
  line2 = line(start = [var -1.62mm, var -1.89mm], end = [var -1.62mm, var 0.56mm])
  line3 = line(start = [var -1.62mm, var 0.56mm], end = [var -3.34mm, var 0.56mm])
  line4 = line(start = [var -3.34mm, var 0.56mm], end = [var -3.34mm, var -1.89mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
  line5 = line(start = [var 0.94mm, var -3.66mm], end = [var 0.05mm, var 4.57mm])
}`
      const { ast, artifactGraph } = await getAstAndArtifactGraphEngineless(
        code,
        instanceInThisFile,
        rustContextInThisFile
      )
      const sketch = [...artifactGraph.values()].find(
        (a) => a.type === 'sketchBlock'
      )
      if (!sketch) throw new Error('Sketch block artifact not found')
      const sketches: Selections = {
        graphSelections: [],
        otherSelections: [
          {
            type: 'engineRegion',
            id: 'region-1',
            point: { x: -2.48, y: -1.8875 },
            sketchId: sketch.id,
          },
        ],
      }

      const axisArtifact = [...artifactGraph.values()].findLast(
        (a) => a.type === 'segment'
      )
      if (!axisArtifact) throw new Error('Axis segment artifact not found')
      const edge = createSelectionFromArtifacts([axisArtifact], artifactGraph)
      const angle = await getKclCommandValue(
        '36deg',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addRevolve({
        ast,
        artifactGraph,
        sketches,
        angle,
        edge,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)

      expect(newCode).toContain(
        `hidden001 = hide(sketch001)
region001 = region(point = [-2.48mm, -1.8875mm], sketch = sketch001)
revolve001 = revolve(region001, angle = 36deg, axis = sketch001.line5)`
      )
    })

    it('should edit revolve call, changing axis and setting both lengths', async () => {
      const code = `${circleCode}
revolve001 = revolve(profile001, angle = 10, axis = X)`
      const { ast, artifactGraph, sketches } =
        await getAstAndSketchSelectionsEngineless(
          code,
          instanceInThisFile,
          rustContextInThisFile
        )
      expect(sketches.graphSelections).toHaveLength(1)
      const angle = await getKclCommandValue(
        '20',
        instanceInThisFile,
        rustContextInThisFile
      )
      const bidirectionalAngle = await getKclCommandValue(
        '30',
        instanceInThisFile,
        rustContextInThisFile
      )
      const axis = 'Y'
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addRevolve({
        ast,
        artifactGraph,
        sketches,
        angle,
        bidirectionalAngle,
        axis,
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(circleCode)
      expect(newCode).toContain(`revolve001 = revolve(
  profile001,
  angle = 20,
  axis = Y,
  bidirectionalAngle = 30,
)`)
    })
  })

  describe('Testing getAxisExpression', () => {
    it.each(['X', 'Y', 'Z'])(
      'should return axis expression for default axis %s',
      async (axis) => {
        const { instance } = await buildTheWorldAndNoEngineConnection()
        const ast = assertParse('', instance)
        const result = getAxisExpression(
          axis,
          undefined,
          ast,
          instanceInThisFile
        )
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
      const edge: Selections = createSelectionFromPathArtifact([edgeArtifact!])
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [1, 'index'],
        ['expression', 'ExpressionStatement'],
        ['body', 'PipeExpression'],
        [1, 'index'],
      ]
      const result = getAxisExpression(
        undefined,
        edge,
        ast,
        instanceInThisFile,
        artifactGraph,
        nodeToEdit
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
  })

  describe('Testing retrieveAxisOrEdgeSelectionsFromOpArg', () => {
    it.each(['X', 'Y', 'Z'])(
      'should return axis selection from axis op argument %s',
      async (axis) => {
        const helixCode = `helix001 = helix(
  axis = ${axis},
  revolutions = 1,
  angleStart = 0,
  radius = 1,
  length = 1,
)`
        const ast = assertParse(helixCode, instanceInThisFile)
        const { artifactGraph, operations } = await enginelessExecutor(
          ast,
          rustContextInThisFile
        )
        const op = getAllOperations(operations).find(
          (o) => o.type === 'StdLibCall' && o.name === 'helix'
        )
        if (!op || op.type !== 'StdLibCall' || !op.labeledArgs.axis) {
          throw new Error('Helix operation not found')
        }

        const result = retrieveAxisOrEdgeSelectionsFromOpArg(
          op.labeledArgs.axis,
          artifactGraph
        )
        if (err(result)) throw result
        expect(result.axisOrEdge).toEqual('Axis')
        expect(result.axis).toEqual(axis)
        expect(result.edge).toBeUndefined()
      }
    )

    it('should return edge selection from axis op argument', async () => {
      const helixCode = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> yLine(length = 1, tag = $seg01)
helix001 = helix(
  axis = seg01,
  revolutions = 1,
  angleStart = 0,
  radius = 1,
)`
      const ast = assertParse(helixCode, instanceInThisFile)
      const { artifactGraph, operations } = await enginelessExecutor(
        ast,
        rustContextInThisFile
      )
      const op = getAllOperations(operations).find(
        (o) => o.type === 'StdLibCall' && o.name === 'helix'
      )
      if (!op || op.type !== 'StdLibCall' || !op.labeledArgs.axis) {
        throw new Error('Helix operation not found')
      }
      const result = retrieveAxisOrEdgeSelectionsFromOpArg(
        op.labeledArgs.axis,
        artifactGraph
      )
      if (err(result)) throw result
      const segId = [...artifactGraph.values()].find(
        (a) => a.type === 'segment'
      )
      expect(result.axisOrEdge).toEqual('Edge')
      expect(result.edge).toBeDefined()
      expect(result.edge!.graphSelections[0].codeRef).toEqual(segId!.codeRef)
      expect(result.axis).toBeUndefined()
    })

    it('should return edge selection from member-expression axis op argument', async () => {
      const revolveCode = `sketch001 = sketch(on = XZ) {
  line1 = line(start = [var -3.34mm, var -1.89mm], end = [var -1.62mm, var -1.89mm])
  line2 = line(start = [var -1.62mm, var -1.89mm], end = [var -1.62mm, var 0.56mm])
  line3 = line(start = [var -1.62mm, var 0.56mm], end = [var -3.34mm, var 0.56mm])
  line4 = line(start = [var -3.34mm, var 0.56mm], end = [var -3.34mm, var -1.89mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
  line5 = line(start = [var 0.94mm, var -3.66mm], end = [var 0.05mm, var 4.57mm])
}
region001 = region(point = [-2.48mm, -1.8875mm], sketch = sketch001)
revolve001 = revolve(region001, angle = 36deg, axis = sketch001.line5)`
      const ast = assertParse(revolveCode, instanceInThisFile)
      const { artifactGraph, operations } = await enginelessExecutor(
        ast,
        rustContextInThisFile
      )
      const op = getAllOperations(operations).find(
        (o) => o.type === 'StdLibCall' && o.name === 'revolve'
      )
      if (!op || op.type !== 'StdLibCall' || !op.labeledArgs.axis) {
        throw new Error('Revolve operation not found')
      }
      const result = retrieveAxisOrEdgeSelectionsFromOpArg(
        op.labeledArgs.axis,
        artifactGraph
      )
      if (err(result)) throw result
      const segId = [...artifactGraph.values()].findLast(
        (a) => a.type === 'segment'
      )
      if (!segId) throw new Error('Segment artifact not found')
      const edgeSelection = result.edge?.graphSelections[0]
      if (!edgeSelection) throw new Error('Edge selection not found')
      if (!edgeSelection.artifact) throw new Error('Edge artifact not found')
      expect(result.axisOrEdge).toEqual('Edge')
      expect(result.edge).toBeDefined()
      expect(edgeSelection.artifact.id).toEqual(segId.id)
      expect(result.axis).toBeUndefined()
    })
  })

  describe('Testing retrieveBodyTypeFromOpArg', () => {
    async function findBodyTypeArg(code: string) {
      const ast = assertParse(code, instanceInThisFile)
      const { operations } = await enginelessExecutor(
        ast,
        rustContextInThisFile
      )
      const op = getAllOperations(operations).find(
        (o) => o.type === 'StdLibCall' && o.name === 'extrude'
      )
      if (!op || op.type !== 'StdLibCall' || !op.labeledArgs.bodyType) {
        throw new Error('Extrude operation not found')
      }

      return op.labeledArgs.bodyType
    }

    it('should return SOLID bodyType from op argument', async () => {
      const code = `${circleProfileCode}
extrude001 = extrude(profile001, length = 1, bodyType = SOLID)`
      const opArg = await findBodyTypeArg(code)
      const result = retrieveBodyTypeFromOpArg(opArg, code)
      if (err(result)) throw result
      expect(result).toEqual('SOLID')
    })

    it('should return SURFACE bodyType from op argument', async () => {
      const code = `${circleProfileCode}
extrude001 = extrude(profile001, length = 1, bodyType = SURFACE)`
      const opArg = await findBodyTypeArg(code)
      const result = retrieveBodyTypeFromOpArg(opArg, code)
      if (err(result)) throw result
      expect(result).toEqual('SURFACE')
    })
  })
})
