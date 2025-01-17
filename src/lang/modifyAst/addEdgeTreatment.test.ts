import {
  assertParse,
  recast,
  initPromise,
  PathToNode,
  Program,
  CallExpression,
  makeDefaultPlanes,
  PipeExpression,
  VariableDeclarator,
} from '../wasm'
import {
  EdgeTreatmentType,
  getPathToExtrudeForSegmentSelection,
  hasValidEdgeTreatmentSelection,
  isTagUsedInEdgeTreatment,
  modifyAstWithEdgeTreatmentAndTag,
  FilletParameters,
  ChamferParameters,
  EdgeTreatmentParameters,
  deleteEdgeTreatment,
} from './addEdgeTreatment'
import { getNodeFromPath, getNodePathFromSourceRange } from '../queryAst'
import { createLiteral } from 'lang/modifyAst'
import { err } from 'lib/trap'
import { Selection, Selections } from 'lib/selections'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { VITE_KC_DEV_TOKEN } from 'env'
import { isOverlap } from 'lib/utils'
import { codeRefFromRange } from 'lang/std/artifactGraph'

beforeAll(async () => {
  await initPromise

  // THESE TEST WILL FAIL without VITE_KC_DEV_TOKEN set in .env.development.local
  await new Promise((resolve) => {
    engineCommandManager.start({
      token: VITE_KC_DEV_TOKEN,
      width: 256,
      height: 256,
      makeDefaultPlanes: () => makeDefaultPlanes(engineCommandManager),
      setMediaStream: () => {},
      setIsStreamReady: () => {},
      callbackOnEngineLiteConnect: () => {
        resolve(true)
      },
    })
  })
}, 30_000)

afterAll(() => {
  engineCommandManager.tearDown()
})

const runGetPathToExtrudeForSegmentSelectionTest = async (
  code: string,
  selectedSegmentSnippet: string,
  expectedExtrudeSnippet: string
) => {
  // helpers
  function getExtrudeExpression(
    ast: Program,
    pathToExtrudeNode: PathToNode
  ): CallExpression | PipeExpression | undefined | Error {
    if (pathToExtrudeNode.length === 0) return undefined // no extrude node

    const extrudeNodeResult = getNodeFromPath<CallExpression>(
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
  ): CallExpression | PipeExpression | Error {
    const extrudeRange: [number, number, boolean] = [
      code.indexOf(expectedExtrudeSnippet),
      code.indexOf(expectedExtrudeSnippet) + expectedExtrudeSnippet.length,
      true,
    ]
    const expectedExtrudePath = getNodePathFromSourceRange(ast, extrudeRange)
    const expectedExtrudeNodeResult = getNodeFromPath<
      VariableDeclarator | CallExpression
    >(ast, expectedExtrudePath)
    if (err(expectedExtrudeNodeResult)) {
      return expectedExtrudeNodeResult
    }
    const expectedExtrudeNode = expectedExtrudeNodeResult.node

    // check whether extrude is in the sketch pipe
    const extrudeInSketchPipe = expectedExtrudeNode.type === 'CallExpression'
    if (extrudeInSketchPipe) {
      return expectedExtrudeNode
    }
    if (!extrudeInSketchPipe) {
      const init = expectedExtrudeNode.init
      if (init.type !== 'CallExpression' && init.type !== 'PipeExpression') {
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

  // selection
  const segmentRange: [number, number, boolean] = [
    code.indexOf(selectedSegmentSnippet),
    code.indexOf(selectedSegmentSnippet) + selectedSegmentSnippet.length,
    true,
  ]
  const selection: Selection = {
    codeRef: codeRefFromRange(segmentRange, ast),
  }

  // executeAst and artifactGraph
  await kclManager.executeAst({ ast })
  const artifactGraph = engineCommandManager.artifactGraph

  // get extrude expression
  const pathResult = getPathToExtrudeForSegmentSelection(
    ast,
    selection,
    artifactGraph
  )
  if (err(pathResult)) return pathResult
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
    const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)`
    const selectedSegmentSnippet = `line([20, 0], %)`
    const expectedExtrudeSnippet = `extrude001 = extrude(-15, sketch001)`
    await runGetPathToExtrudeForSegmentSelectionTest(
      code,
      selectedSegmentSnippet,
      expectedExtrudeSnippet
    )
  }, 5_000)
  it('should return the correct paths when extrusion occurs within the sketch pipe', async () => {
    const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
  |> extrude(15, %)`
    const selectedSegmentSnippet = `line([20, 0], %)`
    const expectedExtrudeSnippet = `extrude(15, %)`
    await runGetPathToExtrudeForSegmentSelectionTest(
      code,
      selectedSegmentSnippet,
      expectedExtrudeSnippet
    )
  }, 5_000)
  it('should return the correct paths for a valid selection and extrusion in case of several extrusions and sketches', async () => {
    const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-30, 30], %)
  |> line([15, 0], %)
  |> line([0, -15], %)
  |> line([-15, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
sketch002 = startSketchOn('XY')
  |> startProfileAt([30, 30], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
sketch003 = startSketchOn('XY')
  |> startProfileAt([30, -30], %)
  |> line([25, 0], %)
  |> line([0, -25], %)
  |> line([-25, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
extrude002 = extrude(-15, sketch002)
extrude003 = extrude(-15, sketch003)`
    const selectedSegmentSnippet = `line([20, 0], %)`
    const expectedExtrudeSnippet = `extrude002 = extrude(-15, sketch002)`
    await runGetPathToExtrudeForSegmentSelectionTest(
      code,
      selectedSegmentSnippet,
      expectedExtrudeSnippet
    )
  })
  it('should not return any path for missing extrusion', async () => {
    const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-30, 30], %)
  |> line([15, 0], %)
  |> line([0, -15], %)
  |> line([-15, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
sketch002 = startSketchOn('XY')
  |> startProfileAt([30, 30], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
sketch003 = startSketchOn('XY')
  |> startProfileAt([30, -30], %)
  |> line([25, 0], %)
  |> line([0, -25], %)
  |> line([-25, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
extrude003 = extrude(-15, sketch003)`
    const selectedSegmentSnippet = `line([20, 0], %)`
    const expectedExtrudeSnippet = ``
    await runGetPathToExtrudeForSegmentSelectionTest(
      code,
      selectedSegmentSnippet,
      expectedExtrudeSnippet
    )
  }, 5_000)
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
  const segmentRanges: Array<[number, number, boolean]> = selectionSnippets.map(
    (selectionSnippet) => [
      code.indexOf(selectionSnippet),
      code.indexOf(selectionSnippet) + selectionSnippet.length,
      true,
    ]
  )

  // executeAst
  await kclManager.executeAst({ ast })
  const artifactGraph = engineCommandManager.artifactGraph

  const selection: Selections = {
    graphSelections: segmentRanges.map((segmentRange) => {
      const maybeArtifact = [...artifactGraph].find(([, a]) => {
        if (!('codeRef' in a)) return false
        return isOverlap(a.codeRef.range, segmentRange)
      })
      return {
        codeRef: codeRefFromRange(segmentRange, ast),
        artifact: maybeArtifact ? maybeArtifact[1] : undefined,
      }
    }),
    otherSelections: [],
  }

  // apply edge treatment to seleciton
  const result = modifyAstWithEdgeTreatmentAndTag(ast, selection, parameters)
  if (err(result)) {
    return result
  }
  const { modifiedAst } = result

  const newCode = recast(modifiedAst)

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
      return new Error(`Unsupported edge treatment type: ${edgeTreatmentType}`)
    }
    // run tests
    describe(`Testing modifyAstCloneWithEdgeTreatmentAndTag with ${edgeTreatmentType}s`, () => {
      it(`should add a ${edgeTreatmentType} to a specific segment`, async () => {
        const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)`
        const segmentSnippets = ['line([0, -20], %)']
        const expectedCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %, $seg01)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> ${edgeTreatmentType}({ ${parameterName} = 3, tags = [seg01] }, %)`

        await runModifyAstCloneWithEdgeTreatmentAndTag(
          code,
          segmentSnippets,
          parameters,
          expectedCode
        )
      })
      it(`should add a ${edgeTreatmentType} to the sketch pipe`, async () => {
        const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
  |> extrude(-15, %)`
        const segmentSnippets = ['line([0, -20], %)']
        const expectedCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %, $seg01)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
  |> extrude(-15, %)
  |> ${edgeTreatmentType}({ ${parameterName} = 3, tags = [seg01] }, %)`

        await runModifyAstCloneWithEdgeTreatmentAndTag(
          code,
          segmentSnippets,
          parameters,
          expectedCode
        )
      })
      it(`should add a ${edgeTreatmentType} to an already tagged segment`, async () => {
        const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %, $seg01)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)`
        const segmentSnippets = ['line([0, -20], %, $seg01)']
        const expectedCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %, $seg01)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> ${edgeTreatmentType}({ ${parameterName} = 3, tags = [seg01] }, %)`

        await runModifyAstCloneWithEdgeTreatmentAndTag(
          code,
          segmentSnippets,
          parameters,
          expectedCode
        )
      })
      it(`should add a ${edgeTreatmentType} with existing tag on other segment`, async () => {
        const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %, $seg01)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)`
        const segmentSnippets = ['line([-20, 0], %)']
        const expectedCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %, $seg01)
  |> line([0, -20], %)
  |> line([-20, 0], %, $seg02)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> ${edgeTreatmentType}({ ${parameterName} = 3, tags = [seg02] }, %)`

        await runModifyAstCloneWithEdgeTreatmentAndTag(
          code,
          segmentSnippets,
          parameters,
          expectedCode
        )
      })
      it(`should add a ${edgeTreatmentType} with existing fillet on other segment`, async () => {
        const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %, $seg01)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> fillet({ radius = 5, tags = [seg01] }, %)`
        const segmentSnippets = ['line([-20, 0], %)']
        const expectedCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %, $seg01)
  |> line([0, -20], %)
  |> line([-20, 0], %, $seg02)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> fillet({ radius = 5, tags = [seg01] }, %)
  |> ${edgeTreatmentType}({ ${parameterName} = 3, tags = [seg02] }, %)`

        await runModifyAstCloneWithEdgeTreatmentAndTag(
          code,
          segmentSnippets,
          parameters,
          expectedCode
        )
      })
      it(`should add a ${edgeTreatmentType} with existing chamfer on other segment`, async () => {
        const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %, $seg01)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> chamfer({ length = 5, tags = [seg01] }, %)`
        const segmentSnippets = ['line([-20, 0], %)']
        const expectedCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %, $seg01)
  |> line([0, -20], %)
  |> line([-20, 0], %, $seg02)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> chamfer({ length = 5, tags = [seg01] }, %)
  |> ${edgeTreatmentType}({ ${parameterName} = 3, tags = [seg02] }, %)`

        await runModifyAstCloneWithEdgeTreatmentAndTag(
          code,
          segmentSnippets,
          parameters,
          expectedCode
        )
      })
      it(`should add a ${edgeTreatmentType} to two segments of a single extrusion`, async () => {
        const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)`
        const segmentSnippets = ['line([20, 0], %)', 'line([-20, 0], %)']
        const expectedCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %, $seg01)
  |> line([0, -20], %)
  |> line([-20, 0], %, $seg02)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> ${edgeTreatmentType}({ ${parameterName} = 3, tags = [seg01, seg02] }, %)`

        await runModifyAstCloneWithEdgeTreatmentAndTag(
          code,
          segmentSnippets,
          parameters,
          expectedCode
        )
      })
      it(`should add ${edgeTreatmentType}s to two bodies`, async () => {
        const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
sketch002 = startSketchOn('XY')
  |> startProfileAt([30, 10], %)
  |> line([15, 0], %)
  |> line([0, -15], %)
  |> line([-15, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude002 = extrude(-25, sketch002)` // <--- body 2
        const segmentSnippets = [
          'line([20, 0], %)',
          'line([-20, 0], %)',
          'line([0, -15], %)',
        ]
        const expectedCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %, $seg01)
  |> line([0, -20], %)
  |> line([-20, 0], %, $seg02)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> ${edgeTreatmentType}({ ${parameterName} = 3, tags = [seg01, seg02] }, %)
sketch002 = startSketchOn('XY')
  |> startProfileAt([30, 10], %)
  |> line([15, 0], %)
  |> line([0, -15], %, $seg03)
  |> line([-15, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude002 = extrude(-25, sketch002)
  |> ${edgeTreatmentType}({ ${parameterName} = 3, tags = [seg03] }, %)` // <-- able to add a new one

        await runModifyAstCloneWithEdgeTreatmentAndTag(
          code,
          segmentSnippets,
          parameters,
          expectedCode
        )
      })
    })
  }
)

describe('Testing isTagUsedInEdgeTreatment', () => {
  const code = `sketch001 = startSketchOn('XZ')
  |> startProfileAt([7.72, 4.13], %)
  |> line([7.11, 3.48], %, $seg01)
  |> line([-3.29, -13.85], %)
  |> line([-6.37, 3.88], %, $seg02)
  |> close(%)
extrude001 = extrude(-5, sketch001)
  |> fillet({
       radius = 1.11,
       tags = [
         getOppositeEdge(seg01),
         seg01,
         getPreviousAdjacentEdge(seg02)
       ]
     }, %)
`
  it('should correctly identify getOppositeEdge and baseEdge edges', () => {
    const ast = assertParse(code)
    const lineOfInterest = `line([7.11, 3.48], %, $seg01)`
    const range: [number, number, boolean] = [
      code.indexOf(lineOfInterest),
      code.indexOf(lineOfInterest) + lineOfInterest.length,
      true,
    ]
    const pathToNode = getNodePathFromSourceRange(ast, range)
    if (err(pathToNode)) return
    const callExp = getNodeFromPath<CallExpression>(
      ast,
      pathToNode,
      'CallExpression'
    )
    if (err(callExp)) return
    const edges = isTagUsedInEdgeTreatment({ ast, callExp: callExp.node })
    expect(edges).toEqual(['getOppositeEdge', 'baseEdge'])
  })
  it('should correctly identify getPreviousAdjacentEdge edges', () => {
    const ast = assertParse(code)
    const lineOfInterest = `line([-6.37, 3.88], %, $seg02)`
    const range: [number, number, boolean] = [
      code.indexOf(lineOfInterest),
      code.indexOf(lineOfInterest) + lineOfInterest.length,
      true,
    ]
    const pathToNode = getNodePathFromSourceRange(ast, range)
    if (err(pathToNode)) return
    const callExp = getNodeFromPath<CallExpression>(
      ast,
      pathToNode,
      'CallExpression'
    )
    if (err(callExp)) return
    const edges = isTagUsedInEdgeTreatment({ ast, callExp: callExp.node })
    expect(edges).toEqual(['getPreviousAdjacentEdge'])
  })
  it('should correctly identify no edges', () => {
    const ast = assertParse(code)
    const lineOfInterest = `line([-3.29, -13.85], %)`
    const range: [number, number, boolean] = [
      code.indexOf(lineOfInterest),
      code.indexOf(lineOfInterest) + lineOfInterest.length,
      true,
    ]
    const pathToNode = getNodePathFromSourceRange(ast, range)
    if (err(pathToNode)) return
    const callExp = getNodeFromPath<CallExpression>(
      ast,
      pathToNode,
      'CallExpression'
    )
    if (err(callExp)) return
    const edges = isTagUsedInEdgeTreatment({ ast, callExp: callExp.node })
    expect(edges).toEqual([])
  })
})

describe('Testing button states', () => {
  const runButtonStateTest = async (
    code: string,
    segmentSnippet: string,
    expectedState: boolean
  ) => {
    const ast = assertParse(code)

    const range: [number, number, boolean] = segmentSnippet
      ? [
          code.indexOf(segmentSnippet),
          code.indexOf(segmentSnippet) + segmentSnippet.length,
          true,
        ]
      : [ast.end, ast.end, true] // empty line in the end of the code

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
    sketch001 = startSketchOn('XY')
      |> startProfileAt([-20, -5], %)
      |> line([0, 10], %)
      |> line([10, 0], %)
      |> line([0, -10], %)
      |> lineTo([profileStartX(%), profileStartY(%)], %)
      |> close(%)
    extrude001 = extrude(-10, sketch001)
  `
  const codeWithoutBodies: string = `
    sketch001 = startSketchOn('XY')
      |> startProfileAt([-20, -5], %)
      |> line([0, 10], %)
      |> line([10, 0], %)
      |> line([0, -10], %)
      |> lineTo([profileStartX(%), profileStartY(%)], %)
      |> close(%)
  `
  // body is missing
  it('should return false when body is missing and nothing is selected', async () => {
    await runButtonStateTest(codeWithoutBodies, '', false)
  })
  it('should return false when body is missing and segment is selected', async () => {
    await runButtonStateTest(codeWithoutBodies, `line([10, 0], %)`, false)
  })

  // body exists
  it('should return true when body exists and nothing is selected', async () => {
    await runButtonStateTest(codeWithBody, '', true)
  })
  it('should return true when body exists and segment is selected', async () => {
    await runButtonStateTest(codeWithBody, `line([10, 0], %)`, true)
  })
  it('should return false when body exists and not a segment is selected', async () => {
    await runButtonStateTest(codeWithBody, `close(%)`, false)
  })
})

// Test delete edge treatment
const runDeleteEdgeTreatmentTest = async (
  code: string,
  edgeTreatmentSnippet: string,
  expectedCode: string
) => {
  // ast
  const ast = assertParse(code)

  // selection
  const edgeTreatmentRange: [number, number, boolean] = [
    code.indexOf(edgeTreatmentSnippet),
    code.indexOf(edgeTreatmentSnippet) + edgeTreatmentSnippet.length,
    true,
  ]
  const selection: Selection = {
    codeRef: codeRefFromRange(edgeTreatmentRange, ast),
  }

  // executeAst
  await kclManager.executeAst({ ast })

  // apply edge treatment to seleciton
  const result = await deleteEdgeTreatment(ast, selection)
  if (err(result)) {
    return result
  }

  const newCode = recast(result)

  expect(newCode).toContain(expectedCode)
}
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
      return new Error(`Unsupported edge treatment type: ${edgeTreatmentType}`)
    }

    // run tests
    describe(`Testing deleteEdgeTreatment with a single ${edgeTreatmentType} in the extrude pipe`, () => {
      it(`should delete a ${edgeTreatmentType} from a specific segment`, async () => {
        const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %, $seg01)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> ${edgeTreatmentType}({ ${parameterName} = 3, tags = [seg01] }, %)`
        const edgeTreatmentSnippet = `${edgeTreatmentType}({ ${parameterName} = 3, tags = [seg01] }, %)`
        const expectedCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %, $seg01)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)`

        await runDeleteEdgeTreatmentTest(
          code,
          edgeTreatmentSnippet,
          expectedCode
        )
      })
    })
  }
)
