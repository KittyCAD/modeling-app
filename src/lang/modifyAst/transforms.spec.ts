import type { PathToNode } from '@src/lang/wasm'
import { recast } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { KclManager } from '@src/lang/KclManager'
import {
  addTranslate,
  addRotate,
  addClone,
  addAppearance,
} from '@src/lang/modifyAst/transforms'
import { err } from '@src/lib/trap'
import {
  createSelectionFromArtifacts,
  getAstAndArtifactGraph,
  getAstAndSketchSelections,
  getKclCommandValue,
  runNewAstAndCheckForSweep,
} from '@src/lib/testHelpers'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import type RustContext from '@src/lib/rustContext'
import { addScale } from '@src/lang/modifyAst/transforms'
import type { ConnectionManager } from '@src/network/connectionManager'
import { afterAll, expect, beforeEach, describe, it } from 'vitest'

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
      expect(newCode).toContain(
        `${code}\ntranslate(split001[1], x = 1, y = 0, z = 0)`
      )
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
})
