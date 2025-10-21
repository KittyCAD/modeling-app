import {
  type Artifact,
  assertParse,
  type CodeRef,
  type PathToNode,
  type Program,
  recast,
  type Name,
  type PlaneArtifact,
  type CallExpressionKw,
  type PipeExpression,
  type SourceRange,
  type VariableDeclarator,
  defaultNodePath,
  nodePathFromRange,
  type ParseResult,
} from '@src/lang/wasm'
import type { Selection, Selections } from '@src/machines/modelingSharedTypes'
import { enginelessExecutor } from '@src/lib/testHelpers'
import { err, reportRejection } from '@src/lib/trap'
import { stringToKclExpression } from '@src/lib/kclHelpers'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import {
  addAppearance,
  addClone,
  addRotate,
  addScale,
  addTranslate,
} from '@src/lang/modifyAst/transforms'
import { modifyAstWithTagsForSelection } from '@src/lang/modifyAst/tagManagement'
import {
  engineCommandManager,
  kclManager,
  rustContext,
  codeManager,
  editorManager,
} from '@src/lib/singletons'
import type { ArtifactGraph } from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'
import env from '@src/env'
import {
  addExtrude,
  addLoft,
  addRevolve,
  addSweep,
  getAxisExpressionAndIndex,
  retrieveAxisOrEdgeSelectionsFromOpArg,
} from '@src/lang/modifyAst/sweeps'
import { createPathToNodeForLastVariable } from '@src/lang/modifyAst'
import {
  addPatternCircular3D,
  addPatternLinear3D,
} from '@src/lang/modifyAst/pattern3D'
import type { KclCommandValue } from '@src/lib/commandTypes'
import { addHelix } from '@src/lang/modifyAst/geometry'
import {
  addOffsetPlane,
  addShell,
  retrieveFaceSelectionsFromOpArgs,
  retrieveNonDefaultPlaneSelectionFromOpArg,
} from '@src/lang/modifyAst/faces'
import type { DefaultPlaneStr } from '@src/lib/planes'
import type { StdLibCallOp } from '@src/lang/queryAst'
import { getCodeRefsByArtifactId } from '@src/lang/std/artifactGraph'
import {
  createLiteral,
  createIdentifier,
  createVariableDeclaration,
} from '@src/lang/create'
import type {
  ChamferParameters,
  EdgeTreatmentParameters,
  FilletParameters,
} from '@src/lang/modifyAst/addEdgeTreatment'
import {
  EdgeTreatmentType,
  deleteEdgeTreatment,
  getPathToExtrudeForSegmentSelection,
  hasValidEdgeTreatmentSelection,
  modifyAstWithEdgeTreatmentAndTag,
} from '@src/lang/modifyAst/addEdgeTreatment'
import { getEdgeCutMeta, getNodeFromPath } from '@src/lang/queryAst'
import { getNodePathFromSourceRange } from '@src/lang/queryAstNodePathUtils'
import { codeRefFromRange } from '@src/lang/std/artifactGraph'
import { topLevelRange } from '@src/lang/util'
import { isOverlap } from '@src/lib/utils'
import { addSubtract } from '@src/lang/modifyAst/boolean'
import { addFlatnessGdt } from '@src/lang/modifyAst/gdt'
import type { NodePath } from '@rust/kcl-lib/bindings/NodePath'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import { defaultSourceRange } from '@src/lang/sourceRange'
import { filterOperations, getOperationVariableName } from '@src/lib/operations'
import {
  getCalculatedKclExpressionValue,
  getStringValue,
} from '@src/lib/kclHelpers'
import { getSafeInsertIndex } from '@src/lang/queryAst/getSafeInsertIndex'
import type { Coords2d } from '@src/lang/util'
import { isPointsCCW } from '@src/lang/wasm'
import { closestPointOnRay } from '@src/lib/utils2d'
import { expect } from 'vitest'
import type { VariableDeclaration } from '@src/lang/wasm'
import { updateCenterRectangleSketch } from '@src/lib/rectangleTool'
import { trap } from '@src/lib/trap'
import fs from 'node:fs'
import { ARG_INDEX_FIELD, LABELED_ARG_FIELD } from '@src/lang/queryAstConstants'
import type { Parameter } from '@src/lang/wasm'
import { modelingMachine } from '@src/machines/modelingMachine'
import { createActor } from 'xstate'
import { vi } from 'vitest'
import { getConstraintInfoKw } from '@src/lang/std/sketch'
import { ARG_END_ABSOLUTE, ARG_INTERIOR_ABSOLUTE } from '@src/lang/constants'
import { removeSingleConstraintInfo } from '@src/lang/modifyAst'
import { getTagDeclaratorsInProgram } from '@src/lang/queryAst/getTagDeclaratorsInProgram'
import { modelingMachineDefaultContext } from '@src/machines/modelingSharedContext'
import {
  removeSingleConstraint,
  transformAstSketchLines,
} from '@src/lang/std/sketchcombos'

// Unfortunately, we need the real engine here it seems to get sweep faces populated
beforeAll(async () => {
  await initPromise
  await new Promise((resolve) => {
    engineCommandManager
      .start({
        token: env().VITE_ZOO_API_TOKEN || '',
        width: 256,
        height: 256,
        setStreamIsReady: () => {
          console.log('no op for a unit test')
        },
        callbackOnUnitTestingConnection: () => {
          resolve(true)
        },
      })
      .catch(reportRejection)
  })
}, 30_000)

afterAll(() => {
  engineCommandManager.tearDown()
})

// TODO: two different methods for the same thing. Why?
async function ENGLINELESS_getAstAndArtifactGraph(code: string) {
  const ast = assertParse(code)
  if (err(ast)) throw ast

  const { artifactGraph } = await enginelessExecutor(ast)
  return { ast, artifactGraph }
}

async function getAstAndArtifactGraph(code: string) {
  const ast = assertParse(code)
  await kclManager.executeAst({ ast })
  const {
    artifactGraph,
    execState: { operations },
    variables,
  } = kclManager
  await new Promise((resolve) => setTimeout(resolve, 100))
  return { ast, artifactGraph, operations, variables }
}
const executeCode = async (code: string) => {
  const ast = assertParse(code)
  await kclManager.executeAst({ ast })
  const artifactGraph = kclManager.artifactGraph
  await new Promise((resolve) => setTimeout(resolve, 100))
  return { ast, artifactGraph }
}

function createSelectionFromArtifacts(
  artifacts: Artifact[],
  artifactGraph: ArtifactGraph
): Selections {
  const graphSelections = artifacts.flatMap((artifact) => {
    const codeRefs = getCodeRefsByArtifactId(artifact.id, artifactGraph)
    if (!codeRefs || codeRefs.length === 0) {
      return []
    }

    return {
      codeRef: codeRefs[0],
      artifact,
    } as Selection
  })
  return {
    graphSelections,
    otherSelections: [],
  }
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

async function ENGINELESS_getAstAndSketchSelections(code: string) {
  const { ast, artifactGraph } = await ENGLINELESS_getAstAndArtifactGraph(code)
  const artifacts = [...artifactGraph.values()].filter((a) => a.type === 'path')
  if (artifacts.length === 0) {
    throw new Error('Artifact not found in the graph')
  }
  const sketches = createSelectionFromPathArtifact(artifacts)
  return { artifactGraph, ast, sketches }
}

async function getAstAndSketchSelections(
  code: string,
  count: number | undefined = undefined
) {
  const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
  const artifacts = [...artifactGraph.values()].filter((a) => a.type === 'path')
  if (artifacts.length === 0) {
    throw new Error('Artifact not found in the graph')
  }

  const sketches = createSelectionFromPathArtifact(
    artifacts.slice(count ? -count : undefined)
  )
  return { artifactGraph, ast, sketches }
}

function getFacesFromBox(artifactGraph: ArtifactGraph, count: number) {
  const twoWalls = [...artifactGraph.values()]
    .filter((a) => a.type === 'wall')
    .slice(0, count)
  return createSelectionFromArtifacts(twoWalls, artifactGraph)
}

function getCapFromCylinder(artifactGraph: ArtifactGraph) {
  const endFace = [...artifactGraph.values()].find(
    (a) => a.type === 'cap' && a.subType === 'end'
  )
  return createSelectionFromArtifacts([endFace!], artifactGraph)
}

async function getKclCommandValue(value: string) {
  const result = await stringToKclExpression(value)
  if (err(result) || 'errors' in result) {
    throw new Error(`Couldn't create kcl expression`)
  }

  return result
}

async function runNewAstAndCheckForSweep(ast: Node<Program>) {
  const { artifactGraph } = await enginelessExecutor(ast)
  const sweepArtifact = artifactGraph.values().find((a) => a.type === 'sweep')
  expect(sweepArtifact).toBeDefined()
}
const createSelectionWithFirstMatchingArtifact = async (
  artifactGraph: ArtifactGraph,
  artifactType: string,
  subType?: string
) => {
  // Check if any artifacts of this type exist at all
  const allArtifactsOfType = [...artifactGraph].filter(([, artifact]) => {
    if (artifact.type !== artifactType) return false
    // If subType is specified, check for that too
    if (subType && 'subType' in artifact && artifact.subType !== subType)
      return false
    return true
  })

  // get first artifact of this type
  const firstArtifactsOfType = allArtifactsOfType[0][1]
  if (!firstArtifactsOfType) {
    return new Error(`No artifacts of type ${artifactType} found`)
  }

  // get codeRef
  let codeRef = null

  if (firstArtifactsOfType.type === 'segment') {
    codeRef = firstArtifactsOfType.codeRef
  } else if (firstArtifactsOfType.type === 'sweepEdge') {
    // find the parent segment
    const segment = [...artifactGraph].filter(([, artifact]) => {
      if (artifact.id !== firstArtifactsOfType.segId) return false
      return true
    })
    if ('codeRef' in segment[0][1]) {
      codeRef = segment[0][1].codeRef
    }
  }

  if (!codeRef) {
    return new Error('No codeRef found for artifact')
  }

  // Create selection from found artifact
  const selection: Selection = {
    artifact: firstArtifactsOfType,
    codeRef: codeRef,
  }

  return { selection }
}

describe('transforms.spec.ts', () => {
  describe('Testing addTranslate', () => {
    async function runAddTranslateTest(code: string) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code)
      const result = addTranslate({
        ast,
        artifactGraph,
        objects,
        x: await getKclCommandValue('1'),
        y: await getKclCommandValue('2'),
        z: await getKclCommandValue('3'),
        global: true,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      return recast(result.modifiedAst)
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
      const newCode = await runAddTranslateTest(code)
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
      const newCode = await runAddTranslateTest(code)
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    async function runEditTranslateTest(code: string, nodeToEdit: PathToNode) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code)
      const result = addTranslate({
        ast,
        artifactGraph,
        objects,
        x: await getKclCommandValue('4'),
        y: await getKclCommandValue('5'),
        z: await getKclCommandValue('6'),
        global: false,
        nodeToEdit,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      return recast(result.modifiedAst)
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
)`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [3, 'index'],
        ['expression', 'ExpressionStatement'],
      ]
      const newCode = await runEditTranslateTest(code, nodeToEdit)
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
  |> translate(x = 4, y = 5, z = 6)
`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [0, 'index'],
        ['expression', 'ExpressionStatement'],
        ['body', 'PipeExpression'],
        [3, 'index'],
      ]
      const newCode = await runEditTranslateTest(code, nodeToEdit)
      expect(newCode).toContain(expectedNewCode)
    })
  })

  describe('Testing addScale', () => {
    async function runAddScaleTest(code: string) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code)
      const result = addScale({
        ast,
        artifactGraph,
        objects,
        x: await getKclCommandValue('1'),
        y: await getKclCommandValue('2'),
        z: await getKclCommandValue('3'),
        global: true,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      return recast(result.modifiedAst)
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
      const newCode = await runAddScaleTest(code)
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
      const newCode = await runAddScaleTest(code)
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    async function runEditScaleTest(code: string, nodeToEdit: PathToNode) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code)
      const result = addScale({
        ast,
        artifactGraph,
        objects,
        x: await getKclCommandValue('4'),
        y: await getKclCommandValue('5'),
        z: await getKclCommandValue('6'),
        global: false,
        nodeToEdit,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      return recast(result.modifiedAst)
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
)`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [3, 'index'],
        ['expression', 'ExpressionStatement'],
      ]
      const newCode = await runEditScaleTest(code, nodeToEdit)
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
  |> scale(x = 4, y = 5, z = 6)
`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [0, 'index'],
        ['expression', 'ExpressionStatement'],
        ['body', 'PipeExpression'],
        [3, 'index'],
      ]
      const newCode = await runEditScaleTest(code, nodeToEdit)
      expect(newCode).toContain(expectedNewCode)
    })

    // TODO: missing multi-objects test
  })

  describe('Testing addRotate', () => {
    async function runAddRotateTest(code: string) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code)
      const result = addRotate({
        ast,
        artifactGraph,
        objects,
        roll: await getKclCommandValue('10'),
        pitch: await getKclCommandValue('20'),
        yaw: await getKclCommandValue('30'),
        global: true,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      return recast(result.modifiedAst)
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
      const newCode = await runAddRotateTest(code)
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
      const newCode = await runAddRotateTest(code)
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    async function runEditRotateTest(code: string, nodeToEdit: PathToNode) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code)
      const result = addRotate({
        ast,
        artifactGraph,
        objects,
        roll: await getKclCommandValue('40'),
        pitch: await getKclCommandValue('50'),
        yaw: await getKclCommandValue('60'),
        global: false,
        nodeToEdit,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      return recast(result.modifiedAst)
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
)`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [3, 'index'],
        ['expression', 'ExpressionStatement'],
      ]
      const newCode = await runEditRotateTest(code, nodeToEdit)
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
  |> rotate(roll = 40, pitch = 50, yaw = 60)
`
      const nodeToEdit: PathToNode = [
        ['body', ''],
        [0, 'index'],
        ['expression', 'ExpressionStatement'],
        ['body', 'PipeExpression'],
        [3, 'index'],
      ]
      const newCode = await runEditRotateTest(code, nodeToEdit)
      expect(newCode).toContain(expectedNewCode)
    })

    // TODO: missing multi-objects test
  })

  describe('Testing addClone', () => {
    async function runAddCloneTest(code: string) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code)
      const result = addClone({
        ast,
        artifactGraph,
        objects,
        variableName: 'yoyoyo',
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      return recast(result.modifiedAst)
    }

    it('should add a standalone call on sweep selection', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
      const expectedNewLine = `yoyoyo = clone(extrude001)`
      const newCode = await runAddCloneTest(code)
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })
  })

  describe('Testing addAppearance', () => {
    async function runAddAppearanceTest(code: string) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code)
      const result = addAppearance({
        ast,
        artifactGraph,
        objects,
        color: '#FF0000',
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      return recast(result.modifiedAst)
    }

    const box = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
    it('should add a standalone call on sweep selection', async () => {
      const expectedNewLine = `appearance(extrude001, color = '#FF0000')`
      const newCode = await runAddAppearanceTest(box)
      expect(newCode).toContain(box + '\n' + expectedNewLine)
    })

    it('should push a call in pipe if selection was in variable-less pipe', async () => {
      const code = `startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)`
      const expectedNewLine = `  |> appearance(color = '#FF0000')`
      const newCode = await runAddAppearanceTest(code)
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should add a call with metalness and roughness', async () => {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(box)
      const result = addAppearance({
        ast,
        artifactGraph,
        objects,
        color: '#FF0000',
        metalness: await getKclCommandValue('1'),
        roughness: await getKclCommandValue('2'),
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(`${box}
appearance(
  extrude001,
  color = '#FF0000',
  metalness = 1,
  roughness = 2,
)`)
    })

    async function runEditAppearanceTest(code: string, nodeToEdit: PathToNode) {
      const {
        artifactGraph,
        ast,
        sketches: objects,
      } = await getAstAndSketchSelections(code)
      const result = addAppearance({
        ast,
        artifactGraph,
        objects,
        color: '#00FF00',
        nodeToEdit,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      return recast(result.modifiedAst)
    }

    it('should edit a call with variable if og selection was a variable sweep', async () => {
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
      const newCode = await runEditAppearanceTest(code, nodeToEdit)
      expect(newCode).toContain(expectedNewCode)
    })

    it('should edit a call in pipe if og selection was in pipe', async () => {
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
      const newCode = await runEditAppearanceTest(code, nodeToEdit)
      expect(newCode).toContain(expectedNewCode)
    })

    // TODO: missing multi-objects test
  })
})

describe('tagManagement.spec.ts', () => {
  // Tag Management System Tests
  //
  // The tag management system automatically adds tags to KCL expressions
  // when users select geometry for operations.
  //
  // Test Structure:
  // - Integration tests: modifyAstWithTagsForSelection (high-level workflows)
  // - Unit tests: mutateAstWithTagForSketchSegment (specific edge cut functionality)
  //
  // Key functionality tested:
  // - Face tagging: wall faces, cap faces, edgeCut faces (chamfers/fillets)
  // - Edge tagging: segments, sweep edges
  // - Complex scenarios: multi-tag breakup, tag deduplication
  const basicExampleCode = `
sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 15)`
  const boxWithOneTagAndChamfer = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
  |> chamfer(
        length = 1,
        tags = [
          getCommonEdge(faces = [seg01, capEnd001])
        ],
      )`
  const boxWithOneTagAndFillet = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
  |> fillet(
        radius = 1,
        tags = [
          getCommonEdge(faces = [seg01, capEnd001])
        ],
      )`

  describe('modifyAstWithTagsForSelection', () => {
    // ----------------------------------------
    // 2D Entities
    // ----------------------------------------

    // TODO: Add handling for PLANE selections (2D construction planes)

    // ----------------------------------------
    // Sketch Entities
    // ----------------------------------------

    // TODO: Add handling for POINT selections (sketch points)
    // TODO: Add handling for CURVE selections (lines, arcs, splines)
    // TODO: Add handling for SKETCH selections (entire sketches)

    // ----------------------------------------
    // Body Entities
    // ----------------------------------------

    // TODO: Add handling for VERTEX selections

    // Handle EDGE selections (commonEdge approach)
    it('should tag a segment and capStart using commonEdge approach', async () => {
      const { ast, artifactGraph } = await executeCode(basicExampleCode)
      // Find an edge artifact
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'segment' // segment // sweepEdge // edgeCutEdge
        // adjacent // opposite
      )
      if (err(selectionResult)) return selectionResult
      const { selection } = selectionResult

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        selection,
        artifactGraph
      )
      if (err(result)) return result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst)

      // Verify results
      expect(tags.length).toBe(2) // Should add two tags
      expect(newCode).toContain('tag = $seg01')
      expect(newCode).toContain('tagStart = $capStart001')
      expect(tags).toBeTruthy() // Tags should be non-empty strings
    }, 5_000)
    it('should tag 2 segments using commonEdge approach', async () => {
      const { ast, artifactGraph } = await executeCode(basicExampleCode)
      // Find an edge artifact
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'sweepEdge', // segment // sweepEdge // edgeCutEdge
        'adjacent' // adjacent // opposite
      )
      if (err(selectionResult)) return selectionResult
      const { selection } = selectionResult

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        selection,
        artifactGraph
      )
      if (err(result)) return result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst)

      // Verify results
      expect(tags.length).toBe(2) // Should add two tags
      expect(newCode).toContain('tag = $seg01')
      expect(newCode).toContain('tag = $seg02')
      expect(tags).toBeTruthy() // Tags should be non-empty strings
    }, 5_000)
    it('should tag a segment and capEnd using commonEdge approach', async () => {
      const { ast, artifactGraph } = await executeCode(basicExampleCode)
      // Find an edge artifact
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'sweepEdge', // segment // sweepEdge // edgeCutEdge
        'opposite' // adjacent // opposite
      )
      if (err(selectionResult)) return selectionResult
      const { selection } = selectionResult

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        selection,
        artifactGraph
      )
      if (err(result)) return result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst)

      // Verify results
      expect(tags.length).toBe(2) // Should add two tags
      expect(newCode).toContain('tag = $seg01')
      expect(newCode).toContain('tagEnd = $capEnd001')
      expect(tags).toBeTruthy() // Tags should be non-empty strings
    }, 5_000)
    // Handle EDGE selections (getOpposite/AdjacentEdge approach)
    it('should tag a segment using legacy oppositeAndAdjacentEdges approach for base edge selection', async () => {
      const { ast, artifactGraph } = await executeCode(basicExampleCode)
      // Find an edge artifact
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'segment' // segment // sweepEdge // edgeCutEdge
        // adjacent // opposite
      )
      if (err(selectionResult)) return selectionResult
      const { selection } = selectionResult

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        selection,
        artifactGraph,
        ['oppositeAndAdjacentEdges']
      )
      if (err(result)) return result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst)

      // Verify results
      expect(tags.length).toBe(1) // Should add one tag
      expect(newCode).toContain('tag = $seg01')
      expect(tags).toBeTruthy() // Tags should be non-empty strings
    }, 5_000)
    it('should tag a segment using legacy oppositeAndAdjacentEdges approach for adjacent edge selection', async () => {
      const { ast, artifactGraph } = await executeCode(basicExampleCode)
      // Find an edge artifact
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'sweepEdge', // segment // sweepEdge // edgeCutEdge
        'adjacent' // adjacent // opposite
      )
      if (err(selectionResult)) return selectionResult
      const { selection } = selectionResult
      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        selection,
        artifactGraph,
        ['oppositeAndAdjacentEdges']
      )
      if (err(result)) return result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst)

      // Verify results
      expect(tags.length).toBe(1) // Should add one tag
      expect(newCode).toContain('tag = $seg01')
      expect(tags).toBeTruthy() // Tags should be non-empty strings
    }, 5_000)
    it('should tag a segment using legacy oppositeAndAdjacentEdges approach for opposite edge selection', async () => {
      const { ast, artifactGraph } = await executeCode(basicExampleCode)
      // Find an edge artifact
      const selectionResult = await createSelectionWithFirstMatchingArtifact(
        artifactGraph,
        'sweepEdge', // segment // sweepEdge // edgeCutEdge
        'opposite' // adjacent // opposite
      )
      if (err(selectionResult)) return selectionResult
      const { selection } = selectionResult

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        selection,
        artifactGraph,
        ['oppositeAndAdjacentEdges']
      )
      if (err(result)) return result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst)

      // Verify results
      expect(tags.length).toBe(1) // Should add one tag
      expect(newCode).toContain('tag = $seg01')
      expect(tags).toBeTruthy() // Tags should be non-empty strings
    }, 5_000)

    // Handle FACE selections
    it('should tag a wall face by tagging the underlying segment', async () => {
      const { ast, artifactGraph } = await executeCode(basicExampleCode)
      // Find a wall face artifact
      const wallArtifact = [...artifactGraph.values()].find(
        (a) => a.type === 'wall'
      )
      expect(wallArtifact).toBeDefined()

      const selection = createSelectionFromArtifacts(
        [wallArtifact!],
        artifactGraph
      )
      const wallFaceSelection = selection.graphSelections[0]

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        wallFaceSelection,
        artifactGraph
      )
      if (err(result)) throw result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst)
      if (err(newCode)) throw newCode

      // Verify results - should tag the underlying segment
      expect(tags.length).toBe(1)
      expect(newCode).toContain('tag = $seg01')
      expect(tags[0]).toBeTruthy()
    }, 5_000)

    it('should tag a cap face by tagging the extrusion', async () => {
      const { ast, artifactGraph } = await executeCode(basicExampleCode)
      // Find a cap face artifact
      const capArtifact = [...artifactGraph.values()].find(
        (a) => a.type === 'cap'
      )
      expect(capArtifact).toBeDefined()

      const selection = createSelectionFromArtifacts(
        [capArtifact!],
        artifactGraph
      )
      const capFaceSelection = selection.graphSelections[0]

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        capFaceSelection,
        artifactGraph
      )
      if (err(result)) throw result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst)
      if (err(newCode)) throw newCode

      // Verify results - should tag the extrusion
      expect(tags.length).toBe(1)
      // Should tag either start or end cap depending on which one was found
      const hasTagStart = newCode.includes('tagStart = $capStart001')
      const hasTagEnd = newCode.includes('tagEnd = $capEnd001')
      expect(hasTagStart || hasTagEnd).toBe(true)
      expect(tags[0]).toBeTruthy()
    }, 5_000)

    it('should tag an edgeCut face by tagging the edgeCut expression', async () => {
      const { ast, artifactGraph } = await executeCode(boxWithOneTagAndChamfer)
      // Find an edgeCut face artifact (created by chamfer)
      const edgeCutArtifact = [...artifactGraph.values()].find(
        (a) => a.type === 'edgeCut'
      )
      expect(edgeCutArtifact).toBeDefined()

      const selection = createSelectionFromArtifacts(
        [edgeCutArtifact!],
        artifactGraph
      )
      const edgeCutFaceSelection = selection.graphSelections[0]

      // Apply tagging
      const result = modifyAstWithTagsForSelection(
        ast,
        edgeCutFaceSelection,
        artifactGraph
      )
      if (err(result)) throw result
      const { modifiedAst, tags } = result
      const newCode = recast(modifiedAst)
      if (err(newCode)) throw newCode

      // Verify results - should tag the chamfer operation (edgeCut expression)
      expect(tags.length).toBe(1)
      expect(newCode).toContain('tag = $seg02') // The NEW chamfer tag that was added
      expect(tags[0]).toBe('seg02') // The returned tag should be seg02
    }, 5_000)
  })

  describe('mutateAstWithTagForSketchSegment', () => {
    it('should successfully tag a chamfer edgeCut', async () => {
      const { ast, artifactGraph } = await executeCode(boxWithOneTagAndChamfer)

      // Find the chamfer edgeCut artifact
      const chamferArtifact = [...artifactGraph.values()].find(
        (a) => a.type === 'edgeCut' && a.subType === 'chamfer'
      )
      expect(chamferArtifact).toBeDefined()
      if (chamferArtifact?.type === 'edgeCut') {
        expect(chamferArtifact.subType).toBe('chamfer')
      }

      // Create selection and test through public interface
      const selection = createSelectionFromArtifacts(
        [chamferArtifact!],
        artifactGraph
      )
      const chamferFaceSelection = selection.graphSelections[0]

      const result = modifyAstWithTagsForSelection(
        ast,
        chamferFaceSelection,
        artifactGraph
      )
      if (err(result)) throw result
      const { modifiedAst, tags } = result
      const tag = tags[0]
      const newCode = recast(modifiedAst)
      if (err(newCode)) throw newCode

      // Verify chamfer tagging worked
      expect(tag).toBeTruthy()
      expect(newCode).toContain('tag = $seg02')
    }, 5_000)

    it('should successfully tag a fillet edgeCut', async () => {
      const { ast, artifactGraph } = await executeCode(boxWithOneTagAndFillet)

      // Find the fillet edgeCut artifact
      const filletArtifact = [...artifactGraph.values()].find(
        (a) => a.type === 'edgeCut' && a.subType === 'fillet'
      )
      expect(filletArtifact).toBeDefined()
      if (filletArtifact?.type === 'edgeCut') {
        expect(filletArtifact.subType).toBe('fillet')
      }

      // Create selection and test through public interface - should now succeed with our fix
      const selection = createSelectionFromArtifacts(
        [filletArtifact!],
        artifactGraph
      )
      const filletFaceSelection = selection.graphSelections[0]

      const result = modifyAstWithTagsForSelection(
        ast,
        filletFaceSelection,
        artifactGraph
      )

      // This should now succeed with our fix
      expect(err(result)).toBeFalsy()
      if (!err(result)) {
        const { modifiedAst, tags } = result
        const tag = tags[0]
        const newCode = recast(modifiedAst)
        if (!err(newCode)) {
          // Verify fillet tagging worked
          expect(tag).toBeTruthy()
          expect(newCode).toContain('tag = $seg02')
        }
      }
    }, 5_000)
  })
})

describe('sweeps.spec.ts', () => {
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

  describe('Testing addExtrude', () => {
    it('should add a basic extrude call', async () => {
      const { ast, artifactGraph, sketches } =
        await getAstAndSketchSelections(circleProfileCode)
      const length = await getKclCommandValue('1')
      const result = addExtrude({ ast, artifactGraph, sketches, length })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(`extrude001 = extrude(profile001, length = 1)`)
      await runNewAstAndCheckForSweep(result.modifiedAst)
    })

    it('should add a basic multi-profile extrude call', async () => {
      const { ast, artifactGraph, sketches } = await getAstAndSketchSelections(
        circleAndRectProfilesCode
      )
      const length = await getKclCommandValue('1')
      const result = addExtrude({ ast, artifactGraph, sketches, length })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude([profile001, profile002], length = 1)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst)
    })

    it('should add an extrude call with symmetric true', async () => {
      const { ast, artifactGraph, sketches } =
        await getAstAndSketchSelections(circleProfileCode)
      const length = await getKclCommandValue('1')
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches,
        length,
        symmetric: true,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude(profile001, length = 1, symmetric = true)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst)
    })

    it('should add an extrude call with bidirectional length and twist angle', async () => {
      const { ast, artifactGraph, sketches } =
        await getAstAndSketchSelections(circleProfileCode)
      const length = await getKclCommandValue('10')
      const bidirectionalLength = await getKclCommandValue('20')
      const twistAngle = await getKclCommandValue('30')
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches,
        length,
        bidirectionalLength,
        twistAngle,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(`extrude001 = extrude(
  profile001,
  length = 10,
  bidirectionalLength = 20,
  twistAngle = 30,
)`)
    })

    it('should edit an extrude call from symmetric true to false and new length', async () => {
      const extrudeCode = `${circleProfileCode}
extrude001 = extrude(profile001, length = 1, symmetric = true)`
      const { ast, artifactGraph, sketches } =
        await getAstAndSketchSelections(extrudeCode)
      const length = await getKclCommandValue('2')
      const symmetric = false
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches,
        length,
        symmetric,
        nodeToEdit,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(`${circleProfileCode}
extrude001 = extrude(profile001, length = 2)`)
      await runNewAstAndCheckForSweep(result.modifiedAst)
    })

    it('should add an extrude call with method NEW', async () => {
      const { ast, artifactGraph, sketches } =
        await getAstAndSketchSelections(circleProfileCode)
      const length = await getKclCommandValue('1')
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches,
        length,
        method: 'NEW',
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `extrude001 = extrude(profile001, length = 1, method = NEW)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst)
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
        1
      )
      const to = getFacesFromBox(artifactGraph, 1)
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches,
        to,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(
        `extrude002 = extrude(profile002, to = planeOf(extrude001, face = rectangleSegmentA001))`
      )
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
        1
      )
      const to = getFacesFromBox(artifactGraph, 1)
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches,
        to,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
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
extrude002 = extrude(profile002, to = planeOf(extrude001, face = seg01))`)
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
        1
      )
      const to = getCapFromCylinder(artifactGraph)
      const result = addExtrude({
        ast,
        artifactGraph,
        sketches,
        to,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(`${code}
extrude002 = extrude(profile002, to = planeOf(extrude001, face = END))`)
    })

    // TODO: this isn't producing the right results yet
    // https://github.com/KittyCAD/engine/issues/3855
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
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
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
extrude002 = extrude(profile002, to = planeOf(extrude001, face = seg02))`)
    })
  })

  describe('Testing addSweep', () => {
    const circleAndLineCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
sketch002 = startSketchOn(XZ)
profile002 = startProfile(sketch002, at = [0, 0])
  |> xLine(length = -5)
  |> tangentialArc(endAbsolute = [-20, 5])`

    async function getAstAndSketchesForSweep(code: string) {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
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
      return { ast, sketches, path }
    }

    it('should add a basic sweep call', async () => {
      const { ast, sketches, path } =
        await getAstAndSketchesForSweep(circleAndLineCode)
      const result = addSweep({ ast, sketches, path })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleAndLineCode)
      expect(newCode).toContain(
        `sweep001 = sweep(profile001, path = profile002)`
      )
    })

    it('should add a sweep call with sectional true and relativeTo setting', async () => {
      const { ast, sketches, path } =
        await getAstAndSketchesForSweep(circleAndLineCode)
      const sectional = true
      const relativeTo = 'sketchPlane'
      const result = addSweep({ ast, sketches, path, sectional, relativeTo })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleAndLineCode)
      expect(newCode).toContain(`sweep001 = sweep(
  profile001,
  path = profile002,
  sectional = true,
  relativeTo = 'sketchPlane',
)`)
    })

    it('should edit sweep call with sectional from true to false and relativeTo setting change', async () => {
      const circleAndLineCodeWithSweep = `${circleAndLineCode}
sweep001 = sweep(
  profile001,
  path = profile002,
  sectional = true,
  relativeTo = 'sketchPlane',
)`
      const { ast, sketches, path } = await getAstAndSketchesForSweep(
        circleAndLineCodeWithSweep
      )
      const sectional = false
      const relativeTo = 'trajectoryCurve'
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addSweep({
        ast,
        sketches,
        path,
        sectional,
        relativeTo,
        nodeToEdit,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleAndLineCode)
      expect(newCode).toContain(
        `sweep001 = sweep(profile001, path = profile002, relativeTo = 'trajectoryCurve')`
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
        circleAndLineAndRectProfilesCode
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
      const result = addSweep({ ast, sketches, path })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleAndLineAndRectProfilesCode)
      expect(newCode).toContain(
        `sweep001 = sweep([profile001, profile002], path = profile003)`
      )
    })

    // Note: helix sweep will be done in e2e since helix artifacts aren't created by the engineless executor
  })

  describe('Testing addLoft', () => {
    const twoCirclesCode = `sketch001 = startSketchOn(XZ)
profile001 = circle(sketch001, center = [0, 0], radius = 30)
plane001 = offsetPlane(XZ, offset = 50)
sketch002 = startSketchOn(plane001)
profile002 = circle(sketch002, center = [0, 0], radius = 20)
`
    it('should add a basic loft call', async () => {
      const { ast, sketches } = await getAstAndSketchSelections(twoCirclesCode)
      expect(sketches.graphSelections).toHaveLength(2)
      const result = addLoft({
        ast,
        sketches,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(twoCirclesCode)
      expect(newCode).toContain(`loft001 = loft([profile001, profile002]`)
      // Don't think we can find the artifact here for loft?
    })

    it('should edit a loft call with vDegree', async () => {
      const twoCirclesCodeWithLoft = `${twoCirclesCode}
loft001 = loft([profile001, profile002])`
      const { ast, sketches } = await getAstAndSketchSelections(
        twoCirclesCodeWithLoft
      )
      expect(sketches.graphSelections).toHaveLength(2)
      const vDegree = await getKclCommandValue('3')
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addLoft({
        ast,
        sketches,
        vDegree,
        nodeToEdit,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(twoCirclesCode)
      expect(newCode).toContain(
        `loft001 = loft([profile001, profile002], vDegree = 3)`
      )
      // Don't think we can find the artifact here for loft?
    })
  })

  describe('Testing addRevolve', () => {
    const circleCode = `sketch001 = startSketchOn(XZ)
profile001 = circle(sketch001, center = [3, 0], radius = 1)`

    it('should add basic revolve call', async () => {
      const { ast, sketches } = await getAstAndSketchSelections(circleCode)
      expect(sketches.graphSelections).toHaveLength(1)
      const angle = await getKclCommandValue('10')
      const axis = 'X'
      const result = addRevolve({ ast, sketches, angle, axis })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleCode)
      expect(newCode).toContain(
        `revolve001 = revolve(profile001, angle = 10, axis = X)`
      )
    })

    it('should add basic revolve call with symmetric true', async () => {
      const { ast, sketches } = await getAstAndSketchSelections(circleCode)
      expect(sketches.graphSelections).toHaveLength(1)
      const angle = await getKclCommandValue('10')
      const axis = 'X'
      const symmetric = true
      const result = addRevolve({
        ast,
        sketches,
        angle,
        axis,
        symmetric,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleCode)
      expect(newCode).toContain(`revolve001 = revolve(
  profile001,
  angle = 10,
  axis = X,
  symmetric = true,
)`)
    })

    it('should add a basic multi-profile revolve call', async () => {
      const { ast, sketches } = await getAstAndSketchSelections(
        circleAndRectProfilesCode
      )
      const angle = await getKclCommandValue('10')
      const axis = 'X'
      const result = addRevolve({
        ast,
        sketches,
        angle,
        axis,
      })
      if (err(result)) throw result
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleProfileCode)
      expect(newCode).toContain(
        `revolve001 = revolve([profile001, profile002], angle = 10, axis = X)`
      )
      await runNewAstAndCheckForSweep(result.modifiedAst)
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
      const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
      const artifacts = [...artifactGraph.values()]
      const circleArtifact = artifacts.findLast((a) => a.type === 'path')
      if (!circleArtifact) throw new Error('Circle artifact not found in graph')
      const sketches = createSelectionFromPathArtifact([circleArtifact])
      const edgeArtifact = artifacts.find((a) => a.type === 'segment')
      if (!edgeArtifact) throw new Error('Edge artifact not found in graph')
      const edge = createSelectionFromPathArtifact([edgeArtifact])
      const angle = await getKclCommandValue('20')
      const result = addRevolve({ ast, sketches, angle, edge })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
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
      const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
      const artifacts = [...artifactGraph.values()]
      const circleArtifact = artifacts.findLast((a) => a.type === 'path')
      if (!circleArtifact) throw new Error('Circle artifact not found in graph')
      const sketches = createSelectionFromPathArtifact([circleArtifact])
      const edgeArtifact = artifacts.findLast((a) => a.type === 'segment')
      if (!edgeArtifact) throw new Error('Edge artifact not found in graph')
      const edge = createSelectionFromPathArtifact([edgeArtifact])
      const angle = await getKclCommandValue('360')
      const result = addRevolve({ ast, sketches, angle, edge })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
      expect(
        newCode
      ).toContain(`sketch003 = startSketchOn(extrude001, face = START)
  |> circle(center = [-0.69, 0.56], radius = 0.28)
sketch002 = startSketchOn(XY)
  |> startProfile(at = [-2.02, 1.79])
  |> xLine(length = 2.6, tag = $seg01)
revolve001 = revolve(sketch002, angle = 360, axis = seg01)`)
    })

    it('should edit revolve call, changing axis and setting both lengths', async () => {
      const code = `${circleCode}
revolve001 = revolve(profile001, angle = 10, axis = X)`
      const { ast, sketches } = await ENGINELESS_getAstAndSketchSelections(code)
      expect(sketches.graphSelections).toHaveLength(1)
      const angle = await getKclCommandValue('20')
      const bidirectionalAngle = await getKclCommandValue('30')
      const axis = 'Y'
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addRevolve({
        ast,
        sketches,
        angle,
        bidirectionalAngle,
        axis,
        nodeToEdit,
      })
      if (err(result)) throw result
      await runNewAstAndCheckForSweep(result.modifiedAst)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(circleCode)
      expect(newCode).toContain(`revolve001 = revolve(
  profile001,
  angle = 20,
  axis = Y,
  bidirectionalAngle = 30,
)`)
    })
  })

  describe('Testing getAxisExpressionAndIndex', () => {
    it.each(['X', 'Y', 'Z'])(
      'should return axis expression for default axis %s',
      (axis) => {
        const ast = assertParse('')
        const result = getAxisExpressionAndIndex(axis, undefined, ast)
        if (err(result)) throw result
        expect(result.generatedAxis.type).toEqual('Name')
        expect((result.generatedAxis as Node<Name>).name.name).toEqual(axis)
      }
    )

    it('should return a generated axis pointing to the selected segment', async () => {
      const { ast, artifactGraph } =
        await getAstAndArtifactGraph(`sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 1)`)
      const edgeArtifact = [...artifactGraph.values()].find(
        (a) => a.type === 'segment'
      )
      const edge: Selections = createSelectionFromPathArtifact([edgeArtifact!])
      const result = getAxisExpressionAndIndex(undefined, edge, ast)
      if (err(result)) throw result
      expect(result.generatedAxis.type).toEqual('Name')
      expect((result.generatedAxis as Node<Name>).name.name).toEqual('seg01')
      expect(recast(ast)).toContain(`xLine(length = 1, tag = $seg01)`)
    })

    it('should error if nothing is provided', async () => {
      const result = getAxisExpressionAndIndex(
        undefined,
        undefined,
        assertParse('')
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
        const ast = assertParse(helixCode)
        const { artifactGraph, operations } = await enginelessExecutor(ast)
        const op = operations.find(
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
      const ast = assertParse(helixCode)
      const { artifactGraph, operations } = await enginelessExecutor(ast)
      const op = operations.find(
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
  })
})

describe('pattern3D.spec.ts', () => {
  async function getAstAndArtifactGraph(code: string) {
    const ast = assertParse(code)
    if (err(ast)) throw ast

    const { artifactGraph } = await enginelessExecutor(ast)
    return { ast, artifactGraph }
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

  async function getAstAndSolidSelections(code: string) {
    const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
    // Filter for sweep artifacts that represent 3D solids
    const artifacts = [...artifactGraph.values()].filter(
      (a) => a.type === 'sweep'
    )
    if (artifacts.length === 0) {
      throw new Error('Sweep artifact not found in the graph')
    }
    const selections = createSelectionFromPathArtifact(artifacts)
    return { ast, selections, artifactGraph }
  }

  async function getKclCommandValue(value: string) {
    const result = await stringToKclExpression(value)
    if (err(result) || 'errors' in result) {
      throw new Error('Failed to create KCL expression')
    }
    return result
  }

  describe('Testing addPatternCircular3D', () => {
    it('should add patternCircular3d with named axis', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('11'),
        axis: 'X',
        center: await getKclCommandValue('[10, -20, 0]'),
        arcDegrees: await getKclCommandValue('360'),
        rotateDuplicates: true,
        useOriginal: false,
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 11')
      expect(newCode).toContain('axis = X')
      expect(newCode).toContain('center = [10, -20, 0]')
      expect(newCode).toContain('arcDegrees = 360')
      expect(newCode).toContain('rotateDuplicates = true')
      expect(newCode).toContain('useOriginal = false')
    })

    it('should add patternCircular3d with array axis', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('11'),
        axis: await getKclCommandValue('[1, -1, 0]'),
        center: await getKclCommandValue('[10, -20, 0]'),
        arcDegrees: await getKclCommandValue('360'),
        rotateDuplicates: true,
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 11')
      expect(newCode).toContain('axis = [1, -1, 0]')
      expect(newCode).toContain('center = [10, -20, 0]')
      expect(newCode).toContain('arcDegrees = 360')
      expect(newCode).toContain('rotateDuplicates = true')
    })

    it('should add patternCircular3d with minimal required parameters', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('5'),
        axis: 'Z',
        center: await getKclCommandValue('[0, 0, 0]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 5')
      expect(newCode).toContain('axis = Z')
      expect(newCode).toContain('center = [0, 0, 0]')
      expect(newCode).not.toContain('arcDegrees')
      expect(newCode).not.toContain('rotateDuplicates')
      expect(newCode).not.toContain('useOriginal')
    })

    it('should handle all optional parameters', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('6'),
        axis: 'Y',
        center: await getKclCommandValue('[0, 0, 0]'),
        arcDegrees: await getKclCommandValue('180'),
        rotateDuplicates: true,
        useOriginal: false,
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 6')
      expect(newCode).toContain('axis = Y')
      expect(newCode).toContain('center = [0, 0, 0]')
      expect(newCode).toContain('arcDegrees = 180')
      expect(newCode).toContain('rotateDuplicates = true')
      expect(newCode).toContain('useOriginal = false')
    })

    it('should handle variable references for parameters', async () => {
      const code = `
myInstances = 8
myAxis = [0, 0, 1]
myCenter = [5, 5, 0]

exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('myInstances'),
        axis: await getKclCommandValue('myAxis'),
        center: await getKclCommandValue('myCenter'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = myInstances')
      expect(newCode).toContain('axis = myAxis')
      expect(newCode).toContain('center = myCenter')
    })

    it('should handle decimal values for all parameters', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('2.5'),
        axis: await getKclCommandValue('[1, -1, 0.5]'),
        center: await getKclCommandValue('[7.5, 3.2, 0]'),
        arcDegrees: await getKclCommandValue('180.5'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 2.5')
      expect(newCode).toContain('axis = [1, -1, 0.5]')
      expect(newCode).toContain('center = [7.5, 3.2, 0]')
      expect(newCode).toContain('arcDegrees = 180.5')
    })

    it('should handle mathematical expressions for parameters', async () => {
      const code = `
myCount = 10
mySpacing = 5
myOffset = 3
myAngle = 90

exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('myCount - myOffset'),
        axis: await getKclCommandValue('[mySpacing * 2, 0, 1]'),
        center: await getKclCommandValue('[mySpacing + myOffset, 0, 0]'),
        arcDegrees: await getKclCommandValue('myAngle * 2'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = myCount - myOffset')
      expect(newCode).toContain('axis = [mySpacing * 2, 0, 1]')
      expect(newCode).toContain('center = [mySpacing + myOffset, 0, 0]')
      expect(newCode).toContain('arcDegrees = myAngle * 2')
    })

    it('should prioritize array values over variable names when both exist', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      // Test the precedence by creating a mock axis that simulates the edge case
      const baseExpression = await getKclCommandValue('[1, 0, 0]')
      const mockAxisWithBothProperties = {
        ...baseExpression,
        variableName: 'someVariable', // This exists but should be ignored
        variableDeclarationAst: { type: 'VariableDeclaration' } as any,
        variableIdentifierAst: {
          type: 'Identifier',
          name: 'someVariable',
        } as any,
        insertIndex: 0,
        value: [1, 0, 0], // This should take precedence
      }

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('5'),
        axis: mockAxisWithBothProperties,
        center: await getKclCommandValue('[0, 0, 0]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 5')
      // Should use the array value, not the variable name
      expect(newCode).toContain('axis = [1, 0, 0]')
      expect(newCode).not.toContain('axis = someVariable')
      expect(newCode).toContain('center = [0, 0, 0]')
    })

    it('should create new pattern variable when selection is piped into named variable', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('6'),
        axis: 'Y',
        center: await getKclCommandValue('[0, 0, 0]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 6')
      expect(newCode).toContain('axis = Y')
      expect(newCode).toContain('center = [0, 0, 0]')
      // Should create new pattern variable referencing the named variable
      expect(newCode).toContain('exampleSketch = startSketchOn(XZ)')
      expect(newCode).toContain('|> extrude(length = 5)')
      expect(newCode).toContain('pattern001 = patternCircular3d(')
      expect(newCode).toContain('exampleSketch,') // References the original variable
    })

    it('should extend pipeline when selection is from unnamed pipeline', async () => {
      const code = `
sketch001 = startSketchOn(XZ)

startSketchOn(XY)
  |> circle(center = [1, 1], radius = 0.5)
  |> extrude(length = 3)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('8'),
        axis: 'Z',
        center: await getKclCommandValue('[2, 2, 0]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 8')
      expect(newCode).toContain('axis = Z')
      expect(newCode).toContain('center = [2, 2, 0]')
      // Should extend the unnamed pipeline
      expect(newCode).toContain('startSketchOn(XY)')
      expect(newCode).toContain('|> extrude(length = 3)')
      expect(newCode).toContain('|> patternCircular3d(')
    })

    it('should pipe pattern when selection is from unnamed standalone expression', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternCircular3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('4'),
        axis: await getKclCommandValue('[0, 1, 0]'),
        center: await getKclCommandValue('[5, 0, 0]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternCircular3d(')
      expect(newCode).toContain('instances = 4')
      expect(newCode).toContain('axis = [0, 1, 0]')
      expect(newCode).toContain('center = [5, 0, 0]')
      // Should pipe directly onto the unnamed expression
      expect(newCode).toContain('extrude(exampleSketch, length = -5)')
      expect(newCode).toContain('|> patternCircular3d(')
    })
  })

  describe('Testing addPatternLinear3D', () => {
    it('should add patternLinear3d with named axis', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('7'),
        distance: await getKclCommandValue('6'),
        axis: 'X',
        useOriginal: false,
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 7')
      expect(newCode).toContain('axis = X')
      expect(newCode).toContain('distance = 6')
      expect(newCode).toContain('useOriginal = false')
    })

    it('should add patternLinear3d with array axis', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('5'),
        distance: await getKclCommandValue('10'),
        axis: await getKclCommandValue('[1, 0, 1]'),
        useOriginal: true,
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 5')
      expect(newCode).toContain('axis = [1, 0, 1]')
      expect(newCode).toContain('distance = 10')
      expect(newCode).toContain('useOriginal = true')
    })

    it('should add patternLinear3d with minimal required parameters', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('3'),
        distance: await getKclCommandValue('4'),
        axis: 'Y',
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 3')
      expect(newCode).toContain('axis = Y')
      expect(newCode).toContain('distance = 4')
      expect(newCode).not.toContain('useOriginal')
    })

    it('should handle all optional parameters', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('6'),
        distance: await getKclCommandValue('8'),
        axis: 'Y',
        useOriginal: true,
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 6')
      expect(newCode).toContain('axis = Y')
      expect(newCode).toContain('distance = 8')
      expect(newCode).toContain('useOriginal = true')
    })

    it('should handle variable references for parameters', async () => {
      const code = `
myInstances = 8
myAxis = [0, 0, 1]
myDistance = 12

exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('myInstances'),
        distance: await getKclCommandValue('myDistance'),
        axis: await getKclCommandValue('myAxis'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = myInstances')
      expect(newCode).toContain('axis = myAxis')
      expect(newCode).toContain('distance = myDistance')
    })

    it('should handle decimal values for all parameters', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('2.5'),
        distance: await getKclCommandValue('7.5'),
        axis: await getKclCommandValue('[1, -1, 0.5]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 2.5')
      expect(newCode).toContain('axis = [1, -1, 0.5]')
      expect(newCode).toContain('distance = 7.5')
    })

    it('should handle mathematical expressions for parameters', async () => {
      const code = `
myCount = 10
mySpacing = 5
myOffset = 3

exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('myCount - myOffset'),
        distance: await getKclCommandValue('mySpacing + myOffset'),
        axis: await getKclCommandValue('[mySpacing * 2, 0, 1]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = myCount - myOffset')
      expect(newCode).toContain('axis = [mySpacing * 2, 0, 1]')
      expect(newCode).toContain('distance = mySpacing + myOffset')
    })

    it('should prioritize array values over variable names when both exist', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

example = extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      // Test the precedence by creating a mock axis that simulates the edge case
      const baseExpression = await getKclCommandValue('[1, 0, 0]')
      const mockAxisWithBothProperties = {
        ...baseExpression,
        variableName: 'someVariable', // This exists but should be ignored
        variableDeclarationAst: { type: 'VariableDeclaration' } as any,
        variableIdentifierAst: {
          type: 'Identifier',
          name: 'someVariable',
        } as any,
        insertIndex: 0,
        value: [1, 0, 0], // This should take precedence
      }

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('5'),
        distance: await getKclCommandValue('8'),
        axis: mockAxisWithBothProperties,
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 5')
      // Should use the array value, not the variable name
      expect(newCode).toContain('axis = [1, 0, 0]')
      expect(newCode).not.toContain('axis = someVariable')
      expect(newCode).toContain('distance = 8')
    })

    it('should create new pattern variable when selection is piped into named variable', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('6'),
        distance: await getKclCommandValue('3'),
        axis: 'Y',
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 6')
      expect(newCode).toContain('axis = Y')
      expect(newCode).toContain('distance = 3')
      // Should create new pattern variable referencing the named variable
      expect(newCode).toContain('exampleSketch = startSketchOn(XZ)')
      expect(newCode).toContain('|> extrude(length = 5)')
      expect(newCode).toContain('pattern001 = patternLinear3d(')
      expect(newCode).toContain('exampleSketch,') // References the original variable
    })

    it('should extend pipeline when selection is from unnamed pipeline', async () => {
      const code = `
sketch001 = startSketchOn(XZ)

startSketchOn(XY)
  |> circle(center = [1, 1], radius = 0.5)
  |> extrude(length = 3)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('4'),
        distance: await getKclCommandValue('2'),
        axis: 'Z',
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 4')
      expect(newCode).toContain('axis = Z')
      expect(newCode).toContain('distance = 2')
      // Should extend the unnamed pipeline
      expect(newCode).toContain('startSketchOn(XY)')
      expect(newCode).toContain('|> extrude(length = 3)')
      expect(newCode).toContain('|> patternLinear3d(')
    })

    it('should pipe pattern when selection is from unnamed standalone expression', async () => {
      const code = `
exampleSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

extrude(exampleSketch, length = -5)
`

      const { ast, selections, artifactGraph } =
        await getAstAndSolidSelections(code)

      const result = addPatternLinear3D({
        ast,
        artifactGraph,
        solids: selections,
        instances: await getKclCommandValue('3'),
        distance: await getKclCommandValue('5'),
        axis: await getKclCommandValue('[0, 1, 0]'),
      })

      if (err(result)) {
        throw result
      }

      const { modifiedAst } = result
      const newCode = recast(modifiedAst)

      expect(newCode).toContain('patternLinear3d(')
      expect(newCode).toContain('instances = 3')
      expect(newCode).toContain('axis = [0, 1, 0]')
      expect(newCode).toContain('distance = 5')
      // Should pipe directly onto the unnamed expression
      expect(newCode).toContain('extrude(exampleSketch, length = -5)')
      expect(newCode).toContain('|> patternLinear3d(')
    })
  })
})

describe('geometry.spec.ts', () => {
  describe('Testing addHelix', () => {
    it('should add a standalone call on default axis selection', async () => {
      const expectedNewLine = `helix001 = helix(
  axis = X,
  revolutions = 1,
  angleStart = 2,
  radius = 3,
  length = 4,
)`
      const { ast, artifactGraph } = await getAstAndArtifactGraph('')
      const result = addHelix({
        ast,
        artifactGraph,
        axis: 'X',
        revolutions: (await stringToKclExpression('1')) as KclCommandValue,
        angleStart: (await stringToKclExpression('2')) as KclCommandValue,
        radius: (await stringToKclExpression('3')) as KclCommandValue,
        length: (await stringToKclExpression('4')) as KclCommandValue,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast)
      const newCode = recast(result.modifiedAst)
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
      const { ast, artifactGraph } = await getAstAndArtifactGraph('')
      const result = addHelix({
        ast,
        artifactGraph,
        axis: 'X',
        revolutions: (await stringToKclExpression('1')) as KclCommandValue,
        angleStart: (await stringToKclExpression('2')) as KclCommandValue,
        radius: (await stringToKclExpression('3')) as KclCommandValue,
        length: (await stringToKclExpression('4')) as KclCommandValue,
        ccw: true,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast)
      const newCode = recast(result.modifiedAst)
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
      const { ast, artifactGraph } = await getAstAndArtifactGraph(code)
      const result = addHelix({
        ast,
        artifactGraph,
        axis: 'Y',
        revolutions: (await stringToKclExpression('11')) as KclCommandValue,
        angleStart: (await stringToKclExpression('12')) as KclCommandValue,
        radius: (await stringToKclExpression('13')) as KclCommandValue,
        length: (await stringToKclExpression('14')) as KclCommandValue,
        nodeToEdit: createPathToNodeForLastVariable(ast),
      })
      if (err(result)) throw result
      await enginelessExecutor(ast)
      const newCode = recast(result.modifiedAst)
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
      const { ast, artifactGraph } = await getAstAndArtifactGraph(segmentInPath)
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
        revolutions: (await stringToKclExpression('1')) as KclCommandValue,
        angleStart: (await stringToKclExpression('2')) as KclCommandValue,
        radius: (await stringToKclExpression('3')) as KclCommandValue,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toBe(helixFromSegmentInPath)
    })

    it('should edit a standalone call on segment selection', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        helixFromSegmentInPath
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
        revolutions: (await stringToKclExpression('4')) as KclCommandValue,
        angleStart: (await stringToKclExpression('5')) as KclCommandValue,
        radius: (await stringToKclExpression('6')) as KclCommandValue,
        ccw: true,
        nodeToEdit: createPathToNodeForLastVariable(ast),
      })
      if (err(result)) throw result
      await enginelessExecutor(ast)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(`helix001 = helix(
  axis = seg01,
  revolutions = 4,
  angleStart = 5,
  radius = 6,
  ccw = true,
)`)
    })

    // For now to avoid setting up an engine connection, the sweepEdge case is done in e2e (point-click.spec.ts)

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
      const { ast, artifactGraph } =
        await getAstAndArtifactGraph(cylinderExtrude)
      const sweep = [...artifactGraph.values()].find((n) => n.type === 'sweep')
      const cylinder: Selections = {
        graphSelections: [
          {
            artifact: sweep,
            codeRef: sweep!.codeRef,
          },
        ],
        otherSelections: [],
      }
      const result = addHelix({
        ast,
        artifactGraph,
        cylinder,
        revolutions: (await stringToKclExpression('1')) as KclCommandValue,
        angleStart: (await stringToKclExpression('2')) as KclCommandValue,
        ccw: true,
      })
      if (err(result)) throw result
      await enginelessExecutor(ast)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toBe(helixFromCylinder)
    })

    it('should edit a standalone call on cylinder selection', async () => {
      const { ast, artifactGraph } =
        await getAstAndArtifactGraph(helixFromCylinder)
      const sweep = [...artifactGraph.values()].find((n) => n.type === 'sweep')
      const cylinder: Selections = {
        graphSelections: [
          {
            artifact: sweep,
            codeRef: sweep!.codeRef,
          },
        ],
        otherSelections: [],
      }
      const result = addHelix({
        ast,
        artifactGraph,
        cylinder,
        revolutions: (await stringToKclExpression('11')) as KclCommandValue,
        angleStart: (await stringToKclExpression('22')) as KclCommandValue,
        ccw: false,
        nodeToEdit: createPathToNodeForLastVariable(ast),
      })
      if (err(result)) throw result
      await enginelessExecutor(ast)
      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(
        `helix001 = helix(cylinder = extrude001, revolutions = 11, angleStart = 22`
      )
    })
  })
})

describe('gdt.spec.ts', () => {
  const boxWithOneTagAndChamfer = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
  |> chamfer(
       length = 1,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
     )`

  async function getAstAndArtifactGraph(code: string) {
    const ast = assertParse(code)
    await kclManager.executeAst({ ast })
    const {
      artifactGraph,
      execState: { operations },
      variables,
    } = kclManager
    await new Promise((resolve) => setTimeout(resolve, 100))
    return { ast, artifactGraph, operations, variables }
  }

  function createSelectionFromArtifacts(
    artifacts: Artifact[],
    artifactGraph: ArtifactGraph
  ): Selections {
    const graphSelections = artifacts.flatMap((artifact) => {
      const codeRefs = getCodeRefsByArtifactId(artifact.id, artifactGraph)
      if (!codeRefs || codeRefs.length === 0) {
        return []
      }

      return {
        codeRef: codeRefs[0],
        artifact,
      } as Selection
    })
    return {
      graphSelections,
      otherSelections: [],
    }
  }

  function getCapFromCylinder(artifactGraph: ArtifactGraph) {
    const endFace = [...artifactGraph.values()].find(
      (a) => a.type === 'cap' && a.subType === 'end'
    )
    return createSelectionFromArtifacts([endFace!], artifactGraph)
  }

  function getWallsFromBox(artifactGraph: ArtifactGraph, count: number) {
    const walls = [...artifactGraph.values()]
      .filter((a) => a.type === 'wall')
      .slice(0, count)
    return createSelectionFromArtifacts(walls, artifactGraph)
  }

  function getEndCapsFromMultipleBodies(artifactGraph: ArtifactGraph) {
    const endCaps = [...artifactGraph.values()].filter(
      (a) => a.type === 'cap' && a.subType === 'end'
    )
    return createSelectionFromArtifacts(endCaps, artifactGraph)
  }

  const cylinder = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 10)
extrude001 = extrude(profile001, length = 10)`

  const box = `sketch002 = startSketchOn(XY)
profile002 = startProfile(sketch002, at = [0, 0])
  |> xLine(length = 10)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(profile002, length = 10)`

  const twoBodies = `sketch003 = startSketchOn(XY)
profile003 = circle(sketch003, center = [0, 0], radius = 5)
extrude003 = extrude(profile003, length = 8)

sketch004 = startSketchOn(XY)
profile004 = circle(sketch004, center = [15, 0], radius = 5)
extrude004 = extrude(profile004, length = 8)`

  // Test data: Creates a box with a fillet on one edge for GDT testing
  const boxWithOneTagAndFillet = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
  |> fillet(
        radius = 1,
        tags = [
          getCommonEdge(faces = [seg01, capEnd001])
        ],
      )`

  describe('Testing addFlatnessGdt', () => {
    it('should add a basic flatness annotation to a single face (cap)', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(cylinder)
      const faces = getCapFromCylinder(artifactGraph)
      const tolerance = await getKclCommandValue('0.1mm')
      const result = addFlatnessGdt({ ast, artifactGraph, faces, tolerance })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst)
      if (err(newCode)) throw newCode

      // Verify the extrude was tagged
      expect(newCode).toContain('tagEnd = $capEnd001')
      // Verify the GDT annotation was added
      expect(newCode).toContain(
        'gdt::flatness(faces = [capEnd001], tolerance = 0.1mm)'
      )
    })

    it('should add flatness annotations to multiple faces', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(box)
      const faces = getWallsFromBox(artifactGraph, 3)

      const tolerance = await getKclCommandValue('0.1mm')
      const result = addFlatnessGdt({ ast, artifactGraph, faces, tolerance })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst)
      if (err(newCode)) throw newCode

      // Verify all three segments were tagged
      expect(newCode).toContain('tag = $seg01')
      expect(newCode).toContain('tag = $seg02')
      expect(newCode).toContain('tag = $seg03')
      // Should create three separate GDT annotations (one per face)
      const gdtCalls = newCode.match(/gdt::flatness/g)
      expect(gdtCalls).toHaveLength(3)
      // Verify each face has its own annotation
      expect(newCode).toContain('faces = [seg01], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [seg02], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [seg03], tolerance = 0.1mm')
    })

    it('should add flatness annotations to different bodies', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(twoBodies)
      const faces = getEndCapsFromMultipleBodies(artifactGraph)

      const tolerance = await getKclCommandValue('0.1mm')
      const result = addFlatnessGdt({ ast, artifactGraph, faces, tolerance })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst)
      if (err(newCode)) throw newCode

      // Verify both extrudes were tagged
      expect(newCode).toContain('tagEnd = $capEnd001')
      expect(newCode).toContain('tagEnd = $capEnd002')
      // Should create two separate GDT annotations (one per body)
      const gdtCalls = newCode.match(/gdt::flatness/g)
      expect(gdtCalls).toHaveLength(2)
      // Verify each face has its own annotation
      expect(newCode).toContain('faces = [capEnd001], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [capEnd002], tolerance = 0.1mm')
    })

    it('should not create duplicate annotations when same face is selected multiple times', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(box)
      const walls = getWallsFromBox(artifactGraph, 3)

      // Manually duplicate one face in the selection
      const duplicatedSelection: Selections = {
        graphSelections: [
          ...walls.graphSelections,
          walls.graphSelections[0], // Add first wall again
        ],
        otherSelections: [],
      }

      const tolerance = await getKclCommandValue('0.1mm')
      const result = addFlatnessGdt({
        ast,
        artifactGraph,
        faces: duplicatedSelection,
        tolerance,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst)
      if (err(newCode)) throw newCode

      // Should still only have 3 GDT calls (deduplication within selection works)
      const tagMatches = newCode.match(/tag = \$seg\d+/g)
      expect(tagMatches).toHaveLength(3)
      const gdtCalls = newCode.match(/gdt::flatness/g)
      expect(gdtCalls).toHaveLength(3)
      expect(newCode).toContain('faces = [seg01], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [seg02], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [seg03], tolerance = 0.1mm')
    })

    it('should allow adding another annotation to the same face', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(cylinder)
      const faces = getCapFromCylinder(artifactGraph)

      // Add first annotation
      const tolerance1 = await getKclCommandValue('0.1mm')
      const result1 = addFlatnessGdt({
        ast,
        artifactGraph,
        faces,
        tolerance: tolerance1,
      })
      if (err(result1)) throw result1

      // Add second annotation to the same face
      const tolerance2 = await getKclCommandValue('0.2mm')
      const result2 = addFlatnessGdt({
        ast: result1.modifiedAst,
        artifactGraph,
        faces,
        tolerance: tolerance2,
      })
      if (err(result2)) throw result2

      const newCode = recast(result2.modifiedAst)
      if (err(newCode)) throw newCode

      // Verify tag appears only once
      expect(newCode.match(/tagEnd/g)).toHaveLength(1)
      // Should have TWO GDT calls
      const gdtCalls = newCode.match(/gdt::flatness/g)
      expect(gdtCalls).toHaveLength(2)
      expect(newCode).toContain('faces = [capEnd001], tolerance = 0.1mm')
      expect(newCode).toContain('faces = [capEnd001], tolerance = 0.2mm')
    })

    it('should add flatness annotation with all optional parameters', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(cylinder)
      const faces = getCapFromCylinder(artifactGraph)

      // Create all parameter values
      const tolerance = await getKclCommandValue('0.1mm')
      const precision = await getKclCommandValue('3')
      const framePosition = await getKclCommandValue('[10, 20]')
      const framePlane = 'XY'
      const fontPointSize = await getKclCommandValue('36')
      const fontScale = await getKclCommandValue('1.5')

      const result = addFlatnessGdt({
        ast,
        artifactGraph,
        faces,
        tolerance,
        precision,
        framePosition,
        framePlane,
        fontPointSize,
        fontScale,
      })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst)
      if (err(newCode)) throw newCode

      // Verify the extrude was tagged
      expect(newCode).toContain('tagEnd = $capEnd001')
      // Verify all parameters are in the GDT call
      expect(newCode).toContain('faces = [capEnd001]')
      expect(newCode).toContain('tolerance = 0.1mm')
      expect(newCode).toContain('precision = 3')
      expect(newCode).toContain('framePosition = [10, 20]')
      expect(newCode).toContain('framePlane = XY')
      expect(newCode).toContain('fontPointSize = 36')
      expect(newCode).toContain('fontScale = 1.5')
    })

    it('should place GDT annotations at the end of the file', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(twoBodies)
      const faces = getEndCapsFromMultipleBodies(artifactGraph)

      const tolerance = await getKclCommandValue('0.1mm')
      const result = addFlatnessGdt({ ast, artifactGraph, faces, tolerance })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst)
      if (err(newCode)) throw newCode

      // Verify GDT calls come after all model code
      const lastExtrudeIndex = newCode.lastIndexOf('extrude')
      const firstGdtIndex = newCode.indexOf('gdt::flatness')
      expect(firstGdtIndex).toBeGreaterThan(lastExtrudeIndex)
    })

    it('should add a flatness annotation to an edgeCut (chamfer) face', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(
        boxWithOneTagAndChamfer
      )

      // Find the edgeCut artifact created by the chamfer operation
      const edgeCutArtifact = [...artifactGraph.values()].find(
        (a) => a.type === 'edgeCut'
      )
      expect(edgeCutArtifact).toBeDefined()

      // Create selection for the edgeCut face
      const faces = createSelectionFromArtifacts(
        [edgeCutArtifact!],
        artifactGraph
      )

      const tolerance = await getKclCommandValue('0.1mm')
      const result = addFlatnessGdt({ ast, artifactGraph, faces, tolerance })
      if (err(result)) throw result

      const newCode = recast(result.modifiedAst)
      if (err(newCode)) throw newCode

      // Verify the original segment tag is preserved and chamfer gets new tag
      expect(newCode).toContain('tag = $seg01')
      expect(newCode).toContain('tag = $seg02')
      // Verify the GDT annotation references the chamfer tag
      expect(newCode).toContain(
        'gdt::flatness(faces = [seg02], tolerance = 0.1mm)'
      )
      // Verify the original chamfer operation is still there
      expect(newCode).toContain('chamfer(')
      expect(newCode).toContain('getCommonEdge(faces = [seg01, capEnd001])')
    })

    it('should successfully add a fillet GDT annotation (tests end-to-end integration)', async () => {
      const { ast, artifactGraph } = await executeCode(boxWithOneTagAndFillet)

      // Find the fillet edgeCut artifact
      const filletArtifact = [...artifactGraph.values()].find(
        (a) => a.type === 'edgeCut' && a.subType === 'fillet'
      )
      expect(filletArtifact).toBeDefined()
      if (!filletArtifact) {
        throw new Error('Expected fillet artifact not found')
      }

      // Create selections for GDT
      const faces = createSelectionFromArtifacts(
        [filletArtifact],
        artifactGraph
      )

      // Test the full GDT workflow
      const { addFlatnessGdt } = await import('@src/lang/modifyAst/gdt')
      const tolerance = await getKclCommandValue('0.1mm')

      const result = addFlatnessGdt({
        ast,
        artifactGraph,
        faces,
        tolerance,
      })

      if (err(result)) throw result
      const { modifiedAst } = result
      const newCode = recast(modifiedAst)
      if (err(newCode)) throw newCode

      // Verify GDT annotation was added for fillet
      expect(newCode).toContain('gdt::flatness(')
      expect(newCode).toContain('faces = [seg02]') // The tagged fillet face
      expect(newCode).toContain('tolerance = 0.1mm')

      // Verify the fillet was tagged properly
      expect(newCode).toContain('tag = $seg02')
    })
  })
})

describe('faces.spec.ts', () => {
  async function getAstAndArtifactGraph(code: string) {
    const ast = assertParse(code)
    await kclManager.executeAst({ ast })
    const {
      artifactGraph,
      execState: { operations },
      variables,
    } = kclManager
    await new Promise((resolve) => setTimeout(resolve, 100))
    return { ast, artifactGraph, operations, variables }
  }

  function createSelectionFromArtifacts(
    artifacts: Artifact[],
    artifactGraph: ArtifactGraph
  ): Selections {
    const graphSelections = artifacts.flatMap((artifact) => {
      const codeRefs = getCodeRefsByArtifactId(artifact.id, artifactGraph)
      if (!codeRefs || codeRefs.length === 0) {
        return []
      }

      return {
        codeRef: codeRefs[0],
        artifact,
      } as Selection
    })
    return {
      graphSelections,
      otherSelections: [],
    }
  }

  // More complex shell case
  const multiSolids = `size = 100
case = startSketchOn(XY)
  |> startProfile(at = [-size, -size])
  |> line(end = [2 * size, 0])
  |> line(end = [0, 2 * size])
  |> tangentialArc(endAbsolute = [-size, size])
  |> close()
  |> extrude(length = 65)

thing1 = startSketchOn(case, face = END)
  |> circle(center = [-size / 2, -size / 2], radius = 25)
  |> extrude(length = 50)

thing2 = startSketchOn(case, face = END)
  |> circle(center = [size / 2, -size / 2], radius = 25)
  |> extrude(length = 50)`

  const multiSolidsShell = `${multiSolids}
shell001 = shell([thing1, thing2], faces = [END, END], thickness = 5)`

  const cylinder = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 10)
extrude001 = extrude(profile001, length = 10)`

  const box = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10)`

  const boxWithOneTag = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10)`

  const boxWithOneTagAndChamfer = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
  |> chamfer(
       length = 1,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
     )`

  const boxWithOneTagAndChamferAndPlane = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
  |> chamfer(
       length = 1,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
       tag = $seg02,
     )
plane001 = offsetPlane(planeOf(extrude001, face = seg02), offset = 1)`

  const boxWithTwoTags = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10, tag = $seg02)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10)`

  const boxWithTwoTagsAndChamfer = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 10, tag = $seg01)
  |> yLine(length = 10, tag = $seg02)
  |> xLine(length = -10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
  |> chamfer(
       length = 1,
       tags = [
         getCommonEdge(faces = [seg01, seg02])
       ],
     )`

  describe('Testing addShell', () => {
    it('should add a basic shell call on cylinder end cap', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(cylinder)
      const faces = getCapFromCylinder(artifactGraph)
      const thickness = (await stringToKclExpression('1')) as KclCommandValue
      const result = addShell({ ast, artifactGraph, faces, thickness })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(cylinder)
      expect(newCode).toContain(
        `shell001 = shell(extrude001, faces = END, thickness = 1)`
      )
      await enginelessExecutor(ast)
    })

    it('should add a shell call on variable-less extrude', async () => {
      // Note: this was code from https://github.com/KittyCAD/modeling-app/issues/7640
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 2358.24])
  |> line(end = [1197.84, -393.04])
  |> line(end = [804.79, -1300.78])
  |> line(end = [505.34, -2498.61])
  |> line(end = [-973.24, -1244.62])
  |> line(endAbsolute = [0, -3434.42])
p = mirror2d([profile001], axis = Y)
extrude(p, length = 1000)`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(code)
      const faces = getCapFromCylinder(artifactGraph)
      const thickness = (await stringToKclExpression('1')) as KclCommandValue
      const result = addShell({ ast, artifactGraph, faces, thickness })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(`${code}
  |> shell(faces = END, thickness = 1)`)
      await enginelessExecutor(ast)
    })

    it('should edit a basic shell call on cylinder end cap with new thickness', async () => {
      const code = `${cylinder}
shell001 = shell(extrude001, faces = END, thickness = 1)
`
      const { artifactGraph, ast } = await getAstAndArtifactGraph(code)
      const faces = getCapFromCylinder(artifactGraph)
      const thickness = (await stringToKclExpression('2')) as KclCommandValue
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addShell({
        ast,
        artifactGraph,
        faces,
        thickness,
        nodeToEdit,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(cylinder)
      expect(newCode).toContain(
        `shell001 = shell(extrude001, faces = END, thickness = 2)`
      )
      await enginelessExecutor(ast)
    })

    it('should add a shell call on box for 2 walls', async () => {
      const { artifactGraph, ast } = await getAstAndArtifactGraph(box)
      const faces = getFacesFromBox(artifactGraph, 2)
      const thickness = (await stringToKclExpression('1')) as KclCommandValue
      const result = addShell({ ast, artifactGraph, faces, thickness })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(`${boxWithTwoTags}
shell001 = shell(extrude001, faces = [seg01, seg02], thickness = 1)`)
      await enginelessExecutor(ast)
    })

    it('should edit a shell call on box for 2 walls to a new thickness', async () => {
      const { artifactGraph, ast } =
        await getAstAndArtifactGraph(`${boxWithTwoTags}
shell001 = shell(extrude001, faces = [seg01, seg02], thickness = 1)`)
      const faces = getFacesFromBox(artifactGraph, 2)
      const thickness = (await stringToKclExpression('2')) as KclCommandValue
      const nodeToEdit = createPathToNodeForLastVariable(ast)
      const result = addShell({
        ast,
        artifactGraph,
        faces,
        thickness,
        nodeToEdit,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(`${boxWithTwoTags}
shell001 = shell(extrude001, faces = [seg01, seg02], thickness = 2)`)
      await enginelessExecutor(ast)
    })

    it('should add a shell on two related sweeps end faces', async () => {
      // Code from https://github.com/KittyCAD/modeling-app/blob/21f11c369e1e4bcb6d2514d1150ba5e13138fe32/docs/kcl-std/functions/std-solid-shell.md#L154-L155
      const { ast, artifactGraph } = await getAstAndArtifactGraph(multiSolids)
      const twoCaps = [...artifactGraph.values()]
        .filter((a) => a.type === 'cap' && a.subType === 'end')
        .slice(0, 2)
        .reverse()
      const faces = createSelectionFromArtifacts(twoCaps, artifactGraph)
      const thickness = (await stringToKclExpression('5')) as KclCommandValue
      const result = addShell({ ast, artifactGraph, faces, thickness })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(multiSolidsShell)
      await enginelessExecutor(ast)
    })
  })

  describe('Testing retrieveFaceSelectionsFromOpArgs', () => {
    it('should find the solid and face of basic shell on cylinder cap', async () => {
      const circleProfileInVar = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
shell001 = shell(extrude001, faces = END, thickness = 0.1)
`
      const { artifactGraph, operations } =
        await getAstAndArtifactGraph(circleProfileInVar)
      const op = operations.find(
        (o) => o.type === 'StdLibCall' && o.name === 'shell'
      )
      if (
        !op ||
        op.type !== 'StdLibCall' ||
        !op.unlabeledArg ||
        !op.labeledArgs?.faces
      ) {
        throw new Error('Extrude operation not found')
      }

      const selections = retrieveFaceSelectionsFromOpArgs(
        op.unlabeledArg,
        op.labeledArgs.faces,
        artifactGraph
      )
      if (err(selections)) throw selections

      expect(selections.solids.graphSelections).toHaveLength(1)
      const solid = selections.solids.graphSelections[0]
      if (!solid.artifact) {
        throw new Error('Artifact not found in the selection')
      }
      expect(solid.artifact.type).toEqual('sweep')

      expect(selections.faces.graphSelections).toHaveLength(1)
      const face = selections.faces.graphSelections[0]
      if (!face.artifact || face.artifact.type !== 'cap') {
        throw new Error('Artifact not found in the selection')
      }
      expect(face.artifact.subType).toEqual('end')
      expect(face.artifact.sweepId).toEqual(solid.artifact.id)
    })

    it('should find the sweeps and faces of complex shell', async () => {
      const { artifactGraph, operations } =
        await getAstAndArtifactGraph(multiSolidsShell)
      const lastTwoSweeps = [...artifactGraph.values()]
        .filter((a) => a.type === 'sweep')
        .slice(-2)
      const op = operations.find(
        (o) => o.type === 'StdLibCall' && o.name === 'shell'
      )
      if (
        !op ||
        op.type !== 'StdLibCall' ||
        !op.unlabeledArg ||
        !op.labeledArgs?.faces
      ) {
        throw new Error('Extrude operation not found')
      }

      const selections = retrieveFaceSelectionsFromOpArgs(
        op.unlabeledArg,
        op.labeledArgs.faces,
        artifactGraph
      )
      if (err(selections)) throw selections

      expect(selections.solids.graphSelections).toHaveLength(2)
      expect(selections.solids.graphSelections[0].artifact!.id).toEqual(
        lastTwoSweeps[0].id
      )
      expect(selections.solids.graphSelections[1].artifact!.id).toEqual(
        lastTwoSweeps[1].id
      )
      expect(selections.faces.graphSelections).toHaveLength(2)
      expect(selections.faces.graphSelections[0].artifact!.type).toEqual('cap')
      expect(selections.faces.graphSelections[1].artifact!.type).toEqual('cap')
    })
  })

  describe('Testing retrieveNonDefaultPlaneSelectionFromOpArg', () => {
    it('should find an offset plane on an offset plane', async () => {
      const code = `plane001 = offsetPlane(XY, offset = 1)
plane002 = offsetPlane(plane001, offset = 2)`
      const { artifactGraph, operations } = await getAstAndArtifactGraph(code)
      const op = operations.findLast(
        (o) => o.type === 'StdLibCall' && o.name === 'offsetPlane'
      ) as StdLibCallOp
      const selections = retrieveNonDefaultPlaneSelectionFromOpArg(
        op.unlabeledArg!,
        artifactGraph
      )
      if (err(selections)) throw selections
      expect(selections.graphSelections).toHaveLength(1)
      expect(selections.graphSelections[0].artifact!.type).toEqual('plane')
      expect(
        (selections.graphSelections[0].artifact as PlaneArtifact).codeRef
          .pathToNode[1][0]
      ).toEqual(0)
    })

    it('should find an offset plane on a sweep face', async () => {
      const code = `${cylinder}
plane001 = offsetPlane(planeOf(extrude001, face = END), offset = 1)`
      const { artifactGraph, operations } = await getAstAndArtifactGraph(code)
      const op = operations.find(
        (o) => o.type === 'StdLibCall' && o.name === 'offsetPlane'
      ) as StdLibCallOp
      const selections = retrieveNonDefaultPlaneSelectionFromOpArg(
        op.unlabeledArg!,
        artifactGraph
      )
      if (err(selections)) throw selections

      expect(selections.graphSelections).toHaveLength(1)
      expect(selections.graphSelections[0].artifact!.type).toEqual('cap')
      const cap = [...artifactGraph.values()].find(
        (a) => a.type === 'cap' && a.subType === 'end'
      )
      expect(selections.graphSelections[0].artifact!.id).toEqual(cap!.id)
    })

    it('should find an offset plane on a chamfer face', async () => {
      const { artifactGraph, operations } = await getAstAndArtifactGraph(
        boxWithOneTagAndChamferAndPlane
      )
      const op = operations.find(
        (o) => o.type === 'StdLibCall' && o.name === 'offsetPlane'
      ) as StdLibCallOp
      const selections = retrieveNonDefaultPlaneSelectionFromOpArg(
        op.unlabeledArg!,
        artifactGraph
      )
      if (err(selections)) throw selections

      expect(selections.graphSelections).toHaveLength(1)
      expect(selections.graphSelections[0].artifact!.type).toEqual('edgeCut')
    })
  })

  describe('Testing addOffsetPlane', () => {
    it.each<DefaultPlaneStr>(['XY', 'XZ', 'YZ'])(
      'should add a basic offset plane call on default plane %s and then edit it',
      async (name) => {
        const { artifactGraph, ast, variables } =
          await getAstAndArtifactGraph('')
        const offset = (await stringToKclExpression('1')) as KclCommandValue
        const id = rustContext.getDefaultPlaneId(name)
        if (err(id)) {
          throw id
        }
        const plane: Selections = {
          graphSelections: [],
          otherSelections: [{ name, id }],
        }
        const result = addOffsetPlane({
          ast,
          artifactGraph,
          variables,
          plane,
          offset,
        })
        if (err(result)) {
          throw result
        }

        const newCode = recast(result.modifiedAst)
        expect(newCode).toContain(`plane001 = offsetPlane(${name}, offset = 1)`)
        await enginelessExecutor(ast)

        const newOffset = (await stringToKclExpression('2')) as KclCommandValue
        const nodeToEdit = createPathToNodeForLastVariable(result.modifiedAst)
        const result2 = addOffsetPlane({
          ast: result.modifiedAst,
          artifactGraph,
          variables,
          plane,
          offset: newOffset,
          nodeToEdit,
        })
        if (err(result2)) {
          throw result2
        }
        const newCode2 = recast(result2.modifiedAst)
        expect(newCode2).not.toContain(`offset = 1`)
        expect(newCode2).toContain(
          `plane001 = offsetPlane(${name}, offset = 2)`
        )
        await enginelessExecutor(result2.modifiedAst)
      }
    )

    it('should add an offset plane call on offset plane and then edit it', async () => {
      const code = `plane001 = offsetPlane(XY, offset = 1)`
      const { artifactGraph, ast, variables } =
        await getAstAndArtifactGraph(code)
      const offset = (await stringToKclExpression('2')) as KclCommandValue
      const artifact = [...artifactGraph.values()].find(
        (a) => a.type === 'plane'
      )
      const plane: Selections = {
        graphSelections: [
          {
            artifact,
            codeRef: artifact!.codeRef,
          },
        ],
        otherSelections: [],
      }
      const result = addOffsetPlane({
        ast,
        artifactGraph,
        variables,
        plane,
        offset,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(`${code}
plane002 = offsetPlane(plane001, offset = 2)`)
      await enginelessExecutor(ast)

      const newOffset = (await stringToKclExpression('3')) as KclCommandValue
      const nodeToEdit = createPathToNodeForLastVariable(result.modifiedAst)
      const result2 = addOffsetPlane({
        ast: result.modifiedAst,
        artifactGraph,
        variables,
        plane,
        offset: newOffset,
        nodeToEdit,
      })
      if (err(result2)) {
        throw result2
      }
      const newCode2 = recast(result2.modifiedAst)
      expect(newCode2).not.toContain(`offset = 2`)
      expect(newCode2).toContain(`${code}
plane002 = offsetPlane(plane001, offset = 3)`)
      await enginelessExecutor(result2.modifiedAst)
    })

    it('should add an offset plane call on cylinder end cap and allow edits', async () => {
      const { artifactGraph, ast, variables } =
        await getAstAndArtifactGraph(cylinder)
      const plane = getCapFromCylinder(artifactGraph)
      const offset = (await stringToKclExpression('2')) as KclCommandValue
      const result = addOffsetPlane({
        ast,
        artifactGraph,
        variables,
        plane,
        offset,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(`${cylinder}
plane001 = offsetPlane(planeOf(extrude001, face = END), offset = 2)`)
      await enginelessExecutor(ast)

      const newOffset = (await stringToKclExpression('3')) as KclCommandValue
      const nodeToEdit = createPathToNodeForLastVariable(result.modifiedAst)
      const result2 = addOffsetPlane({
        ast: result.modifiedAst,
        artifactGraph,
        variables,
        plane,
        offset: newOffset,
        nodeToEdit,
      })
      if (err(result2)) {
        throw result2
      }
      const newCode2 = recast(result2.modifiedAst)
      expect(newCode2).not.toContain(`offset = 2`)
      expect(newCode2).toContain(`${cylinder}
plane001 = offsetPlane(planeOf(extrude001, face = END), offset = 3)`)
      await enginelessExecutor(result2.modifiedAst)
    })

    it('should add an offset plane call on box wall and allow edits', async () => {
      const { artifactGraph, ast, variables } =
        await getAstAndArtifactGraph(box)
      const plane = getFacesFromBox(artifactGraph, 1)
      const offset = (await stringToKclExpression('10')) as KclCommandValue
      const result = addOffsetPlane({
        ast,
        artifactGraph,
        variables,
        plane,
        offset,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(`${boxWithOneTag}
plane001 = offsetPlane(planeOf(extrude001, face = seg01), offset = 10)`)
      await enginelessExecutor(ast)

      const newOffset = (await stringToKclExpression('20')) as KclCommandValue
      const nodeToEdit = createPathToNodeForLastVariable(result.modifiedAst)
      const result2 = addOffsetPlane({
        ast: result.modifiedAst,
        artifactGraph,
        variables,
        plane,
        offset: newOffset,
        nodeToEdit,
      })
      if (err(result2)) {
        throw result2
      }
      const newCode2 = recast(result2.modifiedAst)
      expect(newCode2).not.toContain(`offset = 10`)
      expect(newCode2).toContain(`${boxWithOneTag}
plane001 = offsetPlane(planeOf(extrude001, face = seg01), offset = 20)`)
      await enginelessExecutor(result2.modifiedAst)
    })

    it('should add an offset plane call on chamfer face and allow edits', async () => {
      const { artifactGraph, ast, variables } = await getAstAndArtifactGraph(
        boxWithOneTagAndChamfer
      )
      const chamfer = [...artifactGraph.values()].find(
        (a) => a.type === 'edgeCut'
      )
      const plane = createSelectionFromArtifacts([chamfer!], artifactGraph)
      const offset = (await stringToKclExpression('1')) as KclCommandValue
      const result = addOffsetPlane({
        ast,
        artifactGraph,
        variables,
        plane,
        offset,
      })
      if (err(result)) {
        throw result
      }

      const newCode = recast(result.modifiedAst)
      expect(newCode).toContain(boxWithOneTagAndChamferAndPlane)
      await enginelessExecutor(ast)

      const newOffset = (await stringToKclExpression('2')) as KclCommandValue
      const nodeToEdit = createPathToNodeForLastVariable(result.modifiedAst)
      const result2 = addOffsetPlane({
        ast: result.modifiedAst,
        artifactGraph,
        variables,
        plane,
        offset: newOffset,
        nodeToEdit,
      })
      if (err(result2)) {
        throw result2
      }
      const newCode2 = recast(result2.modifiedAst)
      expect(newCode2).not.toContain(`offset = 1`)
      expect(newCode2).toContain(
        `plane001 = offsetPlane(planeOf(extrude001, face = seg02), offset = 2)`
      )
      await enginelessExecutor(result2.modifiedAst)
    })
  })

  describe('Testing getEdgeCutMeta', () => {
    it('should find the edge cut meta info on a wall-cap chamfer', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        boxWithOneTagAndChamfer
      )
      const artifact = [...artifactGraph.values()].find(
        (a) => a.type === 'edgeCut'
      )
      const result = getEdgeCutMeta(artifact!, ast, artifactGraph)
      expect(result?.type).toEqual('edgeCut')
      expect(result?.subType).toEqual('opposite')
      expect(result?.tagName).toEqual('seg01')
    })

    it('should find the edge cut meta info on a wall-wall chamfer', async () => {
      const { ast, artifactGraph } = await getAstAndArtifactGraph(
        boxWithTwoTagsAndChamfer
      )
      const artifact = [...artifactGraph.values()].find(
        (a) => a.type === 'edgeCut'
      )
      const result = getEdgeCutMeta(artifact!, ast, artifactGraph)
      expect(result?.type).toEqual('edgeCut')
      expect(result?.subType).toEqual('adjacent')
      expect(result?.tagName).toEqual('seg01')
    })
  })
})

describe('addEdgeTreatment.spec.ts', () => {
  const dependencies = {
    kclManager,
    engineCommandManager,
    editorManager,
    codeManager,
  }

  const runGetPathToExtrudeForSegmentSelectionTest = async (
    code: string,
    selectedSegmentSnippet: string,
    expectedExtrudeSnippet: string,
    expectError?: boolean
  ) => {
    // helpers
    function getExtrudeExpression(
      ast: Program,
      pathToExtrudeNode: PathToNode
    ): CallExpressionKw | PipeExpression | undefined | Error {
      if (pathToExtrudeNode.length === 0) return undefined // no extrude node

      const extrudeNodeResult = getNodeFromPath<CallExpressionKw>(
        ast,
        pathToExtrudeNode
      )
      if (err(extrudeNodeResult)) {
        return extrudeNodeResult
      }
      return extrudeNodeResult.node
    }

    function getExpectedExtrudeExpression(
      ast: Program,
      code: string,
      expectedExtrudeSnippet: string
    ): CallExpressionKw | PipeExpression | Error {
      const extrudeRange = topLevelRange(
        code.indexOf(expectedExtrudeSnippet),
        code.indexOf(expectedExtrudeSnippet) + expectedExtrudeSnippet.length
      )
      const expectedExtrudePath = getNodePathFromSourceRange(ast, extrudeRange)
      const expectedExtrudeNodeResult = getNodeFromPath<
        VariableDeclarator | CallExpressionKw
      >(ast, expectedExtrudePath)
      if (err(expectedExtrudeNodeResult)) {
        return expectedExtrudeNodeResult
      }
      const expectedExtrudeNode = expectedExtrudeNodeResult.node

      // check whether extrude is in the sketch pipe
      const extrudeInSketchPipe =
        expectedExtrudeNode.type === 'CallExpressionKw'
      if (extrudeInSketchPipe) {
        return expectedExtrudeNode
      }
      if (!extrudeInSketchPipe) {
        const init = expectedExtrudeNode.init
        if (
          init.type !== 'CallExpressionKw' &&
          init.type !== 'PipeExpression'
        ) {
          return new Error(
            'Expected extrude expression is not a CallExpression or PipeExpression'
          )
        }
        return init
      }
      return new Error('Expected extrude expression not found')
    }

    // ast
    const ast = assertParse(code)

    // range
    const segmentRange = topLevelRange(
      code.indexOf(selectedSegmentSnippet),
      code.indexOf(selectedSegmentSnippet) + selectedSegmentSnippet.length
    )

    // executeAst and artifactGraph
    await kclManager.executeAst({ ast })
    const artifactGraph = kclManager.artifactGraph

    expect(kclManager.errors).toEqual([])

    // find artifact
    const maybeArtifact = [...artifactGraph].find(([, artifact]) => {
      if (!('codeRef' in artifact && artifact.codeRef)) return false
      return isOverlap(artifact.codeRef.range, segmentRange)
    })

    // build selection
    const selection: Selection = {
      codeRef: codeRefFromRange(segmentRange, ast),
      artifact: maybeArtifact ? maybeArtifact[1] : undefined,
    }

    // get extrude expression
    const pathResult = getPathToExtrudeForSegmentSelection(
      ast,
      selection,
      artifactGraph
    )
    if (err(pathResult)) {
      if (!expectError) {
        expect(pathResult).toBeUndefined()
      }
      return pathResult
    }
    const { pathToExtrudeNode } = pathResult
    const extrudeExpression = getExtrudeExpression(ast, pathToExtrudeNode)

    // test
    if (expectedExtrudeSnippet) {
      const expectedExtrudeExpression = getExpectedExtrudeExpression(
        ast,
        code,
        expectedExtrudeSnippet
      )
      if (err(expectedExtrudeExpression)) return expectedExtrudeExpression
      expect(extrudeExpression).toEqual(expectedExtrudeExpression)
    } else {
      expect(extrudeExpression).toBeUndefined()
    }
  }
  describe('Testing getPathToExtrudeForSegmentSelection', () => {
    it('should return the correct paths for a valid selection and extrusion', async () => {
      const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`
      const selectedSegmentSnippet = `line(end = [20, 0])`
      const expectedExtrudeSnippet = `extrude001 = extrude(sketch001, length = -15)`
      await runGetPathToExtrudeForSegmentSelectionTest(
        code,
        selectedSegmentSnippet,
        expectedExtrudeSnippet
      )
    }, 10_000)
    it('should return the correct paths when extrusion occurs within the sketch pipe', async () => {
      const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = 15)`
      const selectedSegmentSnippet = `line(end = [20, 0])`
      const expectedExtrudeSnippet = `extrude(length = 15)`
      await runGetPathToExtrudeForSegmentSelectionTest(
        code,
        selectedSegmentSnippet,
        expectedExtrudeSnippet
      )
    }, 10_000)
    it('should return the correct paths for a valid selection and extrusion in case of several extrusions and sketches', async () => {
      const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-30, 30])
  |> line(end = [15, 0])
  |> line(end = [0, -15])
  |> line(end = [-15, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch002 = startSketchOn(XY)
  |> startProfile(at = [30, 30])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch003 = startSketchOn(XY)
  |> startProfile(at = [30, -30])
  |> line(end = [25, 0])
  |> line(end = [0, -25])
  |> line(end = [-25, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
extrude002 = extrude(sketch002, length = -15)
extrude003 = extrude(sketch003, length = -15)`
      const selectedSegmentSnippet = `line(end = [20, 0])`
      const expectedExtrudeSnippet = `extrude002 = extrude(sketch002, length = -15)`
      await runGetPathToExtrudeForSegmentSelectionTest(
        code,
        selectedSegmentSnippet,
        expectedExtrudeSnippet
      )
    }, 10_000)
    it('should return the correct paths for a (piped) extrude based on the other body (face)', async () => {
      const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-25, -25])
  |> yLine(length = 50)
  |> xLine(length = 50)
  |> yLine(length = -50)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = 50)
sketch002 = startSketchOn(sketch001, face = 'END')
  |> startProfile(at = [-15, -15])
  |> yLine(length = 30)
  |> xLine(length = 30)
  |> yLine(length = -30)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = 30)`
      const selectedSegmentSnippet = `xLine(length = 30)`
      const expectedExtrudeSnippet = `extrude(length = 30)`
      await runGetPathToExtrudeForSegmentSelectionTest(
        code,
        selectedSegmentSnippet,
        expectedExtrudeSnippet
      )
    }, 10_000)
    it('should return the correct paths for a (non-piped) extrude based on the other body (face)', async () => {
      const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-25, -25])
  |> yLine(length = 50)
  |> xLine(length = 50)
  |> yLine(length = -50)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 50)
sketch002 = startSketchOn(extrude001, face = 'END')
  |> startProfile(at = [-15, -15])
  |> yLine(length = 30)
  |> xLine(length = 30)
  |> yLine(length = -30)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(sketch002, length = 30)`
      const selectedSegmentSnippet = `xLine(length = 30)`
      const expectedExtrudeSnippet = `extrude002 = extrude(sketch002, length = 30)`
      await runGetPathToExtrudeForSegmentSelectionTest(
        code,
        selectedSegmentSnippet,
        expectedExtrudeSnippet
      )
    }, 10_000)
    it('should not return any path for missing extrusion', async () => {
      const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-30, 30])
  |> line(end = [15, 0])
  |> line(end = [0, -15])
  |> line(end = [-15, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch002 = startSketchOn(XY)
  |> startProfile(at = [30, 30])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch003 = startSketchOn(XY)
  |> startProfile(at = [30, -30])
  |> line(end = [25, 0])
  |> line(end = [0, -25])
  |> line(end = [-25, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
extrude003 = extrude(sketch003, length = -15)`
      const selectedSegmentSnippet = `line(end = [20, 0])`
      const expectedExtrudeSnippet = ``
      await runGetPathToExtrudeForSegmentSelectionTest(
        code,
        selectedSegmentSnippet,
        expectedExtrudeSnippet,
        true
      )
    }, 10_000)
  })

  const runModifyAstCloneWithEdgeTreatmentAndTag = async (
    code: string,
    selectionSnippets: Array<string>,
    parameters: EdgeTreatmentParameters,
    expectedCode: string
  ) => {
    // ast
    const ast = assertParse(code)

    // selection
    const segmentRanges: Array<SourceRange> = selectionSnippets.map(
      (selectionSnippet) =>
        topLevelRange(
          code.indexOf(selectionSnippet),
          code.indexOf(selectionSnippet) + selectionSnippet.length
        )
    )

    // executeAst
    await kclManager.executeAst({ ast })
    const artifactGraph = kclManager.artifactGraph

    expect(kclManager.errors).toEqual([])

    const selection: Selections = {
      graphSelections: segmentRanges.map((segmentRange) => {
        const maybeArtifact = [...artifactGraph].find(([, a]) => {
          if (!('codeRef' in a && a.codeRef)) return false
          return isOverlap(a.codeRef.range, segmentRange)
        })
        return {
          codeRef: codeRefFromRange(segmentRange, ast),
          artifact: maybeArtifact ? maybeArtifact[1] : undefined,
        }
      }),
      otherSelections: [],
    }

    // apply edge treatment to selection
    const result = await modifyAstWithEdgeTreatmentAndTag(
      ast,
      selection,
      parameters,
      dependencies
    )
    if (err(result)) {
      expect(result).toContain(expectedCode)
      return result
    }
    const { modifiedAst } = result

    const newCode = recast(modifiedAst)

    expect(newCode).toContain(expectedCode)
  }
  const runDeleteEdgeTreatmentTest = async (
    code: string,
    edgeTreatmentSnippet: string,
    expectedCode: string
  ) => {
    // parse ast
    const ast = assertParse(code)

    // update artifact graph
    await kclManager.executeAst({ ast })
    const artifactGraph = kclManager.artifactGraph

    expect(kclManager.errors).toEqual([])

    // define snippet range
    const edgeTreatmentRange = topLevelRange(
      code.indexOf(edgeTreatmentSnippet),
      code.indexOf(edgeTreatmentSnippet) + edgeTreatmentSnippet.length
    )

    // find artifact
    const maybeArtifact = [...artifactGraph].find(([, artifact]) => {
      if (!('codeRef' in artifact)) return false
      return isOverlap(artifact.codeRef.range, edgeTreatmentRange)
    })

    // build selection
    const selection: Selection = {
      codeRef: codeRefFromRange(edgeTreatmentRange, ast),
      artifact: maybeArtifact ? maybeArtifact[1] : undefined,
    }

    // delete edge treatment
    const result = await deleteEdgeTreatment(ast, selection)
    if (err(result)) {
      expect(result).toContain(expectedCode)
      return result
    }

    // recast and check
    const newCode = recast(result)
    expect(newCode).toContain(expectedCode)
  }
  const createFilletParameters = (radiusValue: number): FilletParameters => ({
    type: EdgeTreatmentType.Fillet,
    radius: {
      valueAst: createLiteral(radiusValue),
      valueText: radiusValue.toString(),
      valueCalculated: radiusValue.toString(),
    },
  })
  const createChamferParameters = (lengthValue: number): ChamferParameters => ({
    type: EdgeTreatmentType.Chamfer,
    length: {
      valueAst: createLiteral(lengthValue),
      valueText: lengthValue.toString(),
      valueCalculated: lengthValue.toString(),
    },
  })
  // Iterate tests over all edge treatment types
  Object.values(EdgeTreatmentType).forEach(
    (edgeTreatmentType: EdgeTreatmentType) => {
      // create parameters based on the edge treatment type
      let parameterName: string
      let parameters: EdgeTreatmentParameters
      if (edgeTreatmentType === EdgeTreatmentType.Fillet) {
        parameterName = 'radius'
        parameters = createFilletParameters(3)
      } else if (edgeTreatmentType === EdgeTreatmentType.Chamfer) {
        parameterName = 'length'
        parameters = createChamferParameters(3)
      } else {
        // Handle future edge treatments
        return new Error(
          `Unsupported edge treatment type: ${edgeTreatmentType}`
        )
      }
      // run tests
      describe(`Testing modifyAstCloneWithEdgeTreatmentAndTag with ${edgeTreatmentType}s`, () => {
        it(`should add a ${edgeTreatmentType} to a specific segment`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`
          const segmentSnippets = ['line(end = [0, -20])']
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20], tag = $seg01)
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15, tagEnd = $capEnd001)
  |> ${edgeTreatmentType}(
       ${parameterName} = 3,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
     )`

          await runModifyAstCloneWithEdgeTreatmentAndTag(
            code,
            segmentSnippets,
            parameters,
            expectedCode
          )
        }, 10_000)
        it(`should add a ${edgeTreatmentType} to the sketch pipe`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = -15)`
          const segmentSnippets = ['line(end = [0, -20])']
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20], tag = $seg01)
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = -15, tagEnd = $capEnd001)
  |> ${edgeTreatmentType}(
       ${parameterName} = 3,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
     )`

          await runModifyAstCloneWithEdgeTreatmentAndTag(
            code,
            segmentSnippets,
            parameters,
            expectedCode
          )
        }, 10_000)
        it(`should add a ${edgeTreatmentType} to "close" if last segment is missing`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> close()
  |> extrude(length = -15)`
          const segmentSnippets = ['close()']
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> close(tag = $seg01)
  |> extrude(length = -15, tagEnd = $capEnd001)
  |> ${edgeTreatmentType}(
       ${parameterName} = 3,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
     )`

          await runModifyAstCloneWithEdgeTreatmentAndTag(
            code,
            segmentSnippets,
            parameters,
            expectedCode
          )
        }, 10_000)
        it(`should add a ${edgeTreatmentType} to an already tagged segment`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20], tag = $seg01)
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`
          const segmentSnippets = ['line(end = [0, -20], tag = $seg01)']
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20], tag = $seg01)
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15, tagEnd = $capEnd001)
  |> ${edgeTreatmentType}(
       ${parameterName} = 3,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
     )`

          await runModifyAstCloneWithEdgeTreatmentAndTag(
            code,
            segmentSnippets,
            parameters,
            expectedCode
          )
        }, 10_000)
        it(`should add a ${edgeTreatmentType} with existing tag on other segment`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`
          const segmentSnippets = ['line(end = [-20, 0])']
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15, tagEnd = $capEnd001)
  |> ${edgeTreatmentType}(
       ${parameterName} = 3,
       tags = [
         getCommonEdge(faces = [seg02, capEnd001])
       ],
     )`

          await runModifyAstCloneWithEdgeTreatmentAndTag(
            code,
            segmentSnippets,
            parameters,
            expectedCode
          )
        }, 10_000)
        it(`should add a ${edgeTreatmentType} with existing fillet on other segment`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15, tagEnd = $capEnd001)
  |> fillet(
       radius = 3,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
     )`
          const segmentSnippets = ['line(end = [-20, 0])']
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15, tagEnd = $capEnd001)
  |> fillet(
       radius = 3,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
     )
  |> ${edgeTreatmentType}(
       ${parameterName} = 3,
       tags = [
         getCommonEdge(faces = [seg02, capEnd001])
       ],
     )`

          await runModifyAstCloneWithEdgeTreatmentAndTag(
            code,
            segmentSnippets,
            parameters,
            expectedCode
          )
        }, 10_000)
        it(`should add a ${edgeTreatmentType} with existing chamfer on other segment`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15, tagEnd = $capEnd001)
  |> chamfer(
       length = 3,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
     )`
          const segmentSnippets = ['line(end = [-20, 0])']
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15, tagEnd = $capEnd001)
  |> chamfer(
       length = 3,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001])
       ],
     )
  |> ${edgeTreatmentType}(
       ${parameterName} = 3,
       tags = [
         getCommonEdge(faces = [seg02, capEnd001])
       ],
     )`

          await runModifyAstCloneWithEdgeTreatmentAndTag(
            code,
            segmentSnippets,
            parameters,
            expectedCode
          )
        }, 10_000)
        it(`should add a ${edgeTreatmentType} to two segments of a single extrusion`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`
          const segmentSnippets = [
            'line(end = [20, 0])',
            'line(end = [-20, 0])',
          ]
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15, tagEnd = $capEnd001)
  |> ${edgeTreatmentType}(
       ${parameterName} = 3,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001]),
         getCommonEdge(faces = [seg02, capEnd001])
       ],
     )`

          await runModifyAstCloneWithEdgeTreatmentAndTag(
            code,
            segmentSnippets,
            parameters,
            expectedCode
          )
        }, 10_000)
        it(`should add ${edgeTreatmentType}s to two bodies`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
sketch002 = startSketchOn(XY)
  |> startProfile(at = [30, 10])
  |> line(end = [15, 0])
  |> line(end = [0, -15])
  |> line(end = [-15, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(sketch002, length = -25)` // <--- body 2
          const segmentSnippets = [
            'line(end = [20, 0])',
            'line(end = [-20, 0])',
            'line(end = [0, -15])',
          ]
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15, tagEnd = $capEnd001)
  |> ${edgeTreatmentType}(
       ${parameterName} = 3,
       tags = [
         getCommonEdge(faces = [seg01, capEnd001]),
         getCommonEdge(faces = [seg02, capEnd001])
       ],
     )
sketch002 = startSketchOn(XY)
  |> startProfile(at = [30, 10])
  |> line(end = [15, 0])
  |> line(end = [0, -15], tag = $seg03)
  |> line(end = [-15, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(sketch002, length = -25, tagEnd = $capEnd002)
  |> ${edgeTreatmentType}(
       ${parameterName} = 3,
       tags = [
         getCommonEdge(faces = [seg03, capEnd002])
       ],
     )`

          await runModifyAstCloneWithEdgeTreatmentAndTag(
            code,
            segmentSnippets,
            parameters,
            expectedCode
          )
        }, 10_000)
      })
      describe(`Testing deleteEdgeTreatment with ${edgeTreatmentType}s`, () => {
        // simple cases
        it(`should delete a piped ${edgeTreatmentType} from a single segment`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
  |> ${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])`
          const edgeTreatmentSnippet = `${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode
          )
        }, 10_000)
        it(`should delete a standalone assigned ${edgeTreatmentType} from a single segment`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
${edgeTreatmentType}001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [seg01])`
          const edgeTreatmentSnippet = `${edgeTreatmentType}001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [seg01])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode
          )
        }, 10_000)
        it(`should delete a standalone ${edgeTreatmentType} without assignment from a single segment`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
${edgeTreatmentType}(extrude001, ${parameterName} = 5, tags = [seg01])`
          const edgeTreatmentSnippet = `${edgeTreatmentType}(extrude001, ${parameterName} = 5, tags = [seg01])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode
          )
        }, 10_000)
        // getOppositeEdge and getNextAdjacentEdge cases
        it(`should delete a piped ${edgeTreatmentType} tagged with getOppositeEdge`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [getOppositeEdge(seg01)])`
          const edgeTreatmentSnippet = `fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [getOppositeEdge(seg01)])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode
          )
        }, 10_000)
        it(`should delete a non-piped ${edgeTreatmentType} tagged with getNextAdjacentEdge`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [getNextAdjacentEdge(seg01)])`
          const edgeTreatmentSnippet = `fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 3, tags = [getNextAdjacentEdge(seg01)])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode
          )
        }, 10_000)
        // cases with several edge treatments
        it(`should delete a piped ${edgeTreatmentType} from a body with multiple treatments`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
  |> ${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])
  |> fillet(radius = 5, tags = [getOppositeEdge(seg02)])
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])
chamfer001 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg01)])`
          const edgeTreatmentSnippet = `${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
  |> fillet(radius = 5, tags = [getOppositeEdge(seg02)])
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])
chamfer001 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg01)])`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode
          )
        }, 10_000)
        it(`should delete a non-piped ${edgeTreatmentType} from a body with multiple treatments`, async () => {
          const code = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
  |> ${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])
  |> fillet( radius = 5, tags = [getOppositeEdge(seg02)] )
fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])
chamfer001 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg01)])`
          const edgeTreatmentSnippet = `fillet001 = ${edgeTreatmentType}(extrude001, ${parameterName} = 6, tags = [seg02])`
          const expectedCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> line(end = [20, 0], tag = $seg01)
  |> line(end = [0, -20])
  |> line(end = [-20, 0], tag = $seg02)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -15)
  |> ${edgeTreatmentType}(${parameterName} = 3, tags = [seg01])
  |> fillet(radius = 5, tags = [getOppositeEdge(seg02)])
chamfer001 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg01)])`

          await runDeleteEdgeTreatmentTest(
            code,
            edgeTreatmentSnippet,
            expectedCode
          )
        }, 10_000)
      })
    }
  )

  describe('Testing button states', () => {
    const runButtonStateTest = async (
      code: string,
      segmentSnippet: string,
      expectedState: boolean
    ) => {
      const ast = assertParse(code)

      const start = code.indexOf(segmentSnippet)
      expect(start).toBeGreaterThan(-1)
      const range = segmentSnippet
        ? topLevelRange(start, start + segmentSnippet.length)
        : topLevelRange(ast.end, ast.end) // empty line in the end of the code

      const selectionRanges: Selections = {
        graphSelections: [
          {
            codeRef: codeRefFromRange(range, ast),
          },
        ],
        otherSelections: [],
      }

      // state
      const buttonState = hasValidEdgeTreatmentSelection({
        ast,
        selectionRanges,
        code,
      })

      expect(buttonState).toEqual(expectedState)
    }
    const codeWithBody: string = `
    sketch001 = startSketchOn(XY)
      |> startProfile(at = [-20, -5])
      |> line(end = [0, 10])
      |> line(end = [10, 0])
      |> line(end = [0, -10])
      |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
      |> close()
    extrude001 = extrude(sketch001, length = -10)
  `
    const codeWithoutBodies: string = `
    sketch001 = startSketchOn(XY)
      |> startProfile(at = [-20, -5])
      |> line(end = [0, 10])
      |> line(end = [10, 0])
      |> line(end = [0, -10])
      |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
      |> close()
  `
    // body is missing
    it('should return false when body is missing and nothing is selected', async () => {
      await runButtonStateTest(codeWithoutBodies, '', false)
    }, 10_000)
    it('should return false when body is missing and segment is selected', async () => {
      await runButtonStateTest(codeWithoutBodies, `line(end = [10, 0])`, false)
    }, 10_000)

    // body exists
    it('should return true when body exists and nothing is selected', async () => {
      await runButtonStateTest(codeWithBody, '', true)
    }, 10_000)
    it('should return true when body exists and segment is selected', async () => {
      await runButtonStateTest(codeWithBody, `line(end = [10, 0])`, true)
    }, 10_000)
    it('should return false when body exists and not a segment is selected', async () => {
      await runButtonStateTest(codeWithBody, `close()`, false)
    }, 10_000)
  })
})

describe('boolean.spec.ts', () => {
  describe('Testing addSubtract', () => {
    async function runAddSubtractTest(
      code: string,
      solidIds: number[],
      toolIds: number[]
    ) {
      const ast = assertParse(code)
      if (err(ast)) throw ast

      const { artifactGraph } = await enginelessExecutor(ast)
      const sweeps = [...artifactGraph.values()].filter(
        (n) => n.type === 'sweep'
      )
      const solids: Selections = {
        graphSelections: solidIds.map((i) => sweeps[i]),
        otherSelections: [],
      }
      const tools: Selections = {
        graphSelections: toolIds.map((i) => sweeps[i]),
        otherSelections: [],
      }
      const result = addSubtract({
        ast,
        artifactGraph,
        solids,
        tools,
      })
      if (err(result)) throw result

      await enginelessExecutor(ast)
      return recast(result.modifiedAst)
    }

    it('should add a standalone call on standalone sweeps selection', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0.2, 0.2], radius = 0.1)
extrude001 = extrude(profile001, length = 1)

sketch002 = startSketchOn(XZ)
profile002 = circle(sketch002, center = [0.2, 0.2], radius = 0.05)
extrude002 = extrude(profile002, length = -1)`
      const expectedNewLine = `solid001 = subtract(extrude002, tools = extrude001)`
      const solidIds = [1]
      const toolIds = [0]
      const newCode = await runAddSubtractTest(code, solidIds, toolIds)
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should push a call in pipe if selection was in variable-less pipe', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0.2, 0.2], radius = 0.1)
extrude001 = extrude(profile001, length = 1)

startSketchOn(XZ)
  |> circle(center = [0.2, 0.2], radius = 0.05)
  |> extrude(length = -1)`
      const expectedNewLine = `  |> subtract(tools = extrude001)`
      const solidIds = [1]
      const toolIds = [0]
      const newCode = await runAddSubtractTest(code, solidIds, toolIds)
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should support multi-profile extrude as tool', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0.2, 0.2], radius = 0.05)
profile002 = circle(sketch001, center = [0.2, 0.4], radius = 0.05)
extrude001 = extrude([profile001, profile002], length = 1)

sketch003 = startSketchOn(XZ)
profile003 = circle(sketch003, center = [0.2, 0.2], radius = 0.1)
extrude003 = extrude(profile003, length = -1)`
      const expectedNewLine = `solid001 = subtract(extrude003, tools = extrude001)`
      const solidIds = [2]
      const toolIds = [0, 1]
      const newCode = await runAddSubtractTest(code, solidIds, toolIds)
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })

    it('should support multi-solid selection for subtract', async () => {
      const code = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
profile002 = circle(sketch001, center = [0, 0], radius = 4.98)
extrude001 = extrude(profile002, length = 5)
plane001 = offsetPlane(XY, offset = 10)
sketch002 = startSketchOn(plane001)
profile003 = circle(sketch002, center = [0, 0], radius = 3.18)
extrude002 = extrude(profile003, length = 5)
sketch003 = startSketchOn(XY)
profile004 = circle(sketch003, center = [0, 0], radius = 1.06)
extrude003 = extrude(profile004, length = 20)`
      const expectedNewLine = `solid001 = subtract([extrude001, extrude002], tools = extrude003)`
      const solidIds = [0, 1]
      const toolIds = [2]
      const newCode = await runAddSubtractTest(code, solidIds, toolIds)
      expect(newCode).toContain(code + '\n' + expectedNewLine)
    })
  })
})

describe('operations.spec.ts', () => {
  function stdlib(name: string): Operation {
    return {
      type: 'StdLibCall',
      name,
      unlabeledArg: null,
      labeledArgs: {},
      nodePath: defaultNodePath(),
      sourceRange: defaultSourceRange(),
      isError: false,
    }
  }

  function userCall(name: string): Operation {
    return {
      type: 'GroupBegin',
      group: {
        type: 'FunctionCall',
        name,
        functionSourceRange: defaultSourceRange(),
        unlabeledArg: null,
        labeledArgs: {},
      },
      nodePath: defaultNodePath(),
      sourceRange: defaultSourceRange(),
    }
  }

  function userReturn(): Operation {
    return {
      type: 'GroupEnd',
    }
  }

  function moduleBegin(name: string): Operation {
    return {
      type: 'GroupBegin',
      group: {
        type: 'ModuleInstance',
        name,
        moduleId: 0,
      },
      nodePath: defaultNodePath(),
      sourceRange: defaultSourceRange(),
    }
  }

  function moduleEnd(): Operation {
    return {
      type: 'GroupEnd',
    }
  }

  describe('operations filtering', () => {
    it('drops stdlib operations inside a user-defined function call', async () => {
      const operations = [
        stdlib('std1'),
        userCall('foo'),
        stdlib('std2'),
        stdlib('std3'),
        userReturn(),
        stdlib('std4'),
        stdlib('std5'),
      ]
      const actual = filterOperations(operations)
      expect(actual).toEqual([
        stdlib('std1'),
        userCall('foo'),
        stdlib('std4'),
        stdlib('std5'),
      ])
    })
    it('drops user-defined function calls that contain no stdlib operations', async () => {
      const operations = [
        stdlib('std1'),
        userCall('foo'),
        userReturn(),
        stdlib('std2'),
        userCall('bar'),
        userReturn(),
        stdlib('std3'),
      ]
      const actual = filterOperations(operations)
      expect(actual).toEqual([stdlib('std1'), stdlib('std2'), stdlib('std3')])
    })
    it('does not drop module instances that contain no operations', async () => {
      const operations = [
        stdlib('std1'),
        moduleBegin('foo'),
        moduleEnd(),
        stdlib('std2'),
        moduleBegin('bar'),
        moduleEnd(),
        stdlib('std3'),
      ]
      const actual = filterOperations(operations)
      expect(actual).toEqual([
        stdlib('std1'),
        moduleBegin('foo'),
        stdlib('std2'),
        moduleBegin('bar'),
        stdlib('std3'),
      ])
    })
    it('preserves user-defined function calls at the end of the list', async () => {
      const operations = [stdlib('std1'), userCall('foo')]
      const actual = filterOperations(operations)
      expect(actual).toEqual([stdlib('std1'), userCall('foo')])
    })
    it('drops all user-defined function return operations', async () => {
      // The returns allow us to group operations with the call, but we never
      // display the returns.
      const operations = [
        stdlib('std1'),
        userCall('foo'),
        stdlib('std2'),
        userReturn(),
        stdlib('std3'),
        stdlib('std4'),
        userCall('foo2'),
        stdlib('std5'),
        stdlib('std6'),
        userReturn(),
        stdlib('std7'),
      ]
      const actual = filterOperations(operations)
      expect(actual).toEqual([
        stdlib('std1'),
        userCall('foo'),
        stdlib('std3'),
        stdlib('std4'),
        userCall('foo2'),
        stdlib('std7'),
      ])
    })
    it('correctly filters with nested function calls', async () => {
      const operations = [
        stdlib('std1'),
        userCall('foo'),
        stdlib('std2'),
        userReturn(),
        stdlib('std3'),
        stdlib('std4'),
        userCall('foo2'),
        stdlib('std5'),
        userCall('foo3-nested'),
        stdlib('std6'),
        userReturn(),
        stdlib('std7'),
        userReturn(),
        stdlib('std8'),
      ]
      const actual = filterOperations(operations)
      expect(actual).toEqual([
        stdlib('std1'),
        userCall('foo'),
        stdlib('std3'),
        stdlib('std4'),
        userCall('foo2'),
        stdlib('std8'),
      ])
    })
  })

  function rangeOfText(fullCode: string, target: string): SourceRange {
    const start = fullCode.indexOf(target)
    if (start === -1) {
      throw new Error(`Could not find \`${target}\` in: ${fullCode}`)
    }
    return topLevelRange(start, start + target.length)
  }

  async function buildNodePath(
    code: string,
    target: string
  ): Promise<NodePath> {
    const sourceRange = rangeOfText(code, target)
    const program = assertParse(code)
    return (await nodePathFromRange(program, sourceRange)) ?? defaultNodePath()
  }

  describe('variable name of operations', () => {
    it('finds the variable name with simple assignment', async () => {
      const op = stdlib('stdLibFn')
      if (op.type !== 'StdLibCall') {
        throw new Error('Expected operation to be a StdLibCall')
      }
      const code = `myVar = stdLibFn()`
      // Make the path match the code.
      op.nodePath = await buildNodePath(code, 'stdLibFn()')

      const program = assertParse(code)
      const variableName = getOperationVariableName(op, program)
      expect(variableName).toBe('myVar')
    })
    it('finds the alias name from a module instance', async () => {
      const op = moduleBegin('foo.kcl')
      if (op.type !== 'GroupBegin') {
        throw new Error('Expected operation to be a GroupBegin')
      }
      const code = `import "foo.kcl" as bar`
      // Make the path match the code.
      op.nodePath = await buildNodePath(code, code)

      const program = assertParse(code)
      const variableName = getOperationVariableName(op, program)
      expect(variableName).toBe('bar')
    })
    it('fails to find the alias name from a module instance without alias', async () => {
      const op = moduleBegin('foo.kcl')
      if (op.type !== 'GroupBegin') {
        throw new Error('Expected operation to be a GroupBegin')
      }
      const code = `import "foo.kcl"`
      // Make the path match the code.
      op.nodePath = await buildNodePath(code, code)

      const program = assertParse(code)
      const variableName = getOperationVariableName(op, program)
      expect(variableName).toBeUndefined()
    })
    it('finds the variable name inside a function with simple assignment', async () => {
      const op = stdlib('stdLibFn')
      if (op.type !== 'StdLibCall') {
        throw new Error('Expected operation to be a StdLibCall')
      }
      const code = `fn myFunc() {
  myVar = stdLibFn()
  return 0
}
`
      // Make the path match the code.
      op.nodePath = await buildNodePath(code, 'stdLibFn()')

      const program = assertParse(code)
      const variableName = getOperationVariableName(op, program)
      expect(variableName).toBe('myVar')
    })
    it("finds the variable name when it's the last in a pipeline", async () => {
      const op = stdlib('stdLibFn')
      if (op.type !== 'StdLibCall') {
        throw new Error('Expected operation to be a StdLibCall')
      }
      const code = `myVar = foo()
  |> stdLibFn()
`
      // Make the path match the code.
      op.nodePath = await buildNodePath(code, 'stdLibFn()')

      const program = assertParse(code)
      const variableName = getOperationVariableName(op, program)
      expect(variableName).toBe('myVar')
    })
    it("finds nothing when it's not the last in a pipeline", async () => {
      const op = stdlib('stdLibFn')
      if (op.type !== 'StdLibCall') {
        throw new Error('Expected operation to be a StdLibCall')
      }
      const code = `myVar = foo()
  |> stdLibFn()
  |> bar()
`
      // Make the path match the code.
      op.nodePath = await buildNodePath(code, 'stdLibFn()')

      const program = assertParse(code)
      const variableName = getOperationVariableName(op, program)
      expect(variableName).toBeUndefined()
    })
  })
})

describe('kclHelpers.spec.ts', () => {
  describe('KCL expression calculations', () => {
    it('calculates a simple expression without units', async () => {
      const actual = await getCalculatedKclExpressionValue('1 + 2')
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual).not.toHaveProperty('errors')
      expect(coercedActual.valueAsString).toEqual('3')
      expect(coercedActual?.astNode).toBeDefined()
    })
    it('calculates a simple expression with units', async () => {
      const actual = await getCalculatedKclExpressionValue('1deg + 30deg')
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual).not.toHaveProperty('errors')
      expect(coercedActual.valueAsString).toEqual('31deg')
      expect(coercedActual?.astNode).toBeDefined()
    })
    it('returns NAN for an invalid expression', async () => {
      const actual = await getCalculatedKclExpressionValue('1 + x')
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual.valueAsString).toEqual('NAN')
      expect(coercedActual.astNode).toBeDefined()
    })
  })

  describe('getStringValue', () => {
    it('returns a string value from a range', () => {
      const code = `appearance(abc, color = "#00FF00")`
      const range: SourceRange = [25, 25 + 7, 0] // '#00FF00' range
      const result = getStringValue(code, range)
      expect(result).toBe('#00FF00')
    })

    it('an empty string on bad range', () => {
      const code = `badboi`
      const range: SourceRange = [10, 12, 0]
      const result = getStringValue(code, range)
      expect(result).toBe('')
    })
  })
  describe('KCL expression calculations', () => {
    it('calculates a simple expression without units', async () => {
      const actual = await getCalculatedKclExpressionValue('1 + 2')
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual).not.toHaveProperty('errors')
      expect(coercedActual.valueAsString).toEqual('3')
      expect(coercedActual?.astNode).toBeDefined()
    })
    it('calculates a simple expression with units', async () => {
      const actual = await getCalculatedKclExpressionValue('1deg + 30deg')
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual).not.toHaveProperty('errors')
      expect(coercedActual.valueAsString).toEqual('31deg')
      expect(coercedActual?.astNode).toBeDefined()
    })
    it('returns NAN for an invalid expression', async () => {
      const actual = await getCalculatedKclExpressionValue('1 + x')
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual.valueAsString).toEqual('NAN')
      expect(coercedActual.astNode).toBeDefined()
    })

    it('returns NAN for arrays when allowArrays is false (default)', async () => {
      const actual = await getCalculatedKclExpressionValue('[1, 2, 3]')
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual.valueAsString).toEqual('NAN')
      expect(coercedActual.astNode).toBeDefined()
    })

    it('returns NAN for arrays when allowArrays is explicitly false', async () => {
      const actual = await getCalculatedKclExpressionValue('[1, 2, 3]', false)
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual.valueAsString).toEqual('NAN')
      expect(coercedActual.astNode).toBeDefined()
    })

    it('formats simple number arrays when allowArrays is true', async () => {
      const actual = await getCalculatedKclExpressionValue('[1, 2, 3]', true)
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual).not.toHaveProperty('errors')
      expect(coercedActual.valueAsString).toEqual('[1, 2, 3]')
      expect(coercedActual.astNode).toBeDefined()
    })

    it('formats arrays with units when allowArrays is true', async () => {
      const actual = await getCalculatedKclExpressionValue(
        '[1mm, 2mm, 3mm]',
        true
      )
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual).not.toHaveProperty('errors')
      expect(coercedActual.valueAsString).toEqual('[1mm, 2mm, 3mm]')
      expect(coercedActual.astNode).toBeDefined()
    })

    it('formats mixed arrays when allowArrays is true', async () => {
      const actual = await getCalculatedKclExpressionValue('[0, 1, 0]', true)
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual).not.toHaveProperty('errors')
      expect(coercedActual.valueAsString).toEqual('[0, 1, 0]')
      expect(coercedActual.astNode).toBeDefined()
    })

    it('rejects arrays with non-numeric types when allowArrays is true', async () => {
      // Arrays with non-numeric values should be rejected even when allowArrays is true
      const actual = await getCalculatedKclExpressionValue('[1, true, 0]', true)
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual.valueAsString).toEqual('NAN')
      expect(coercedActual.astNode).toBeDefined()
    })

    it('formats arrays with mixed numeric values (integers and floats) when allowArrays is true', async () => {
      // Arrays with different numeric types should work fine
      const actual = await getCalculatedKclExpressionValue('[1, 2.5, 0]', true)
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual).not.toHaveProperty('errors')
      expect(coercedActual.valueAsString).toEqual('[1, 2.5, 0]')
      expect(coercedActual.astNode).toBeDefined()
    })

    it('handles arrays with undefined variables when allowArrays is true', async () => {
      // Test what happens with arrays containing undefined variables like [0, x, 0]
      const actual = await getCalculatedKclExpressionValue('[0, x, 0]', true)
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      // This returns 'NAN' because 'x' is undefined - the entire array expression fails
      expect(coercedActual.valueAsString).toEqual('NAN')
      expect(coercedActual.astNode).toBeDefined()
    })

    it('handles arrays with arithmetic expressions when allowArrays is true', async () => {
      // Test arrays containing expressions like [0, 2 + 3, 0] that evaluate to numbers
      const actual = await getCalculatedKclExpressionValue(
        '[0, 2 + 3, 0]',
        true
      )
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual).not.toHaveProperty('errors')
      expect(coercedActual.valueAsString).toEqual('[0, 5, 0]')
      expect(coercedActual.astNode).toBeDefined()
    })

    it('rejects empty arrays when allowArrays is true', async () => {
      // Empty arrays aren't useful for geometric operations and should be rejected
      const actual = await getCalculatedKclExpressionValue('[]', true)
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual.valueAsString).toEqual('NAN')
      expect(coercedActual.astNode).toBeDefined()
    })

    it('rejects arrays when allowArrays parameter is omitted', async () => {
      const actual = await getCalculatedKclExpressionValue('[1, 2, 3]')
      const coercedActual = actual as Exclude<
        typeof actual,
        Error | ParseResult
      >
      expect(coercedActual.valueAsString).toEqual('NAN')
      expect(coercedActual.astNode).toBeDefined()
    })
  })

  describe('getStringValue', () => {
    it('returns a string value from a range', () => {
      const code = `appearance(abc, color = "#00FF00")`
      const range: SourceRange = [25, 25 + 7, 0] // '#00FF00' range
      const result = getStringValue(code, range)
      expect(result).toBe('#00FF00')
    })

    it('an empty string on bad range', () => {
      const code = `badboi`
      const range: SourceRange = [10, 12, 0]
      const result = getStringValue(code, range)
      expect(result).toBe('')
    })
  })
})

describe('getSafeInsertIndex.spec.ts', () => {
  describe(`getSafeInsertIndex`, () => {
    it(`expression with no identifiers`, () => {
      const baseProgram = assertParse(`x = 5 + 2
y = 2
z = x + y`)
      const targetExpr = assertParse(`5`)
      expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(0)
    })
    it(`expression with no identifiers in longer program`, () => {
      const baseProgram = assertParse(`x = 5 + 2
    profile001 = startProfile(sketch001, at = [0.07, 0])
  |> angledLine(angle = 0, length = x, tag = $a)
  |> angledLine(angle = segAng(a) + 90, length = 5)
  |> angledLine(angle = segAng(a), length = -segLen(a))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`)
      const targetExpr = assertParse(`5`)
      expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(0)
    })
    it(`expression with an identifier in the middle`, () => {
      const baseProgram = assertParse(`x = 5 + 2
y = 2
z = x + y`)
      const targetExpr = assertParse(`5 + y`)
      expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(2)
    })
    it(`expression with an identifier at the end`, () => {
      const baseProgram = assertParse(`x = 5 + 2
y = 2
z = x + y`)
      const targetExpr = assertParse(`z * z`)
      expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(3)
    })
    it(`expression with a tag declarator add to end`, () => {
      const baseProgram = assertParse(`x = 5 + 2
    profile001 = startProfile(sketch001, at = [0.07, 0])
  |> angledLine(angle = 0, length = x, tag = $a)
  |> angledLine(angle = segAng(a) + 90, length = 5)
  |> angledLine(angle = segAng(a), length = -segLen(a))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`)
      const targetExpr = assertParse(`5 + segAng(a)`)
      expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(2)
    })
    it(`expression with a tag declarator and variable in the middle`, () => {
      const baseProgram = assertParse(`x = 5 + 2
    profile001 = startProfile(sketch001, at = [0.07, 0])
  |> angledLine(angle = 0, length = x, tag = $a)
  |> angledLine(angle = segAng(a) + 90, length = 5)
  |> angledLine(angle = segAng(a), length = -segLen(a))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  y = x + x`)
      const targetExpr = assertParse(`x + segAng(a)`)
      expect(getSafeInsertIndex(targetExpr, baseProgram)).toBe(2)
    })
  })
})

describe('utils2d.spec.ts', () => {
  describe('test isPointsCW', () => {
    test('basic test', () => {
      const points: Coords2d[] = [
        [2, 2],
        [2, 0],
        [0, -2],
      ]
      const pointsRev = [...points].reverse()
      const CCW = isPointsCCW(pointsRev)
      const CW = isPointsCCW(points)
      expect(CCW).toBe(1)
      expect(CW).toBe(-1)
    })
  })

  describe('test closestPointOnRay', () => {
    test('point lies on ray', () => {
      const rayOrigin: Coords2d = [0, 0]
      const rayDirection: Coords2d = [1, 0]
      const pointToCheck: Coords2d = [7, 0]

      const result = closestPointOnRay(rayOrigin, rayDirection, pointToCheck)
      expect(result.closestPoint).toEqual([7, 0])
      expect(result.t).toBe(7)
    })

    test('point is above ray', () => {
      const rayOrigin: Coords2d = [1, 0]
      const rayDirection: Coords2d = [1, 0]
      const pointToCheck: Coords2d = [7, 7]

      const result = closestPointOnRay(rayOrigin, rayDirection, pointToCheck)
      expect(result.closestPoint).toEqual([7, 0])
      expect(result.t).toBe(6)
    })

    test('point lies behind ray origin and allowNegative=false', () => {
      const rayOrigin: Coords2d = [0, 0]
      const rayDirection: Coords2d = [1, 0]
      const pointToCheck: Coords2d = [-7, 7]

      const result = closestPointOnRay(rayOrigin, rayDirection, pointToCheck)
      expect(result.closestPoint).toEqual([0, 0])
      expect(result.t).toBe(0)
    })

    test('point lies behind ray origin and allowNegative=true', () => {
      const rayOrigin: Coords2d = [0, 0]
      const rayDirection: Coords2d = [1, 0]
      const pointToCheck: Coords2d = [-7, 7]

      const result = closestPointOnRay(
        rayOrigin,
        rayDirection,
        pointToCheck,
        true
      )
      expect(result.closestPoint).toEqual([-7, 0])
      expect(result.t).toBe(-7)
    })

    test('diagonal ray and point', () => {
      const rayOrigin: Coords2d = [0, 0]
      const rayDirection: Coords2d = [1, 1]
      const pointToCheck: Coords2d = [3, 4]

      const result = closestPointOnRay(rayOrigin, rayDirection, pointToCheck)
      expect(result.closestPoint[0]).toBeCloseTo(3.5)
      expect(result.closestPoint[1]).toBeCloseTo(3.5)
      expect(result.t).toBeCloseTo(4.95, 1)
    })

    test('non-normalized direction vector', () => {
      const rayOrigin: Coords2d = [0, 0]
      const rayDirection: Coords2d = [2, 2]
      const pointToCheck: Coords2d = [3, 4]

      const result = closestPointOnRay(rayOrigin, rayDirection, pointToCheck)
      expect(result.closestPoint[0]).toBeCloseTo(3.5)
      expect(result.closestPoint[1]).toBeCloseTo(3.5)
      expect(result.t).toBeCloseTo(4.95, 1)
    })
  })
})

describe('rectangleTool.spec.ts', () => {
  describe('library rectangleTool helper functions', () => {
    describe('updateCenterRectangleSketch', () => {
      // regression test for https://github.com/KittyCAD/modeling-app/issues/5157
      test('should update AST and source code', async () => {
        // Base source code that will be edited in place
        const sourceCode = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(at = [120.37, 162.76])
|> angledLine(angle = 0, length = 0, tag = $rectangleSegmentA001)
|> angledLine(angle = segAng(rectangleSegmentA001) + 90deg, length = 0, tag = $rectangleSegmentB001)
|> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
|> close()
`
        // Create ast
        const _ast = assertParse(sourceCode)
        let ast = structuredClone(_ast)

        // Find some nodes and paths to reference
        const sketchSnippet = `startProfile(at = [120.37, 162.76])`
        const start = sourceCode.indexOf(sketchSnippet)
        expect(start).toBeGreaterThanOrEqual(0)
        const sketchRange = topLevelRange(start, start + sketchSnippet.length)
        const sketchPathToNode = getNodePathFromSourceRange(ast, sketchRange)
        const _node = getNodeFromPath<VariableDeclaration>(
          ast,
          sketchPathToNode || [],
          'VariableDeclaration'
        )
        if (trap(_node)) return
        const sketchInit = _node.node?.declaration.init

        // Hard code inputs that a user would have taken with their mouse
        const x = 40
        const y = 60
        const rectangleOrigin = [120, 180]
        const tags: [string, string, string] = [
          'rectangleSegmentA001',
          'rectangleSegmentB001',
          'rectangleSegmentC001',
        ]

        // Update the ast
        if (sketchInit.type === 'PipeExpression') {
          const maybeErr = updateCenterRectangleSketch(
            sketchInit,
            x,
            y,
            tags[0],
            rectangleOrigin[0],
            rectangleOrigin[1]
          )
          expect(maybeErr).toEqual(undefined)
        }

        // ast is edited in place from the updateCenterRectangleSketch
        const expectedSourceCode = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(at = [80, 120])
  |> angledLine(angle = 0, length = 80, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90deg, length = 120, tag = $rectangleSegmentB001)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
`
        const recasted = recast(ast)
        expect(recasted).toEqual(expectedSourceCode)
      })
    })
  })
})

describe('recast.spec.ts', () => {
  describe('recast', () => {
    it('recasts a simple program', () => {
      const code = '1 + 2'
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code)
    })
    it('variable declaration', () => {
      const code = 'myVar = 5'
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code)
    })
    it("variable declaration that's binary with string", () => {
      const code = "myVar = 5 + 'yo'"
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code)
      const codeWithOtherQuotes = 'myVar = 5 + "yo"'
      const { ast: ast2 } = code2ast(codeWithOtherQuotes)
      const recastRetVal = recast(ast2)
      if (err(recastRetVal)) throw recastRetVal
      expect(recastRetVal.trim()).toBe(codeWithOtherQuotes)
    })
    it('test assigning two variables, the second summing with the first', () => {
      const code = `myVar = 5
newVar = myVar + 1
`
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted).toBe(code)
    })
    it('test assigning a var by cont concatenating two strings string', () => {
      const code = fs.readFileSync(
        './src/lang/testExamples/variableDeclaration.cado',
        'utf-8'
      )
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code.trim())
    })
    it('test with function call', () => {
      const code = `myVar = "hello"
log(5, exp = myVar)
`
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted).toBe(code)
    })
    it('function declaration with call', () => {
      const code = [
        'fn funcN(a, b) {',
        '  return a + b',
        '}',
        'theVar = 60',
        'magicNum = funcN(a = 9, b = theVar)',
      ].join('\n')
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code)
    })
    it('recast sketch declaration', () => {
      let code = `mySketch = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [0, 1], tag = $myPath)
  |> line(endAbsolute = [1, 1])
  |> line(endAbsolute = [1, 0], tag = $rightPath)
  |> close()
`
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted).toBe(code)
    })
    it('sketch piped into callExpression', () => {
      const code = [
        'mySk1 = startSketchOn(XY)',
        '  |> startProfile(at = [0, 0])',
        '  |> line(endAbsolute = [1, 1])',
        '  |> line(endAbsolute = [0, 1], tag = $myTag)',
        '  |> line(endAbsolute = [1, 1])',
        '  |> rx(90)',
      ].join('\n')
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code.trim())
    })
    it('recast BinaryExpression piped into CallExpression', () => {
      const code = [
        'fn myFn(@a) {',
        '  return a + 1',
        '}',
        'myVar = 5 + 1',
        '  |> myFn(%)',
      ].join('\n')
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code)
    })
    it('recast nested binary expression', () => {
      const code = ['myVar = 1 + 2 * 5'].join('\n')
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code.trim())
    })
    it('recast nested binary expression with parans', () => {
      const code = ['myVar = 1 + (1 + 2) * 5'].join('\n')
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code.trim())
    })
    it('unnecessary paran wrap will be remove', () => {
      const code = ['myVar = 1 + (2 * 5)'].join('\n')
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code.replace('(', '').replace(')', ''))
    })
    it('complex nested binary expression', () => {
      const code = ['1 * ((2 + 3) / 4 + 5)'].join('\n')
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code.trim())
    })
    it('multiplied paren expressions', () => {
      const code = ['3 + (1 + 2) * (3 + 4)'].join('\n')
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code.trim())
    })
    it('recast array declaration', () => {
      const code = ['three = 3', "yo = [1, '2', three, 4 + 5]"].join('\n')
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code.trim())
    })
    it('recast long array declaration', () => {
      const code = [
        'three = 3',
        'yo = [',
        '  1,',
        "  '2',",
        '  three,',
        '  4 + 5,',
        "  'hey oooooo really long long long'",
        ']',
      ].join('\n')
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code.trim())
    })
    it('recast long object execution', () => {
      const code = `three = 3
yo = {
  aStr = 'str',
  anum = 2,
  identifier = three,
  binExp = 4 + 5
}
`
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted).toBe(code)
    })
    it('recast short object execution', () => {
      const code = `yo = { key = 'val' }
`
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted).toBe(code)
    })
    it('recast object execution with member expression', () => {
      const code = `yo = { a = { b = { c = '123' } } }
key = 'c'
myVar = yo.a['b'][key]
key2 = 'b'
myVar2 = yo['a'][key2].c
`
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted).toBe(code)
    })
  })

  describe('testing recasting with comments and whitespace', () => {
    it('code with comments', () => {
      const code = `yo = { a = { b = { c = '123' } } }
// this is a comment
key = 'c'
`

      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted

      expect(recasted).toBe(code)
    })
    it('comments at the start and end', () => {
      const code = `// this is a comment
yo = { a = { b = { c = '123' } } }
key = 'c'

// this is also a comment
`
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted).toBe(code)
    })
    it('comments in a pipe expression', () => {
      const code = [
        'mySk1 = startSketchOn(XY)',
        '  |> startProfile(at = [0, 0])',
        '  |> line(endAbsolute = [1, 1])',
        '  |> line(endAbsolute = [0, 1], tag = $myTag)',
        '  |> line(endAbsolute = [1, 1])',
        '  // a comment',
        '  |> rx(90)',
      ].join('\n')
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code)
    })
    it('comments sprinkled in all over the place', () => {
      const code = `
/* comment at start */

mySk1 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [1, 1])
  // comment here
  |> line(endAbsolute = [0, 1], tag = $myTag)
  |> line(endAbsolute = [1, 1]) /* and
  here
  */
  // a comment between pipe expression statements
  |> rx(90)
  // and another with just white space between others below
  |> ry(45)


  |> rx(45)
/*
one more for good measure
*/
`
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted).toBe(`/* comment at start */

mySk1 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [1, 1])
  // comment here
  |> line(endAbsolute = [0, 1], tag = $myTag)
  |> line(endAbsolute = [1, 1]) /* and
  here */
  // a comment between pipe expression statements
  |> rx(90)
  // and another with just white space between others below
  |> ry(45)
  |> rx(45)
/* one more for good measure */
`)
    })
  })

  describe('testing call Expressions in BinaryExpressions and UnaryExpressions', () => {
    it('nested callExpression in binaryExpression', () => {
      const code = 'myVar = 2 + min([100, legLen(hypotenuse = 5, leg = 3)])'
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code)
    })
    it('nested callExpression in unaryExpression', () => {
      const code = 'myVar = -min([100, legLen(hypotenuse = 5, leg = 3)])'
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code)
    })
    it('with unaryExpression in callExpression', () => {
      const code = 'myVar = min([5, -legLen(hypotenuse = 5, leg = 4)])'
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code)
    })
    it('with unaryExpression in sketch situation', () => {
      const code = [
        'part001 = startSketchOn(XY)',
        '  |> startProfile(at = [0, 0])',
        '  |> line(end = [\n       -2.21,\n       -legLen(hypotenuse = 5, leg = min([3, 999]))\n     ])',
      ].join('\n')
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted.trim()).toBe(code)
    })
  })

  describe('it recasts wrapped object expressions in pipe bodies with correct indentation', () => {
    it('with a single line', () => {
      const code = `part001 = startSketchOn(XY)
  |> startProfile(at = [-0.01, -0.08])
  |> line(end = [0.62, 4.15], tag = $seg01)
  |> line(end = [2.77, -1.24])
  |> angledLineThatIntersects(angle = 201, offset = -1.35, intersectTag = $seg01)
  |> line(end = [-0.42, -1.72])
`
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted).toBe(code)
    })
    it('recasts wrapped object expressions NOT in pipe body correctly', () => {
      const code = `angledLineThatIntersects(angle = 201, offset = -1.35, intersectTag = $seg01)
`
      const { ast } = code2ast(code)
      const recasted = recast(ast)
      if (err(recasted)) throw recasted
      expect(recasted).toBe(code)
    })
  })

  describe('it recasts binary expression using brackets where needed', () => {
    it('when there are two minus in a row', () => {
      const code = `part001 = 1 - (def - abc)
`
      const recasted = recast(code2ast(code).ast)
      expect(recasted).toBe(code)
    })
  })

  // helpers

  function code2ast(code: string): { ast: Program } {
    const ast = assertParse(code)
    return { ast }
  }
})

describe('getNodePathFromSourceRange.spec.ts', () => {
  describe('testing getNodePathFromSourceRange', () => {
    it('test it gets the right path for a `lineTo` CallExpression within a SketchExpression', () => {
      const code = `
myVar = 5
sk3 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [1, 2])
  |> line(endAbsolute = [3, 4], tag = $yo)
  |> close()
`
      const subStr = 'line(endAbsolute = [3, 4], tag = $yo)'
      const lineToSubstringIndex = code.indexOf(subStr)
      const sourceRange = topLevelRange(
        lineToSubstringIndex,
        lineToSubstringIndex + subStr.length
      )

      const ast = assertParse(code)
      const nodePath = getNodePathFromSourceRange(ast, sourceRange)
      const _node = getNodeFromPath<any>(ast, nodePath)
      if (err(_node)) throw _node
      const { node } = _node

      expect(topLevelRange(node.start, node.end)).toEqual(sourceRange)
      expect(node.type).toBe('CallExpressionKw')
    })
    it('gets path right for function definition params', () => {
      const code = `fn cube(pos, scale) {
  sg = startSketchOn(XY)
    |> startProfile(at = pos)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])

  return sg
}

b1 = cube(pos = [0,0], scale = 10)`
      const subStr = 'pos, scale'
      const subStrIndex = code.indexOf(subStr)
      const sourceRange = topLevelRange(subStrIndex, subStrIndex + 'pos'.length)

      const ast = assertParse(code)
      const nodePath = getNodePathFromSourceRange(ast, sourceRange)
      const _node = getNodeFromPath<Parameter>(ast, nodePath)
      if (err(_node)) throw _node
      const node = _node.node

      expect(nodePath).toEqual([
        ['body', ''],
        [0, 'index'],
        ['declaration', 'VariableDeclaration'],
        ['init', ''],
        ['params', 'FunctionExpression'],
        [0, 'index'],
      ])
      expect(node.type).toBe('Parameter')
      expect(node.identifier.name).toBe('pos')
    })
    it('gets path right for deep within function definition body', () => {
      const code = `fn cube(pos, scale) {
  sg = startSketchOn(XY)
    |> startProfile(at = pos)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])

  return sg
}

b1 = cube(pos = [0,0], scale = 10)`
      const subStr = 'scale, 0'
      const subStrIndex = code.indexOf(subStr)
      const sourceRange = topLevelRange(
        subStrIndex,
        subStrIndex + 'scale'.length
      )

      const ast = assertParse(code)
      const nodePath = getNodePathFromSourceRange(ast, sourceRange)
      const _node = getNodeFromPath<Name>(ast, nodePath)
      if (err(_node)) throw _node
      const node = _node.node
      expect(nodePath).toEqual([
        ['body', ''],
        [0, 'index'],
        ['declaration', 'VariableDeclaration'],
        ['init', ''],
        ['body', 'FunctionExpression'],
        ['body', 'FunctionExpression'],
        [0, 'index'],
        ['declaration', 'VariableDeclaration'],
        ['init', ''],
        ['body', 'PipeExpression'],
        [3, 'index'],
        ['arguments', 'CallExpressionKw'],
        [0, ARG_INDEX_FIELD],
        ['arg', LABELED_ARG_FIELD],
        ['elements', 'ArrayExpression'],
        [0, 'index'],
      ])
      expect(node.type).toBe('Name')
      expect(node.name.name).toBe('scale')
    })
  })
})

const GLOBAL_TIMEOUT_FOR_MODELING_MACHINE = 5000
describe('modelingMachine.spec.ts', () => {
  // Define mock implementations that will be referenced in vi.mock calls
  vi.mock('@src/components/SetHorVertDistanceModal', () => ({
    createInfoModal: vi.fn(() => ({
      open: vi.fn().mockResolvedValue({
        value: '10',
        segName: 'test',
        valueNode: {},
        newVariableInsertIndex: 0,
        sign: 1,
      }),
    })),
    GetInfoModal: vi.fn(),
  }))

  vi.mock('@src/components/SetAngleLengthModal', () => ({
    createSetAngleLengthModal: vi.fn(() => ({
      open: vi.fn().mockResolvedValue({
        value: '45deg',
        segName: 'test',
        valueNode: {},
        newVariableInsertIndex: 0,
        sign: 1,
      }),
    })),
    SetAngleLengthModal: vi.fn(),
  }))

  // Add this function before the test cases
  // Utility function to wait for a condition to be met
  const waitForCondition = async (
    condition: () => boolean,
    timeout = GLOBAL_TIMEOUT_FOR_MODELING_MACHINE,
    interval = 100
  ) => {
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      try {
        if (condition()) {
          return true
        }
      } catch {
        // Ignore errors, keep polling
      }

      // Wait for the next interval
      await new Promise((resolve) => setTimeout(resolve, interval))
    }

    // Last attempt before failing
    return condition()
  }

  describe('modelingMachine - XState', () => {
    describe('when initialized', () => {
      it('should start in the idle state', () => {
        const actor = createActor(modelingMachine, {
          input: modelingMachineDefaultContext,
        }).start()
        const state = actor.getSnapshot().value

        // The machine should start in the idle state
        expect(state).toEqual({ idle: 'hidePlanes' })
      })
    })

    const makeStraightSegmentSnippet = (line: string) => ({
      code: `testVar1 = 55
testVar2 = 66
testVar3 = 77
testVar4 = 88
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [2263.04, -2721.2])
|> line(end = [78, 19])
|> ${line}
|> line(end = [75.72, 18.41])`,
      searchText: line,
    })
    const makeCircSnippet = (line: string) => ({
      code: `testVar1 = 55
testVar2 = 66
testVar3 = 77
testVar4 = 88
testVar5 = 99
testVar6 = 11
sketch001 = startSketchOn(YZ)
profile001 = ${line}
`,
      searchText: line,
    })
    const threePointCirceCode = `circleThreePoint(
sketch001,
p1 = [testVar1, testVar2],
p2 = [testVar3, testVar4],
p3 = [testVar5, testVar6],
)`
    const threePointCirceCodeLiterals = `circleThreePoint(
sketch001,
p1 = [281.18, 215.74],
p2 = [295.39, 269.96],
p3 = [342.51, 216.38],
)`

    type TestDetails = {
      name: string
      code: string
      searchText: string
      constraintIndex: number
      expectedResult: string
      filter?: string
    }

    const cases: {
      [strLibName: string]: {
        namedConstantConstraint: TestDetails[]
        removeAllConstraintsCases: TestDetails[]
        removeIndividualConstraintsCases: TestDetails[]
        deleteSegment: Omit<TestDetails, 'expectedResult' | 'constraintIndex'>[]
      }
    } = {
      line: {
        namedConstantConstraint: [
          {
            name: 'should constrain line x value',
            ...makeStraightSegmentSnippet('line(end = [16.27, 73.81])'),
            constraintIndex: 0,
            expectedResult: 'line(end = [test_variable,',
          },
          {
            name: 'should constrain line y value',
            ...makeStraightSegmentSnippet('line(end = [16.27, 73.81])'),
            constraintIndex: 1,
            expectedResult: 'line(end = [16.27, test_variable]',
          },
          {
            name: 'should constrain line absolute x value',
            ...makeStraightSegmentSnippet('line(endAbsolute = [16.27, 73.81])'),
            constraintIndex: 0,
            expectedResult: 'line(endAbsolute = [test_variable, 73.81]',
          },
          {
            name: 'should constrain line absolute y value',
            ...makeStraightSegmentSnippet('line(endAbsolute = [16.27, 73.81])'),
            constraintIndex: 1,
            expectedResult: 'line(endAbsolute = [16.27, test_variable]',
          },
        ],
        removeAllConstraintsCases: [
          {
            name: 'should un-constrain rel-line',
            ...makeStraightSegmentSnippet('line(end = [testVar1, testVar2])'),
            constraintIndex: 0,
            expectedResult: 'line(end = [55, 66])',
          },
          {
            name: 'should un-constrain abs-line',
            ...makeStraightSegmentSnippet(
              'line(endAbsolute = [testVar1, testVar2])'
            ),
            constraintIndex: 0,
            expectedResult: 'line(end = [-2286.04, 2768.2]',
            // TODO un-constrains to relative line when it should not, expectedResult should be the following
            // expectedResult: 'line(endAbsolute = [55, 66]',
          },
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain line x value',
            ...makeStraightSegmentSnippet('line(end = [testVar1, testVar2])'),
            constraintIndex: 0,
            expectedResult: 'line(end = [55, testVar2]',
          },
          {
            name: 'should un-constrain line y value',
            ...makeStraightSegmentSnippet('line(end = [testVar1, testVar2])'),
            constraintIndex: 1,
            expectedResult: 'line(end = [testVar1, 66]',
          },
          {
            name: 'should un-constrain line absolute x value',
            ...makeStraightSegmentSnippet(
              'line(endAbsolute = [testVar1, testVar2])'
            ),
            constraintIndex: 0,
            // expectedResult: 'line(end = [-2286.04, testVar2])',
            // // TODO should not swap from abs to relative, expected should be
            expectedResult: 'line(endAbsolute = [55, testVar2]',
          },
          {
            name: 'should un-constrain line absolute y value',
            ...makeStraightSegmentSnippet(
              'line(endAbsolute = [testVar1, testVar2])'
            ),
            constraintIndex: 1,
            expectedResult: 'line(endAbsolute = [testVar1, 66])',
          },
        ],
        deleteSegment: [
          {
            name: 'should delete rel-line',
            ...makeStraightSegmentSnippet('line(end = [testVar1, testVar2])'),
          },
          {
            name: 'should delete abs-line',
            ...makeStraightSegmentSnippet(
              'line(endAbsolute = [testVar1, testVar2])'
            ),
          },
        ],
      },
      xLine: {
        namedConstantConstraint: [
          {
            name: 'should constrain xLine x value',
            ...makeStraightSegmentSnippet('xLine(length = 15)'),
            constraintIndex: 1,
            expectedResult: 'xLine(length = test_variable)',
          },
          {
            name: 'should constrain xLine x absolute value',
            ...makeStraightSegmentSnippet('xLine(endAbsolute = 15)'),
            constraintIndex: 1,
            expectedResult: 'xLine(endAbsolute = test_variable)',
          },
        ],
        removeAllConstraintsCases: [
          {
            name: 'should un-constrain xLine',
            ...makeStraightSegmentSnippet('xLine(length = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'line(end = [55, 0])',
          },
          {
            name: 'should un-constrain xLine absolute value',
            ...makeStraightSegmentSnippet('xLine(endAbsolute = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'line(end = [-2286.04, 0])',
            // TODO un-constrains to relative line when it should not, expectedResult should be the following
            // expectedResult: 'line(endAbsolute = [55, 0])',
          },
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain xLine x value',
            ...makeStraightSegmentSnippet('xLine(length = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'xLine(length = 55)',
          },
          {
            name: 'should un-constrain xLine x absolute value',
            ...makeStraightSegmentSnippet('xLine(endAbsolute = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'xLine(endAbsolute = 55)',
          },
        ],
        deleteSegment: [
          {
            name: 'should delete xLine',
            ...makeStraightSegmentSnippet('xLine(length = 15)'),
          },
          {
            name: 'should delete xLine',
            ...makeStraightSegmentSnippet('xLine(endAbsolute = 15)'),
          },
        ],
      },
      yLine: {
        namedConstantConstraint: [
          {
            name: 'should constrain yLine y value',
            ...makeStraightSegmentSnippet('yLine(length = 15)'),
            constraintIndex: 1,
            expectedResult: 'yLine(length = test_variable)',
          },
          {
            name: 'should constrain yLine y absolute value',
            ...makeStraightSegmentSnippet('yLine(endAbsolute = 15)'),
            constraintIndex: 1,
            expectedResult: 'yLine(endAbsolute = test_variable)',
          },
        ],
        removeAllConstraintsCases: [
          {
            name: 'should un-constrain yLine value',
            ...makeStraightSegmentSnippet('yLine(length = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'line(end = [0, 55])',
          },
          {
            name: 'should un-constrain yLine absolute value',
            ...makeStraightSegmentSnippet('yLine(endAbsolute = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'line(end = [0, 2757.2])',
            // TODO un-constrains to relative line when it should not, expectedResult should be the following
            // expectedResult: 'line(endAbsolute = [0, 55])',
          },
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain yLine y value',
            ...makeStraightSegmentSnippet('yLine(length = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'yLine(length = 55)',
          },
          {
            name: 'should un-constrain yLine y absolute value',
            ...makeStraightSegmentSnippet('yLine(endAbsolute = testVar1)'),
            constraintIndex: 1,
            expectedResult: 'yLine(endAbsolute = 55)',
          },
        ],
        deleteSegment: [
          {
            name: 'should delete yLine',
            ...makeStraightSegmentSnippet('yLine(length = 15)'),
          },
          {
            name: 'should delete yLine abs',
            ...makeStraightSegmentSnippet('yLine(endAbsolute = 15)'),
          },
        ],
      },
      angledLine: {
        namedConstantConstraint: [
          {
            name: 'should constrain angledLine, angle value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, length = 100)'
            ),
            constraintIndex: 0,
            expectedResult: 'angledLine(angle = test_variable, length = 100)',
          },
          {
            name: 'should constrain angledLine, length value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, length = 100)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = 45deg, length = test_variable)',
          },
          {
            name: 'should constrain angledLine, endAbsoluteY value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, endAbsoluteY = 5)'
            ),
            constraintIndex: 1,
            expectedResult:
              'angledLine(angle = 45deg, endAbsoluteY = test_variable)',
          },
          {
            name: 'should constrain angledLine, endAbsoluteX value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, endAbsoluteX = 5)'
            ),
            constraintIndex: 1,
            expectedResult:
              'angledLine(angle = 45deg, endAbsoluteX = test_variable)',
          },
          {
            name: 'should constrain angledLine, lengthY value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, lengthY = 5)'
            ),
            constraintIndex: 1,
            expectedResult:
              'angledLine(angle = 45deg, lengthY = test_variable)',
          },
          {
            name: 'should constrain angledLine, lengthX value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, lengthX = 5)'
            ),
            constraintIndex: 1,
            expectedResult:
              'angledLine(angle = 45deg, lengthX = test_variable)',
          },
        ],
        removeAllConstraintsCases: [
          {
            name: 'should un-constrain angledLine',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, length = testVar2)'
            ),
            constraintIndex: 0,
            expectedResult: 'line(end = [37.86, 54.06]',
          },
          {
            name: 'should un-constrain angledLine, endAbsoluteY',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, endAbsoluteY = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'line(end = [1938.31, 2768.2])',
          },
          {
            name: 'should un-constrain angledLine, endAbsoluteX',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, endAbsoluteX = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'line(end = [-2275.04, -3249.09])',
          },
          {
            name: 'should un-constrain angledLine, lengthY',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, lengthY = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'line(end = [46.21, 66])',
          },
          {
            name: 'should un-constrain angledLine, lengthX',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, lengthX = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'line(end = [66, 94.26])',
          },
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain angledLine, angle value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, length = testVar2)'
            ),
            constraintIndex: 0,
            expectedResult: 'angledLine(angle = 55deg, length = testVar2)',
          },
          {
            name: 'should un-constrain angledLine, length value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, length = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = testVar1, length = 66)',
          },
          {
            name: 'should un-constrain angledLine, endAbsoluteY value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, endAbsoluteY = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = testVar1, endAbsoluteY = 66)',
          },
          {
            name: 'should un-constrain angledLine, endAbsoluteX value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, endAbsoluteX = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = testVar1, endAbsoluteX = 66)',
          },
          {
            name: 'should un-constrain angledLine, lengthY value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, lengthY = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = testVar1, lengthY = 66)',
          },
          {
            name: 'should un-constrain angledLine, lengthX value',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = testVar1, lengthX = testVar2)'
            ),
            constraintIndex: 1,
            expectedResult: 'angledLine(angle = testVar1, lengthX = 66)',
          },
        ],
        deleteSegment: [
          {
            name: 'should delete angledLine, angle length',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, length = 100)'
            ),
          },
          {
            name: 'should delete angledLine, endAbsoluteY',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, endAbsoluteY = 5)'
            ),
          },
          {
            name: 'should delete angledLine, endAbsoluteX',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, endAbsoluteX = 5)'
            ),
          },
          {
            name: 'should delete angledLine, lengthY',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, lengthY = 5)'
            ),
          },
          {
            name: 'should delete angledLine, lengthX',
            ...makeStraightSegmentSnippet(
              'angledLine(angle = 45deg, lengthX = 5)'
            ),
          },
        ],
      },
      circle: {
        namedConstantConstraint: [
          {
            name: 'should constrain circle, radius value',
            ...makeCircSnippet(
              'circle(sketch001, center = [140.82, 183.92], radius = 74.18)'
            ),
            constraintIndex: 0,
            expectedResult:
              'circle(sketch001, center = [140.82, 183.92], radius = test_variable)',
          },
          {
            name: 'should constrain circle, center x value',
            ...makeCircSnippet(
              'circle(sketch001, center = [140.82, 183.92], radius = 74.18)'
            ),
            constraintIndex: 1,
            expectedResult:
              'circle(sketch001, center = [test_variable, 183.92], radius = 74.18)',
          },
          {
            name: 'should constrain circle, center y value',
            ...makeCircSnippet(
              'circle(sketch001, center = [140.82, 183.92], radius = 74.18)'
            ),
            constraintIndex: 2,
            expectedResult:
              'circle(sketch001, center = [140.82, test_variable], radius = 74.18)',
          },
        ],
        removeAllConstraintsCases: [
          // TODO circle when remove all is working
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain circle, radius value',
            ...makeCircSnippet(
              'circle(sketch001, center = [140.82, 183.92], radius = testVar1)'
            ),
            constraintIndex: 0,
            expectedResult:
              'circle(sketch001, center = [140.82, 183.92], radius = 55)',
          },
          {
            name: 'should un-constrain circle, center x value',
            ...makeCircSnippet(
              'circle(sketch001, center = [testVar1, testVar2], radius = 74.18)'
            ),
            constraintIndex: 1,
            expectedResult:
              'circle(sketch001, center = [55, testVar2], radius = 74.18)',
          },
          {
            name: 'should un-constrain circle, center y value',
            ...makeCircSnippet(
              'circle(sketch001, center = [testVar1, testVar2], radius = 74.18)'
            ),
            constraintIndex: 2,
            expectedResult:
              'circle(sketch001, center = [testVar1, 66], radius = 74.18)',
          },
        ],
        deleteSegment: [
          /** TODO once circle has delete implemented */
        ],
      },
      circleThreePoint: {
        namedConstantConstraint: [
          {
            name: 'should constrain circleThreePoint, p1 x value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 0,
            expectedResult: 'p1 = [test_variable, 215.74]',
            filter: 'p1',
          },
          {
            name: 'should constrain circleThreePoint, p1 y value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 1,
            expectedResult: 'p1 = [281.18, test_variable]',
            filter: 'p1',
          },
          {
            name: 'should constrain circleThreePoint, p2 x value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 0,
            expectedResult: 'p2 = [test_variable, 269.96]',
            filter: 'p2',
          },
          {
            name: 'should constrain circleThreePoint, p2 y value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 1,
            expectedResult: 'p2 = [295.39, test_variable]',
            filter: 'p2',
          },
          {
            name: 'should constrain circleThreePoint, p3 x value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 0,
            expectedResult: 'p3 = [test_variable, 216.38]',
            filter: 'p3',
          },
          {
            name: 'should constrain circleThreePoint, p3 y value',
            ...makeCircSnippet(threePointCirceCodeLiterals),
            constraintIndex: 1,
            expectedResult: 'p3 = [342.51, test_variable]',
            filter: 'p3',
          },
        ],
        removeAllConstraintsCases: [
          // TODO circleThreePoint when remove all is working
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain circleThreePoint, p1 x value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 0,
            expectedResult: 'p1 = [55, testVar2]',
            filter: 'p1',
          },
          {
            name: 'should un-constrain circleThreePoint, p1 y value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 1,
            expectedResult: 'p1 = [testVar1, 66]',
            filter: 'p1',
          },
          {
            name: 'should un-constrain circleThreePoint, p2 x value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 0,
            expectedResult: 'p2 = [77, testVar4]',
            filter: 'p2',
          },
          {
            name: 'should un-constrain circleThreePoint, p2 y value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 1,
            expectedResult: 'p2 = [testVar3, 88]',
            filter: 'p2',
          },
          {
            name: 'should un-constrain circleThreePoint, p3 x value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 0,
            expectedResult: 'p3 = [99, testVar6]',
            filter: 'p3',
          },
          {
            name: 'should un-constrain circleThreePoint, p3 y value',
            ...makeCircSnippet(threePointCirceCode),
            constraintIndex: 1,
            expectedResult: 'p3 = [testVar5, 11]',
            filter: 'p3',
          },
        ],
        deleteSegment: [
          /**TODO once three point circle has delete implemented */
        ],
      },
      tangentialArc: {
        namedConstantConstraint: [
          {
            name: 'should constrain tangentialArc absolute x value',
            ...makeStraightSegmentSnippet(
              'tangentialArc(endAbsolute = [176.11, 19.49])'
            ),
            constraintIndex: 1,
            expectedResult: 'endAbsolute = [test_variable, 19.49]',
          },
          {
            name: 'should constrain tangentialArc absolute y value',
            ...makeStraightSegmentSnippet(
              'tangentialArc(endAbsolute = [176.11, 19.49])'
            ),
            constraintIndex: 2,
            expectedResult: 'endAbsolute = [176.11, test_variable]',
          },
          // TODO tangentialArc relative when that's working
        ],
        removeAllConstraintsCases: [
          // TODO tangentialArc when remove all is working
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain tangentialArc absolute x value',
            ...makeStraightSegmentSnippet(
              'tangentialArc(endAbsolute = [testVar1, testVar2])'
            ),
            constraintIndex: 1,
            expectedResult: 'endAbsolute = [55, testVar2]',
          },
          {
            name: 'should un-constrain tangentialArc absolute y value',
            ...makeStraightSegmentSnippet(
              'tangentialArc(endAbsolute = [testVar1, testVar2])'
            ),
            constraintIndex: 2,
            expectedResult: 'endAbsolute = [testVar1, 66]',
          },
        ],
        deleteSegment: [
          {
            name: 'should delete tangentialArc absolute',
            ...makeStraightSegmentSnippet(
              'tangentialArc(endAbsolute = [176.11, 19.49])'
            ),
          },
        ],
      },
      arc: {
        namedConstantConstraint: [
          {
            name: 'should constrain threePoint Arc interior x value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [379.93, 103.92], endAbsolute = [386.2, 162.89])'
            ),
            constraintIndex: 0,
            expectedResult: 'interiorAbsolute = [test_variable, 103.92]',
            filter: ARG_INTERIOR_ABSOLUTE,
          },
          {
            name: 'should constrain threePoint Arc interior y value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [379.93, 103.92], endAbsolute = [386.2, 162.89])'
            ),
            constraintIndex: 1,
            expectedResult: 'interiorAbsolute = [379.93, test_variable]',
            filter: ARG_INTERIOR_ABSOLUTE,
          },
          {
            name: 'should constrain threePoint Arc end x value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [379.93, 103.92], endAbsolute = [386.2, 162.89])'
            ),
            constraintIndex: 0,
            expectedResult: 'endAbsolute = [test_variable, 162.89]',
            filter: ARG_END_ABSOLUTE,
          },
          {
            name: 'should constrain threePoint Arc end y value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [379.93, 103.92], endAbsolute = [386.2, 162.89])'
            ),
            constraintIndex: 1,
            expectedResult: 'endAbsolute = [386.2, test_variable]',
            filter: ARG_END_ABSOLUTE,
          },
          // TODO do other kwargs for arc
        ],
        removeAllConstraintsCases: [
          // TODO arc when remove all is working
        ],
        removeIndividualConstraintsCases: [
          {
            name: 'should un-constrain threePoint Arc interior x value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [testVar1, testVar2], endAbsolute = [testVar3, testVar4])'
            ),
            constraintIndex: 0,
            expectedResult: 'interiorAbsolute = [55, testVar2]',
            filter: ARG_INTERIOR_ABSOLUTE,
          },
          {
            name: 'should un-constrain threePoint Arc interior y value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [testVar1, testVar2], endAbsolute = [testVar3, testVar4])'
            ),
            constraintIndex: 1,
            expectedResult: 'interiorAbsolute = [testVar1, 66]',
            filter: ARG_INTERIOR_ABSOLUTE,
          },
          {
            name: 'should un-constrain threePoint Arc end x value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [testVar1, testVar2], endAbsolute = [testVar3, testVar4])'
            ),
            constraintIndex: 0,
            expectedResult: 'endAbsolute = [77, testVar4]',
            filter: ARG_END_ABSOLUTE,
          },
          {
            name: 'should un-constrain threePoint Arc end y value',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [testVar1, testVar2], endAbsolute = [testVar3, testVar4])'
            ),
            constraintIndex: 1,
            expectedResult: 'endAbsolute = [testVar3, 88]',
            filter: ARG_END_ABSOLUTE,
          },
        ],
        deleteSegment: [
          {
            name: 'should delete threePoint Arc (interior, end)',
            ...makeStraightSegmentSnippet(
              'arc(interiorAbsolute = [379.93, 103.92], endAbsolute = [386.2, 162.89])'
            ),
          },
        ],
      },
    }

    describe('Deleting segment with three dot menu', () => {
      const namedConstantConstraintCases = Object.values(cases).flatMap(
        (caseGroup) => caseGroup.deleteSegment
      )
      namedConstantConstraintCases.forEach(
        ({ name, code, searchText, filter }) => {
          it(name, async () => {
            const indexOfInterest = code.indexOf(searchText)

            const ast = assertParse(code)

            await kclManager.executeAst({ ast })

            expect(kclManager.errors).toEqual([])

            // segment artifact with that source range
            const artifact = [...kclManager.artifactGraph].find(
              ([_, artifact]) =>
                artifact?.type === 'segment' &&
                artifact.codeRef.range[0] <= indexOfInterest &&
                indexOfInterest <= artifact.codeRef.range[1]
            )?.[1]
            if (!artifact || !('codeRef' in artifact)) {
              throw new Error(
                'Artifact not found or invalid artifact structure'
              )
            }

            const actor = createActor(modelingMachine, {
              input: modelingMachineDefaultContext,
            }).start()

            // Send event to transition to sketch mode
            actor.send({
              type: 'Set selection',
              data: {
                selectionType: 'mirrorCodeMirrorSelections',
                selection: {
                  graphSelections: [
                    {
                      artifact: artifact,
                      codeRef: artifact.codeRef,
                    },
                  ],
                  otherSelections: [],
                },
              },
            })
            actor.send({ type: 'Enter sketch' })

            // Check that we're in the sketch state
            let state = actor.getSnapshot()
            expect(state.value).toBe('animating to existing sketch')

            // wait for it to transition
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              return snapshot.value !== 'animating to existing sketch'
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              const a1 = JSON.stringify(snapshot.value)
              const a2 = JSON.stringify({
                Sketch: { SketchIdle: 'scene drawn' },
              })
              return a1 !== a2
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            const callExp = getNodeFromPath<Node<CallExpressionKw>>(
              kclManager.ast,
              artifact.codeRef.pathToNode,
              'CallExpressionKw'
            )
            if (err(callExp)) {
              throw new Error('Failed to get CallExpressionKw node')
            }
            const constraintInfo = getConstraintInfoKw(
              callExp.node,
              codeManager.code,
              artifact.codeRef.pathToNode,
              filter
            )
            const constraint = constraintInfo[0]

            // Now that we're in sketchIdle state, test the "Constrain with named value" event
            actor.send({
              type: 'Delete segments',
              data: [constraint.pathToNode],
            })

            // Wait for the state to change in response to the constraint
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              // Check if we've transitioned to a different state
              return (
                JSON.stringify(snapshot.value) !==
                JSON.stringify({
                  Sketch: { SketchIdle: 'set up segments' },
                })
              )
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            const startTime = Date.now()
            while (
              codeManager.code.includes(searchText) &&
              Date.now() - startTime < GLOBAL_TIMEOUT_FOR_MODELING_MACHINE
            ) {
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
            expect(codeManager.code).not.toContain(searchText)
          }, 10_000)
        }
      )
    })
    describe('Adding segment overlay constraints', () => {
      const namedConstantConstraintCases = Object.values(cases).flatMap(
        (caseGroup) => caseGroup.namedConstantConstraint
      )
      namedConstantConstraintCases.forEach(
        ({
          name,
          code,
          searchText,
          constraintIndex,
          expectedResult,
          filter,
        }) => {
          it(name, async () => {
            const indexOfInterest = code.indexOf(searchText)

            const ast = assertParse(code)

            await kclManager.executeAst({ ast })

            expect(kclManager.errors).toEqual([])

            // segment artifact with that source range
            const artifact = [...kclManager.artifactGraph].find(
              ([_, artifact]) =>
                artifact?.type === 'segment' &&
                artifact.codeRef.range[0] <= indexOfInterest &&
                indexOfInterest <= artifact.codeRef.range[1]
            )?.[1]
            if (!artifact || !('codeRef' in artifact)) {
              throw new Error(
                'Artifact not found or invalid artifact structure'
              )
            }

            const actor = createActor(modelingMachine, {
              input: modelingMachineDefaultContext,
            }).start()

            // Send event to transition to sketch mode
            actor.send({
              type: 'Set selection',
              data: {
                selectionType: 'mirrorCodeMirrorSelections',
                selection: {
                  graphSelections: [
                    {
                      artifact: artifact,
                      codeRef: artifact.codeRef,
                    },
                  ],
                  otherSelections: [],
                },
              },
            })
            actor.send({ type: 'Enter sketch' })

            // Check that we're in the sketch state
            let state = actor.getSnapshot()
            expect(state.value).toBe('animating to existing sketch')

            // wait for it to transition
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              return snapshot.value !== 'animating to existing sketch'
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            // After the condition is met, do the actual assertion
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              const a1 = JSON.stringify(snapshot.value)
              const a2 = JSON.stringify({
                Sketch: { SketchIdle: 'scene drawn' },
              })
              return a1 !== a2
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            const callExp = getNodeFromPath<Node<CallExpressionKw>>(
              kclManager.ast,
              artifact.codeRef.pathToNode,
              'CallExpressionKw'
            )
            if (err(callExp)) {
              throw new Error('Failed to get CallExpressionKw node')
            }
            const constraintInfo = getConstraintInfoKw(
              callExp.node,
              codeManager.code,
              artifact.codeRef.pathToNode,
              filter
            )
            const constraint = constraintInfo[constraintIndex]

            // Now that we're in sketchIdle state, test the "Constrain with named value" event
            actor.send({
              type: 'Constrain with named value',
              data: {
                currentValue: {
                  valueText: constraint.value,
                  pathToNode: constraint.pathToNode,
                  variableName: 'test_variable',
                },
                // Use type assertion to mock the complex type
                namedValue: {
                  valueText: '20',
                  variableName: 'test_variable',
                  insertIndex: 0,
                  valueCalculated: '20',
                  variableDeclarationAst: createVariableDeclaration(
                    'test_variable',
                    createLiteral('20')
                  ),
                  variableIdentifierAst: createIdentifier(
                    'test_variable'
                  ) as any,
                  valueAst: createLiteral('20'),
                },
              },
            })

            // Wait for the state to change in response to the constraint
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              // Check if we've transitioned to a different state
              return (
                JSON.stringify(snapshot.value) !==
                JSON.stringify({
                  Sketch: { SketchIdle: 'set up segments' },
                })
              )
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              // Check if we've transitioned to a different state
              return (
                JSON.stringify(snapshot.value) !==
                JSON.stringify({ Sketch: 'Converting to named value' })
              )
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)
            expect(codeManager.code).toContain(expectedResult)
          }, 10_000)
        }
      )
    })
    describe('removing individual constraints with segment overlay events', () => {
      const removeIndividualConstraintsCases = Object.values(cases).flatMap(
        (caseGroup) => caseGroup.removeIndividualConstraintsCases
      )

      removeIndividualConstraintsCases.forEach(
        ({
          name,
          code,
          searchText,
          constraintIndex,
          expectedResult,
          filter,
        }) => {
          it(name, async () => {
            const indexOfInterest = code.indexOf(searchText)

            const ast = assertParse(code)

            await kclManager.executeAst({ ast })

            expect(kclManager.errors).toEqual([])

            // segment artifact with that source range
            const artifact = [...kclManager.artifactGraph].find(
              ([_, artifact]) =>
                artifact?.type === 'segment' &&
                artifact.codeRef.range[0] <= indexOfInterest &&
                indexOfInterest <= artifact.codeRef.range[1]
            )?.[1]
            if (!artifact || !('codeRef' in artifact)) {
              throw new Error(
                'Artifact not found or invalid artifact structure'
              )
            }

            const actor = createActor(modelingMachine, {
              input: modelingMachineDefaultContext,
            }).start()

            // Send event to transition to sketch mode
            actor.send({
              type: 'Set selection',
              data: {
                selectionType: 'mirrorCodeMirrorSelections',
                selection: {
                  graphSelections: [
                    {
                      artifact: artifact,
                      codeRef: artifact.codeRef,
                    },
                  ],
                  otherSelections: [],
                },
              },
            })
            actor.send({ type: 'Enter sketch' })

            // Check that we're in the sketch state
            let state = actor.getSnapshot()
            expect(state.value).toBe('animating to existing sketch')

            // wait for it to transition
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              return snapshot.value !== 'animating to existing sketch'
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            // After the condition is met, do the actual assertion

            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              const a1 = JSON.stringify(snapshot.value)
              const a2 = JSON.stringify({
                Sketch: { SketchIdle: 'scene drawn' },
              })
              return a1 !== a2
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            const callExp = getNodeFromPath<Node<CallExpressionKw>>(
              kclManager.ast,
              artifact.codeRef.pathToNode,
              'CallExpressionKw'
            )
            if (err(callExp)) {
              throw new Error('Failed to get CallExpressionKw node')
            }
            const constraintInfo = getConstraintInfoKw(
              callExp.node,
              codeManager.code,
              artifact.codeRef.pathToNode,
              filter
            )
            const constraint = constraintInfo[constraintIndex]
            console.log('constraint', constraint)
            if (!constraint.argPosition) {
              throw new Error(
                `Constraint at index ${constraintIndex} does not have argPosition`
              )
            }

            const mod = removeSingleConstraintInfo(
              constraint.pathToNode,
              constraint.argPosition,
              ast,
              kclManager.variables,
              removeSingleConstraint,
              transformAstSketchLines
            )
            if (!mod) {
              throw new Error('Failed to remove constraint info')
            }
            const codeRecast = recast(mod.modifiedAst)

            expect(codeRecast).toContain(expectedResult)
          }, 10_000)
        }
      )
    })
    describe('Removing segment overlay constraints', () => {
      const removeAllConstraintsCases = Object.values(cases).flatMap(
        (caseGroup) => caseGroup.removeAllConstraintsCases
      )

      removeAllConstraintsCases.forEach(
        ({
          name,
          code,
          searchText,
          constraintIndex,
          expectedResult,
          filter,
        }) => {
          it(name, async () => {
            const indexOfInterest = code.indexOf(searchText)

            const ast = assertParse(code)

            await kclManager.executeAst({ ast })

            expect(kclManager.errors).toEqual([])

            // segment artifact with that source range
            const artifact = [...kclManager.artifactGraph].find(
              ([_, artifact]) =>
                artifact?.type === 'segment' &&
                artifact.codeRef.range[0] <= indexOfInterest &&
                indexOfInterest <= artifact.codeRef.range[1]
            )?.[1]
            if (!artifact || !('codeRef' in artifact)) {
              throw new Error(
                'Artifact not found or invalid artifact structure'
              )
            }

            const actor = createActor(modelingMachine, {
              input: modelingMachineDefaultContext,
            }).start()

            // Send event to transition to sketch mode
            actor.send({
              type: 'Set selection',
              data: {
                selectionType: 'mirrorCodeMirrorSelections',
                selection: {
                  graphSelections: [
                    {
                      artifact: artifact,
                      codeRef: artifact.codeRef,
                    },
                  ],
                  otherSelections: [],
                },
              },
            })
            actor.send({ type: 'Enter sketch' })

            // Check that we're in the sketch state
            let state = actor.getSnapshot()
            expect(state.value).toBe('animating to existing sketch')

            // wait for it to transition
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              return snapshot.value !== 'animating to existing sketch'
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            // After the condition is met, do the actual assertion
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              const a1 = JSON.stringify(snapshot.value)
              const a2 = JSON.stringify({
                Sketch: { SketchIdle: 'scene drawn' },
              })
              return a1 !== a2
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            const callExp = getNodeFromPath<Node<CallExpressionKw>>(
              kclManager.ast,
              artifact.codeRef.pathToNode,
              'CallExpressionKw'
            )
            if (err(callExp)) {
              throw new Error('Failed to get CallExpressionKw node')
            }

            // Now that we're in sketchIdle state, test the "Constrain with named value" event
            actor.send({
              type: 'Constrain remove constraints',
              data: artifact.codeRef.pathToNode,
            })

            // Wait for the state to change in response to the constraint
            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              // Check if we've transitioned to a different state
              return (
                JSON.stringify(snapshot.value) !==
                JSON.stringify({
                  Sketch: { SketchIdle: 'set up segments' },
                })
              )
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)

            await waitForCondition(() => {
              const snapshot = actor.getSnapshot()
              // Check if we've transitioned to a different state
              return (
                JSON.stringify(snapshot.value) !==
                JSON.stringify({ Sketch: 'Constrain remove constraints' })
              )
            }, GLOBAL_TIMEOUT_FOR_MODELING_MACHINE)
            const startTime = Date.now()
            while (
              !codeManager.code.includes(expectedResult) &&
              Date.now() - startTime < GLOBAL_TIMEOUT_FOR_MODELING_MACHINE
            ) {
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
            expect(codeManager.code).toContain(expectedResult)
          }, 10_000)
        }
      )
    })
  })
})

describe('getTagDeclaratorsInProgram.spec.ts', () => {
  function tagDeclaratorWithIndex(
    value: string,
    start: number,
    end: number,
    bodyIndex: number
  ) {
    return {
      tag: {
        type: 'TagDeclarator',
        value,
        start,
        end,
        moduleId: 0,
        commentStart: start,
      },
      bodyIndex,
    }
  }
  describe(`getTagDeclaratorsInProgram`, () => {
    it(`finds no tag declarators in an empty program`, () => {
      const tagDeclarators = getTagDeclaratorsInProgram(assertParse(''))
      expect(tagDeclarators).toEqual([])
    })
    it(`finds a single tag declarators in a small program`, () => {
      const tagDeclarators = getTagDeclaratorsInProgram(
        assertParse(`sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0, 0])
  |> angledLine(angle = 0, length = 11, tag = $a)`)
      )
      expect(tagDeclarators).toEqual([tagDeclaratorWithIndex('a', 126, 128, 1)])
    })
    it(`finds multiple tag declarators in a small program`, () => {
      const program = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0.07, 0])
  |> angledLine(angle = 0, length = 11, tag = $a)
  |> angledLine(angle = segAng(a) + 90, length = 11.17, tag = $b)
  |> angledLine(angle = segAng(a), length = -segLen(a), tag = $c)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`
      const tagDeclarators = getTagDeclaratorsInProgram(assertParse(program))
      expect(tagDeclarators).toEqual([
        tagDeclaratorWithIndex('a', 129, 131, 1),
        tagDeclaratorWithIndex('b', 195, 197, 1),
        tagDeclaratorWithIndex('c', 261, 263, 1),
      ])
    })
    it(`finds tag declarators at different indices`, () => {
      const program = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0.07, 0])
  |> angledLine(angle = 0, length = 11, tag = $a)
profile002 = angledLine(profile001, angle = segAng(a) + 90, length = 11.17, tag = $b)
  |> angledLine(angle = segAng(a), length = -segLen(a), tag = $c)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`
      const tagDeclarators = getTagDeclaratorsInProgram(assertParse(program))
      expect(tagDeclarators).toEqual([
        tagDeclaratorWithIndex('a', 129, 131, 1),
        tagDeclaratorWithIndex('b', 215, 217, 2),
        tagDeclaratorWithIndex('c', 281, 283, 2),
      ])
    })
  })
})
