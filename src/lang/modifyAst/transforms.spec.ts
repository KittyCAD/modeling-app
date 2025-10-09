import type { Selections, Selection } from '@src/machines/modelingSharedTypes'
import type { Artifact, CodeRef, PathToNode } from '@src/lang/wasm'
import { assertParse, recast, type Program } from '@src/lang/wasm'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { KclManager } from '@src/lang/KclSingleton'
import {
  addTranslate,
  addRotate,
  addClone,
  addAppearance,
} from '@src/lang/modifyAst/transforms'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import { err } from '@src/lib/trap'
import { enginelessExecutor } from '@src/lib/testHelpers'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'
import type RustContext from '@src/lib/rustContext'
import { addScale } from '@src/lang/modifyAst/transforms'

async function getKclCommandValue(
  value: string,
  instance: ModuleType,
  rustContext: RustContext
) {
  const result = await stringToKclExpression(
    value,
    undefined,
    instance,
    rustContext
  )
  if (err(result) || 'errors' in result) {
    throw new Error(`Couldn't create kcl expression`)
  }

  return result
}

async function runNewAstAndCheckForSweep(
  ast: Node<Program>,
  rustContext: RustContext
) {
  const { artifactGraph } = await enginelessExecutor(
    ast,
    undefined,
    undefined,
    rustContext
  )
  const sweepArtifact = artifactGraph.values().find((a) => a.type === 'sweep')
  expect(sweepArtifact).toBeDefined()
}

function createSelectionFromPathArtifact(
  artifacts: (Artifact & { codeRef: CodeRef })[]
): Selections {
  const graphSelections = artifacts.map(
    (artifact) =>
      ({
        codeRef: artifact.codeRef,
        artifact,
      }) as Selection
  )
  return {
    graphSelections,
    otherSelections: [],
  }
}

async function getAstAndArtifactGraph(
  code: string,
  instance: ModuleType,
  kclManager: KclManager
) {
  const ast = assertParse(code, instance)
  await kclManager.executeAst({ ast })
  const {
    artifactGraph,
    execState: { operations },
    variables,
  } = kclManager
  await new Promise((resolve) => setTimeout(resolve, 100))
  return { ast, artifactGraph, operations, variables }
}

async function getAstAndSketchSelections(
  code: string,
  instance: ModuleType,
  kclManager: KclManager
) {
  const { ast, artifactGraph } = await getAstAndArtifactGraph(
    code,
    instance,
    kclManager
  )
  const artifacts = [...artifactGraph.values()].filter((a) => a.type === 'path')
  if (artifacts.length === 0) {
    throw new Error('Artifact not found in the graph')
  }
  const sketches = createSelectionFromPathArtifact(artifacts)
  return { artifactGraph, ast, sketches }
}

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
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should add a standalone translate call on sweep selection', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
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
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
      engineCommandManager.tearDown()
    })

    it('should push a call in pipe if selection was in variable-less pipe', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
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
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
      engineCommandManager.tearDown()
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
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should edit a call with variable if og selection was a variable sweep', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
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
)`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [3, 'index'],
        ['expression', 'ExpressionStatement'],
      ]
      const newCode = await runEditTranslateTest(
        code,
        nodeToEdit,
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(expectedNewCode)
      engineCommandManager.tearDown()
    })

    it('should edit a call in pipe if og selection was in pipe', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
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
  |> translate(x = 4, y = 5, z = 6)
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
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(expectedNewCode)
      engineCommandManager.tearDown()
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
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should add a standalone call on sweep selection', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
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
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
      engineCommandManager.tearDown()
    })

    it('should push a call in pipe if selection was in variable-less pipe', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
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
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
      engineCommandManager.tearDown()
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
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should edit a scale call with variable if og selection was a variable sweep', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
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
)`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [3, 'index'],
        ['expression', 'ExpressionStatement'],
      ]
      const newCode = await runEditScaleTest(
        code,
        nodeToEdit,
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(expectedNewCode)
      engineCommandManager.tearDown()
    })

    it('should edit a call in pipe if og selection was in pipe', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
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
  |> scale(x = 4, y = 5, z = 6)
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
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(expectedNewCode)
      engineCommandManager.tearDown()
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
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should add a standalone call on sweep selection', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
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
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
      engineCommandManager.tearDown()
    })

    it('should push a call in pipe if selection was in variable-less pipe', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
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
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
      engineCommandManager.tearDown()
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
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should edit a call with variable if og selection was a variable sweep', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
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
)`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [3, 'index'],
        ['expression', 'ExpressionStatement'],
      ]
      const newCode = await runEditRotateTest(
        code,
        nodeToEdit,
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(expectedNewCode)
      engineCommandManager.tearDown()
    })

    it('should edit a call in pipe if og selection was in pipe', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
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
  |> rotate(roll = 40, pitch = 50, yaw = 60)
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
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(expectedNewCode)
      engineCommandManager.tearDown()
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
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should add a standalone call on sweep selection', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
      const expectedNewLine = `yoyoyo = clone(extrude001)`
      const newCode = await runAddCloneTest(
        code,
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
      engineCommandManager.tearDown()
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
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    const box = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
    it('should add a standalone call on sweep selection', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
      const expectedNewLine = `appearance(extrude001, color = '#FF0000')`
      const newCode = await runAddAppearanceTest(
        box,
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(box + '\n' + expectedNewLine)
      engineCommandManager.tearDown()
    })

    it('should push a call in pipe if selection was in variable-less pipe', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
      const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)`
      const expectedNewLine = `  |> appearance(color = '#FF0000')`
      const newCode = await runAddAppearanceTest(
        code,
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(code + '\n' + expectedNewLine)
      engineCommandManager.tearDown()
    })

    it('should add a call with metalness and roughness', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(box, instance, kclManager)
      const result = addAppearance({
        ast,
        artifactGraph,
        objects,
        color: '#FF0000',
        metalness: await getKclCommandValue('1', instance, rustContext),
        roughness: await getKclCommandValue('2', instance, rustContext),
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      const newCode = recast(result.modifiedAst, instance)
      expect(newCode).toContain(`${box}
appearance(
  extrude001,
  color = '#FF0000',
  metalness = 1,
  roughness = 2,
)`)
      engineCommandManager.tearDown()
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
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst, rustContext)
      return recast(result.modifiedAst, instance)
    }

    it('should edit a call with variable if og selection was a variable sweep', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
appearance(extrude001, color = '#FF0000')`
      const expectedNewCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
appearance(extrude001, color = '#00FF00')`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [3, 'index'],
        ['expression', 'ExpressionStatement'],
      ]
      const newCode = await runEditAppearanceTest(
        code,
        nodeToEdit,
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(expectedNewCode)
      engineCommandManager.tearDown()
    }, 30_000)

    it('should edit a call in pipe if og selection was in pipe', async () => {
      const { instance, kclManager, engineCommandManager, rustContext } =
        await buildTheWorldAndConnectToEngine()
      const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> appearance(color = '#FF0000')`
      const expectedNewCode = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
  |> appearance(color = '#00FF00')`
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
        instance,
        kclManager,
        rustContext
      )
      expect(newCode).toContain(expectedNewCode)
      engineCommandManager.tearDown()
    })

    // TODO: missing multi-objects test
  })
})
