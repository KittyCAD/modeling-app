import type { KclManager } from '@src/lang/KclManager'
import {
  addAppearance,
  addClone,
  addDelete,
  addMirror3D,
  addRotate,
  addScale,
  addTranslate,
} from '@src/lang/modifyAst/transforms'
import { getNodeFromPath } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { assertParse, recast } from '@src/lang/wasm'
import type {
  Artifact,
  ArtifactGraph,
  PathToNode,
  VariableDeclaration,
} from '@src/lang/wasm'
import type RustContext from '@src/lib/rustContext'
import {
  createSelectionFromArtifacts,
  enginelessExecutor,
  getAstAndArtifactGraph,
  getAstAndSketchSelections,
  getKclCommandValue,
  runNewAstAndCheckForSweep,
} from '@src/lib/testHelpers'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type {
  NonCodeSelection,
  Selections,
} from '@src/machines/modelingSharedTypes'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
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
  engineCommandManagerInThisFile?.tearDown()
})

describe('transforms.test.ts', () => {
  describe('Testing addDelete', () => {
    function getSweepFixture() {
      const code = `extrude001 = extrude(profile001, length = 1)`
      const ast = assertParse(code, instanceInThisFile)
      const sourceRange: [number, number, number] = [0, code.length, 0]
      const sourcePathToNode = getNodePathFromSourceRange(ast, sourceRange)
      const sweep: Artifact = {
        type: 'sweep',
        id: 'sweep-id',
        subType: 'extrusion',
        pathId: 'path-id',
        surfaceIds: [],
        edgeIds: [],
        codeRef: {
          range: sourceRange,
          pathToNode: sourcePathToNode,
          nodePath: { steps: [] },
        },
        trajectoryId: null,
        method: 'new',
        consumed: false,
      }
      const artifactGraph: ArtifactGraph = new Map([[sweep.id, sweep]])

      return {
        artifactGraph,
        ast,
        code,
        sourcePathToNode,
        sourceRange,
        sweep,
      }
    }

    function getPatternFixture() {
      const code = `extrude001 = 0
pattern001 = patternLinear3d(extrude001, instances = 3, distance = 10, axis = [0, 0, 1])`
      const ast = assertParse(code, instanceInThisFile)
      const patternRange: [number, number, number] = [
        code.indexOf('patternLinear3d'),
        code.length,
        0,
      ]
      const patternPathToNode = getNodePathFromSourceRange(ast, patternRange)
      const pattern: Artifact = {
        type: 'pattern',
        id: 'pattern-command-id',
        subType: 'linear',
        sourceId: 'source-body-id',
        copyIds: ['copy-body-1', 'copy-body-2'],
        copyFaceIds: [],
        copyEdgeIds: [],
        codeRef: {
          range: patternRange,
          pathToNode: patternPathToNode,
          nodePath: { steps: [] },
        },
      }
      const artifactGraph: ArtifactGraph = new Map([[pattern.id, pattern]])

      return {
        artifactGraph,
        ast,
        pattern,
        patternPathToNode,
        patternRange,
      }
    }

    it('adds a delete call for a selected body', async () => {
      const { artifactGraph, ast, code, sourcePathToNode, sourceRange, sweep } =
        getSweepFixture()
      const result = addDelete({
        ast,
        artifactGraph,
        objects: {
          graphSelections: [
            {
              artifact: sweep,
              codeRef: {
                range: sourceRange,
                pathToNode: sourcePathToNode,
              },
            },
          ],
          otherSelections: [],
        },
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      expect(recast(result.modifiedAst, instanceInThisFile)).toContain(
        `${code}\ndelete(extrude001)`
      )
    })

    it('adds an indexed delete call for one body from a multi-output extrude', async () => {
      const code = `@settings(kclVersion = 2.0, experimentalFeatures = allow)

sketch001 = sketch(on = XY) {
  line1 = line(start = [var -0.34mm, var 0.84mm], end = [var 0.26mm, var 0.84mm])
  line2 = line(start = [var 0.26mm, var 0.84mm], end = [var 0.26mm, var -0.76mm])
  line3 = line(start = [var 0.26mm, var -0.76mm], end = [var -0.34mm, var -0.76mm])
  line4 = line(start = [var -0.34mm, var -0.76mm], end = [var -0.34mm, var 0.84mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
  circle1 = circle(start = [var 0.46mm, var 0mm], center = [var 0mm, var 0.1mm])
  vertical([circle1.center, ORIGIN])
  horizontal([circle1.start, ORIGIN])
}
hidden001 = hide(sketch001)
region001 = region(point = [-0.0524045mm, -0.3703336mm], sketch = sketch001)
region002 = region(point = [-0.04mm, 0.8375mm], sketch = sketch001)
extrude001 = extrude([region001, region002], length = 1)`
      const ast = assertParse(code, instanceInThisFile)
      const { artifactGraph } = await enginelessExecutor(
        ast,
        rustContextInThisFile
      )
      const regions = [...artifactGraph.values()]
        .filter(
          (artifact): artifact is Extract<Artifact, { type: 'path' }> =>
            artifact.type === 'path' && artifact.subType === 'region'
        )
        .sort((a, b) => a.codeRef.range[0] - b.codeRef.range[0])
      const firstRegion = regions[0]
      const secondRegion = regions[1]
      expect(firstRegion).toBeDefined()
      expect(secondRegion).toBeDefined()
      const firstExtrudeOutput = [...artifactGraph.values()].find(
        (artifact) =>
          artifact.type === 'sweep' &&
          artifact.subType === 'extrusion' &&
          artifact.pathId === firstRegion?.id
      )
      expect(firstExtrudeOutput).toBeDefined()

      const result = addDelete({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts(
          [firstExtrudeOutput!],
          artifactGraph
        ),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      expect(recast(result.modifiedAst, instanceInThisFile)).toContain(
        'delete(extrude001[0])'
      )

      const resultFromRegionSelection = addDelete({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([firstRegion], artifactGraph),
        wasmInstance: instanceInThisFile,
      })
      if (err(resultFromRegionSelection)) throw resultFromRegionSelection

      expect(
        recast(resultFromRegionSelection.modifiedAst, instanceInThisFile)
      ).toContain('delete(extrude001[0])')

      const resultFromSecondRegionSelection = addDelete({
        ast,
        artifactGraph,
        objects: createSelectionFromArtifacts([secondRegion], artifactGraph),
        wasmInstance: instanceInThisFile,
      })
      if (err(resultFromSecondRegionSelection))
        throw resultFromSecondRegionSelection

      expect(
        recast(resultFromSecondRegionSelection.modifiedAst, instanceInThisFile)
      ).toContain('delete(extrude001[1])')
    })

    it('adds delete calls with indexed pattern copy expressions', async () => {
      const { artifactGraph, ast, pattern, patternPathToNode, patternRange } =
        getPatternFixture()
      const result = addDelete({
        ast,
        artifactGraph,
        objects: {
          graphSelections: [
            {
              artifact: pattern,
              codeRef: {
                range: patternRange,
                pathToNode: patternPathToNode,
              },
              engineEntityId: 'copy-body-1',
              patternIndex: 1,
            },
          ],
          otherSelections: [],
        },
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      expect(recast(result.modifiedAst, instanceInThisFile)).toContain(
        'delete(pattern001[1])'
      )
    })
  })

  describe('Testing addTranslate', () => {
    async function runAddTranslateTest(
      code: string,
      instance: ModuleType,
      kclManager: KclManager,
      rustContext: RustContext
    ) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code, instance, kclManager)
      const result = addTranslate({
        ast,
        artifactGraph,
        objects,
        x: await getKclCommandValue('1', instance, rustContext),
        y: await getKclCommandValue('2', instance, rustContext),
        z: await getKclCommandValue('3', instance, rustContext),
        global: true,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should add a standalone translate call on sweep selection', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
      const expectedNewLine = `translate(
  extrude001,
  x = 1,
  y = 2,
  z = 3,
  global = true,
)`
      const newCode = await runAddTranslateTest(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should push a call in pipe if selection was in variable-less pipe', async () => {
      const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)`
      const expectedNewLine = `  |> translate(
       x = 1,
       y = 2,
       z = 3,
       global = true,
     )`
      const newCode = await runAddTranslateTest(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('uses indexed split output expressions for selections', async () => {
      const code = `sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 7.11mm, var 0mm])
  line2 = line(start = [var 7.11mm, var 0mm], end = [var 7.11mm, var 6.11mm])
  line3 = line(start = [var 7.11mm, var 6.11mm], end = [var 0mm, var 6.11mm])
  line4 = line(start = [var 0mm, var 6.11mm], end = [var 0mm, var 0mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
  coincident([line1.start, ORIGIN])
}
hidden001 = hide(sketch001)
region001 = region(point = [3.555mm, 0.0025mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5)
sketch002 = sketch(on = XY) {
  line1 = line(start = [var -5.19mm, var -7.27mm], end = [var 6.6mm, var 10.62mm])
}
hidden002 = hide(sketch002)
extrude002 = extrude(
  sketch002.line1,
  length = 10,
  symmetric = true,
  bodyType = SURFACE,
)
split001 = split(extrude001, tools = extrude002)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const splitOutput = [...artifactGraph.values()].find(
        (artifact) =>
          artifact.type === 'compositeSolid' &&
          artifact.subType === 'split' &&
          artifact.outputIndex === 1
      )
      if (!splitOutput) {
        throw new Error('Expected split output 1 in the artifact graph')
      }
      const objects = createSelectionFromArtifacts([splitOutput], artifactGraph)

      const result = addTranslate({
        ast,
        artifactGraph,
        objects,
        x: await getKclCommandValue(
          '1',
          instanceInThisFile,
          rustContextInThisFile
        ),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)

      const newCode = recast(result.modifiedAst, instanceInThisFile)
      if (err(newCode)) {
        throw newCode
      }
      expect(newCode).toContain(`${code}\ntranslate(split001[1], x = 1)`)
    })

    async function runEditTranslateTest(
      code: string,
      nodeToEdit: PathToNode,
      instance: ModuleType,
      kclManager: KclManager,
      rustContext: RustContext
    ) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code, instance, kclManager)
      const result = addTranslate({
        ast,
        artifactGraph,
        objects,
        x: await getKclCommandValue('4', instance, rustContext),
        y: await getKclCommandValue('5', instance, rustContext),
        z: await getKclCommandValue('6', instance, rustContext),
        global: false,
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should edit a call with variable if og selection was a variable sweep', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
translate(
  extrude001,
  x = 1,
  y = 2,
  z = 3,
  global = true,
)`
      const expectedNewCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
translate(
  extrude001,
  x = 4,
  y = 5,
  z = 6,
  global = false,
)`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [3, 'index'],
        ['expression', 'ExpressionStatement'],
      ]
      const newCode = await runEditTranslateTest(
        code,
        nodeToEdit,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(expectedNewCode)
    })

    it('should edit a call in pipe if og selection was in pipe', async () => {
      const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> translate(
        x = 1,
        y = 2,
        z = 3,
        global = true,
    )`
      const expectedNewCode = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> translate(
       x = 4,
       y = 5,
       z = 6,
       global = false,
     )
`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [0, 'index'],
        ['expression', 'ExpressionStatement'],
        ['body', 'PipeExpression'],
        [3, 'index'],
      ]
      const newCode = await runEditTranslateTest(
        code,
        nodeToEdit,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(expectedNewCode)
    })
  })

  describe('Testing addScale', () => {
    async function runAddScaleTest(
      code: string,
      instance: ModuleType,
      kclManager: KclManager,
      rustContext: RustContext
    ) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code, instance, kclManager)
      const result = addScale({
        ast,
        artifactGraph,
        objects,
        x: await getKclCommandValue('1', instance, rustContext),
        y: await getKclCommandValue('2', instance, rustContext),
        z: await getKclCommandValue('3', instance, rustContext),
        global: true,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should add a standalone call on sweep selection', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
      const expectedNewLine = `scale(
  extrude001,
  x = 1,
  y = 2,
  z = 3,
  global = true,
)`
      const newCode = await runAddScaleTest(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should push a call in pipe if selection was in variable-less pipe', async () => {
      const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)`
      const expectedNewLine = `  |> scale(
       x = 1,
       y = 2,
       z = 3,
       global = true,
     )`
      const newCode = await runAddScaleTest(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    const cylinderCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
    const scaledCylinderCode = `${cylinderCode}
scale(extrude001, factor = 2)`

    it('should add a scale call with factor', async () => {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(
        cylinderCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addScale({
        ast,
        artifactGraph,
        objects,
        factor: await getKclCommandValue(
          '2',
          instanceInThisFile,
          rustContextInThisFile
        ),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(scaledCylinderCode)
    })

    it('should edit a scale call with factor', async () => {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(
        scaledCylinderCode,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [3, 'index'],
        ['expression', 'ExpressionStatement'],
      ]
      const factor = await getKclCommandValue(
        '3',
        instanceInThisFile,
        rustContextInThisFile
      )
      const result = addScale({
        ast,
        artifactGraph,
        objects,
        factor,
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        scaledCylinderCode.replace('factor = 2', 'factor = 3')
      )
    })

    async function runEditScaleTest(
      code: string,
      nodeToEdit: PathToNode,
      instance: ModuleType,
      kclManager: KclManager,
      rustContext: RustContext
    ) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code, instance, kclManager)
      const result = addScale({
        ast,
        artifactGraph,
        objects,
        x: await getKclCommandValue('4', instance, rustContext),
        y: await getKclCommandValue('5', instance, rustContext),
        z: await getKclCommandValue('6', instance, rustContext),
        global: false,
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should edit a scale call with variable if og selection was a variable sweep', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
scale(
  extrude001,
  x = 1,
  y = 2,
  z = 3,
  global = true,
)`
      const expectedNewCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
scale(
  extrude001,
  x = 4,
  y = 5,
  z = 6,
  global = false,
)`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [3, 'index'],
        ['expression', 'ExpressionStatement'],
      ]
      const newCode = await runEditScaleTest(
        code,
        nodeToEdit,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(expectedNewCode)
    })

    it('should edit a call in pipe if og selection was in pipe', async () => {
      const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> scale(
        x = 1,
        y = 2,
        z = 3,
        global = true,
    )`
      const expectedNewCode = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> scale(
       x = 4,
       y = 5,
       z = 6,
       global = false,
     )
`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [0, 'index'],
        ['expression', 'ExpressionStatement'],
        ['body', 'PipeExpression'],
        [3, 'index'],
      ]
      const newCode = await runEditScaleTest(
        code,
        nodeToEdit,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(expectedNewCode)
    })

    // TODO: missing multi-objects test
  })

  describe('Testing addRotate', () => {
    async function runAddRotateTest(
      code: string,
      instance: ModuleType,
      kclManager: KclManager,
      rustContext: RustContext
    ) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code, instance, kclManager)
      const result = addRotate({
        ast,
        artifactGraph,
        objects,
        roll: await getKclCommandValue('10', instance, rustContext),
        pitch: await getKclCommandValue('20', instance, rustContext),
        yaw: await getKclCommandValue('30', instance, rustContext),
        global: true,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    async function runAddAxisRotateTest(
      code: string,
      instance: ModuleType,
      kclManager: KclManager,
      rustContext: RustContext
    ) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code, instance, kclManager)
      const result = addRotate({
        ast,
        artifactGraph,
        objects,
        axis: 'Z',
        angle: await getKclCommandValue('90deg', instance, rustContext),
        global: true,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should add a standalone call on sweep selection', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
      const expectedNewLine = `rotate(
  extrude001,
  roll = 10,
  pitch = 20,
  yaw = 30,
  global = true,
)`
      const newCode = await runAddRotateTest(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should add a named axis as a bare identifier', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
      const expectedNewLine = `rotate(
  extrude001,
  axis = Z,
  angle = 90deg,
  global = true,
)`
      const newCode = await runAddAxisRotateTest(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should add an axis array as an array expression', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
      const expectedNewLine = `rotate(
  extrude001,
  axis = [1, 0, 0],
  angle = 90deg,
  global = true,
)`
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(
        code,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addRotate({
        ast,
        artifactGraph,
        objects,
        axis: await getKclCommandValue(
          '[1, 0, 0]',
          instanceInThisFile,
          rustContextInThisFile
        ),
        angle: await getKclCommandValue(
          '90deg',
          instanceInThisFile,
          rustContextInThisFile
        ),
        global: true,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result

      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      expect(recast(result.modifiedAst, instanceInThisFile)).toContain(
        code + '\n' + expectedNewLine
      )
    })

    it('should push a call in pipe if selection was in variable-less pipe', async () => {
      const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)`
      const expectedNewLine = `  |> rotate(
       roll = 10,
       pitch = 20,
       yaw = 30,
       global = true,
     )`
      const newCode = await runAddRotateTest(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    async function runEditRotateTest(
      code: string,
      nodeToEdit: PathToNode,
      instance: ModuleType,
      kclManager: KclManager,
      rustContext: RustContext
    ) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code, instance, kclManager)
      const result = addRotate({
        ast,
        artifactGraph,
        objects,
        roll: await getKclCommandValue('40', instance, rustContext),
        pitch: await getKclCommandValue('50', instance, rustContext),
        yaw: await getKclCommandValue('60', instance, rustContext),
        global: false,
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should edit a call with variable if og selection was a variable sweep', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
rotate(
  extrude001,
  roll = 4,
  pitch = 5,
  yaw = 6,
  global = true,
)`
      const expectedNewCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
rotate(
  extrude001,
  roll = 40,
  pitch = 50,
  yaw = 60,
  global = false,
)`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [3, 'index'],
        ['expression', 'ExpressionStatement'],
      ]
      const newCode = await runEditRotateTest(
        code,
        nodeToEdit,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(expectedNewCode)
    })

    it('should edit a call in pipe if og selection was in pipe', async () => {
      const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> rotate(
        roll = 1,
        pitch = 2,
        yaw = 3,
        global = true,
    )`
      const expectedNewCode = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> rotate(
       roll = 40,
       pitch = 50,
       yaw = 60,
       global = false,
     )
`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [0, 'index'],
        ['expression', 'ExpressionStatement'],
        ['body', 'PipeExpression'],
        [3, 'index'],
      ]
      const newCode = await runEditRotateTest(
        code,
        nodeToEdit,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(expectedNewCode)
    })

    // TODO: missing multi-objects test
  })

  describe('Testing addClone', () => {
    async function runAddCloneTest(
      code: string,
      instance: ModuleType,
      kclManager: KclManager,
      rustContext: RustContext
    ) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code, instance, kclManager)
      const result = addClone({
        ast,
        artifactGraph,
        objects,
        variableName: 'yoyoyo',
        wasmInstance: instance,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should add a standalone call on sweep selection', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
      const expectedNewLine = `yoyoyo = clone(extrude001)`
      const newCode = await runAddCloneTest(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })
  })

  describe('Testing addAppearance', () => {
    async function runAddAppearanceTest(
      code: string,
      instance: ModuleType,
      kclManager: KclManager,
      rustContext: RustContext
    ) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code, instance, kclManager)
      const result = addAppearance({
        ast,
        artifactGraph,
        objects,
        color: '#FF0000',
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    const box = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
    it('should add a standalone call on sweep selection', async () => {
      const expectedNewLine = `appearance(extrude001, color = "#FF0000")`
      const newCode = await runAddAppearanceTest(
        box,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(box + '\n' + expectedNewLine)
    })

    it('should push a call in pipe if selection was in variable-less pipe', async () => {
      const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)`
      const expectedNewLine = `  |> appearance(color = "#FF0000")`
      const newCode = await runAddAppearanceTest(
        code,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should add a call with metalness, roughness, and opacity', async () => {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(
        box,
        instanceInThisFile,
        kclManagerInThisFile
      )
      const result = addAppearance({
        ast,
        artifactGraph,
        objects,
        color: '#FF0000',
        metalness: await getKclCommandValue(
          '1',
          instanceInThisFile,
          rustContextInThisFile
        ),
        roughness: await getKclCommandValue(
          '2',
          instanceInThisFile,
          rustContextInThisFile
        ),
        opacity: await getKclCommandValue(
          '3',
          instanceInThisFile,
          rustContextInThisFile
        ),
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`${box}
appearance(
  extrude001,
  color = "#FF0000",
  metalness = 1,
  roughness = 2,
  opacity = 3,
)`)
    })

    async function runEditAppearanceTest(
      code: string,
      nodeToEdit: PathToNode,
      instance: ModuleType,
      kclManager: KclManager,
      rustContext: RustContext
    ) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code, instance, kclManager)
      const result = addAppearance({
        ast,
        artifactGraph,
        objects,
        color: '#00FF00',
        nodeToEdit,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should edit a call with variable if og selection was a variable sweep', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
appearance(extrude001, color = "#FF0000")`
      const expectedNewCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
appearance(extrude001, color = "#00FF00")`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [3, 'index'],
        ['expression', 'ExpressionStatement'],
      ]
      const newCode = await runEditAppearanceTest(
        code,
        nodeToEdit,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(expectedNewCode)
    }, 30_000)

    it('should edit a call in pipe if og selection was in pipe', async () => {
      const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> appearance(color = "#FF0000")`
      const expectedNewCode = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> appearance(color = "#00FF00")`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [0, 'index'],
        ['expression', 'ExpressionStatement'],
        ['body', 'PipeExpression'],
        [3, 'index'],
      ]
      const newCode = await runEditAppearanceTest(
        code,
        nodeToEdit,
        instanceInThisFile,
        kclManagerInThisFile,
        rustContextInThisFile
      )
      expect(newCode).toContain(expectedNewCode)
    })

    // TODO: missing multi-objects test
  })

  describe('Testing addMirror3D', () => {
    async function getBodiesAndAcross({
      code,
      bodyIds,
      acrossId,
      acrossType,
      bodyType = 'path',
    }: {
      code: string
      bodyIds: number[]
      acrossId: number
      acrossType: 'plane' | 'segment' | 'wall'
      bodyType?: 'path' | 'sweep'
    }) {
      const ast = assertParse(code, instanceInThisFile)
      const { artifactGraph, variables } = await enginelessExecutor(
        ast,
        rustContextInThisFile
      )
      const bodyArtifacts = artifactGraph
        .values()
        .filter((artifact) => artifact.type === bodyType)
        .toArray()
      const acrossArtifacts = artifactGraph
        .values()
        .filter((artifact) => artifact.type === acrossType)
        .filter((artifact) => {
          if (artifact.type !== 'plane') {
            return true
          }

          const variable = getNodeFromPath<VariableDeclaration>(
            ast,
            artifact.codeRef.pathToNode,
            instanceInThisFile,
            'VariableDeclaration'
          )
          return (
            !err(variable) &&
            variable.node.declaration?.init?.type === 'CallExpressionKw' &&
            variable.node.declaration.init.callee.name.name === 'offsetPlane'
          )
        })
        .toArray()

      const bodies: Selections = {
        graphSelections: bodyIds.map((id) => {
          const artifact = bodyArtifacts[id]
          if (!artifact || !('codeRef' in artifact)) {
            throw new Error('Body artifact not found')
          }

          return {
            artifact,
            codeRef: artifact.codeRef,
          }
        }),
        otherSelections: [],
      }
      const across = createSelectionFromArtifacts(
        [acrossArtifacts[acrossId]],
        artifactGraph
      )

      return { ast, artifactGraph, variables, bodies, across }
    }

    async function runAddMirrorTest({
      code,
      bodyIds,
      acrossId = 0,
      acrossType = 'plane',
      bodyType,
    }: {
      code: string
      bodyIds: number[]
      acrossId?: number
      acrossType?: 'plane' | 'segment' | 'wall'
      bodyType?: 'path' | 'sweep'
    }) {
      const { ast, artifactGraph, variables, bodies, across } =
        await getBodiesAndAcross({
          code,
          bodyIds,
          acrossId,
          acrossType,
          bodyType,
        })
      const result = addMirror3D({
        ast,
        artifactGraph,
        variables,
        bodies,
        across,
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      return recast(result.modifiedAst, instanceInThisFile)
    }

    it('should add a standalone mirror3d call on standalone sweep selection', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0.2, 0.2], radius = 0.1)
extrude001 = extrude(profile001, length = 1)
plane001 = offsetPlane(YZ, offset = 1)`
      const expectedNewLine =
        'solid001 = mirror3d(extrude001, across = plane001)'
      const newCode = await runAddMirrorTest({
        code,
        bodyIds: [0],
      })

      expect(newCode).toContain(`${code}\n${expectedNewLine}`)
    })

    it('should push a mirror3d call in pipe if selection was in variable-less pipe', async () => {
      const code = `startSketchOn(XY)
  |> circle(center = [0.2, 0.2], radius = 0.1)
  |> extrude(length = 1)
plane001 = offsetPlane(YZ, offset = 1)`
      const newCode = await runAddMirrorTest({
        code,
        bodyIds: [0],
      })

      expect(newCode).toContain(`startSketchOn(XY)
  |> circle(center = [0.2, 0.2], radius = 0.1)
  |> extrude(length = 1)
  |> mirror3d(across = plane001)
plane001 = offsetPlane(YZ, offset = 1)`)
    })

    it('should support multi-solid selection for mirror3d', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
plane001 = offsetPlane(XY, offset = 2)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 1)
extrude002 = extrude(profile002, length = 1)
plane002 = offsetPlane(YZ, offset = 1)`
      const expectedNewLine =
        'solid001 = mirror3d([extrude001, extrude002], across = plane002)'
      const newCode = await runAddMirrorTest({
        code,
        bodyIds: [0, 1],
        acrossId: 1,
      })

      expect(newCode).toContain(`${code}\n${expectedNewLine}`)
    })

    it('should support a default plane as the mirror reference', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0.2, 0.2], radius = 0.1)
extrude001 = extrude(profile001, length = 1)`
      const ast = assertParse(code, instanceInThisFile)
      const { artifactGraph, variables } = await enginelessExecutor(
        ast,
        rustContextInThisFile
      )
      const bodyArtifact = artifactGraph
        .values()
        .find((artifact) => artifact.type === 'sweep')
      if (!bodyArtifact || !('codeRef' in bodyArtifact)) {
        throw new Error('Body artifact not found')
      }
      const result = addMirror3D({
        ast,
        artifactGraph,
        variables,
        bodies: {
          graphSelections: [
            {
              artifact: bodyArtifact,
              codeRef: bodyArtifact.codeRef,
            },
          ],
          otherSelections: [],
        },
        across: {
          graphSelections: [],
          otherSelections: [{ name: 'YZ', id: 'default-yz' }],
        },
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `${code}\nsolid001 = mirror3d(extrude001, across = YZ)`
      )
    })

    it('should support a body face as the mirror reference', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 10)
extrude001 = extrude(profile001, length = 10)`
      const ast = assertParse(code, instanceInThisFile)
      const { artifactGraph, variables } = await enginelessExecutor(
        ast,
        rustContextInThisFile
      )
      const bodyArtifact = artifactGraph
        .values()
        .find((artifact) => artifact.type === 'sweep')
      if (!bodyArtifact || !('codeRef' in bodyArtifact)) {
        throw new Error('Body artifact not found')
      }
      const capArtifact: Artifact = {
        type: 'cap',
        id: 'cap-end-test',
        subType: 'end',
        sweepId: bodyArtifact.id,
        pathIds: [],
        edgeCutEdgeIds: [],
        faceCodeRef: bodyArtifact.codeRef,
        cmdId: '',
      }
      artifactGraph.set(capArtifact.id, capArtifact)
      const result = addMirror3D({
        ast,
        artifactGraph,
        variables,
        bodies: {
          graphSelections: [
            {
              artifact: bodyArtifact,
              codeRef: bodyArtifact.codeRef,
            },
          ],
          otherSelections: [],
        },
        across: {
          graphSelections: [
            {
              artifact: capArtifact,
              codeRef: bodyArtifact.codeRef,
            },
          ],
          otherSelections: [],
        },
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(
        `plane001 = planeOf(extrude001, face = capEnd001)
solid001 = mirror3d(extrude001, across = plane001)`
      )
    })

    it('should support an engine primitive face as the mirror reference', async () => {
      const code = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 0deg, length = 30, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90deg, length = 30)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 30)
shell001 = shell(extrude001, faces = rectangleSegmentA001, thickness = 1)`
      const ast = assertParse(code, instanceInThisFile)
      const { artifactGraph, variables } = await enginelessExecutor(
        ast,
        rustContextInThisFile
      )
      const bodyArtifact = artifactGraph
        .values()
        .find((artifact) => artifact.type === 'sweep')
      if (!bodyArtifact || !('codeRef' in bodyArtifact)) {
        throw new Error('Body artifact not found')
      }
      const primitiveFace: NonCodeSelection = {
        entityId: 'irrelevant-for-this-test',
        parentEntityId: bodyArtifact.id,
        primitiveIndex: 6,
        primitiveType: 'face',
        type: 'enginePrimitive',
      }
      const result = addMirror3D({
        ast,
        artifactGraph,
        variables,
        bodies: {
          graphSelections: [
            {
              artifact: bodyArtifact,
              codeRef: bodyArtifact.codeRef,
            },
          ],
          otherSelections: [],
        },
        across: {
          graphSelections: [],
          otherSelections: [primitiveFace],
        },
        wasmInstance: instanceInThisFile,
      })
      if (err(result)) {
        throw result
      }

      await enginelessExecutor(result.modifiedAst, rustContextInThisFile)
      const newCode = recast(result.modifiedAst, instanceInThisFile)
      expect(newCode).toContain(`${code}
face001 = faceId(extrude001, index = 6)
plane001 = planeOf(extrude001, face = face001)
solid001 = mirror3d(extrude001, across = plane001)`)
    })

    it('should support a sketch segment as the mirror reference', async () => {
      const code = `sketch001 = sketch(on = XY) {
  line1 = line(start = [var -1mm, var -1mm], end = [var 1mm, var -1mm])
  line2 = line(start = [var 1mm, var -1mm], end = [var 1mm, var 1mm])
  line3 = line(start = [var 1mm, var 1mm], end = [var -1mm, var 1mm])
  line4 = line(start = [var -1mm, var 1mm], end = [var -1mm, var -1mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  line5 = line(start = [var 0mm, var -2mm], end = [var 0mm, var 2mm])
}
region001 = region(point = [0mm, 0mm], sketch = sketch001)
extrude001 = extrude(region001, length = 1)`
      const expectedNewLine =
        'solid001 = mirror3d(extrude001, across = sketch001.line5)'
      const newCode = await runAddMirrorTest({
        code,
        bodyIds: [0],
        acrossId: 4,
        acrossType: 'segment',
        bodyType: 'sweep',
      })

      expect(newCode).toContain(`${code}\n${expectedNewLine}`)
    })
  })
})
