import {
  parse,
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
  getPathToExtrudeForSegmentSelection,
  hasValidFilletSelection,
  isTagUsedInFillet,
  modifyAstCloneWithFilletAndTag,
} from './addFillet'
import { getNodeFromPath, getNodePathFromSourceRange } from '../queryAst'
import { createLiteral } from 'lang/modifyAst'
import { err } from 'lib/trap'
import { Selections } from 'lib/selections'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { VITE_KC_DEV_TOKEN } from 'env'
import { KclCommandValue } from 'lib/commandTypes'

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
      modifyGrid: async () => {},
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
    const extrudeRange: [number, number] = [
      code.indexOf(expectedExtrudeSnippet),
      code.indexOf(expectedExtrudeSnippet) + expectedExtrudeSnippet.length,
    ]
    const expedtedExtrudePath = getNodePathFromSourceRange(ast, extrudeRange)
    const expedtedExtrudeNodeResult = getNodeFromPath<VariableDeclarator>(
      ast,
      expedtedExtrudePath
    )
    if (err(expedtedExtrudeNodeResult)) {
      return expedtedExtrudeNodeResult
    }
    const expectedExtrudeNode = expedtedExtrudeNodeResult.node
    const init = expectedExtrudeNode.init
    if (init.type !== 'CallExpression' && init.type !== 'PipeExpression') {
      return new Error(
        'Expected extrude expression is not a CallExpression or PipeExpression'
      )
    }
    return init
  }

  // ast
  const astOrError = parse(code)
  if (err(astOrError)) return new Error('AST not found')
  const ast = astOrError

  // selection
  const segmentRange: [number, number] = [
    code.indexOf(selectedSegmentSnippet),
    code.indexOf(selectedSegmentSnippet) + selectedSegmentSnippet.length,
  ]
  const selection: Selections = {
    codeBasedSelections: [
      {
        range: segmentRange,
        type: 'default',
      },
    ],
    otherSelections: [],
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
  })
})

const runModifyAstCloneWithFilletAndTag = async (
  code: string,
  selectionSnippets: Array<string>,
  radiusValue: number,
  expectedCode: string
) => {
  // ast
  const astOrError = parse(code)
  if (err(astOrError)) {
    return new Error('AST not found')
  }
  const ast = astOrError

  // selection
  const segmentRanges: Array<[number, number]> = selectionSnippets.map(
    (selectionSnippet) => [
      code.indexOf(selectionSnippet),
      code.indexOf(selectionSnippet) + selectionSnippet.length,
    ]
  )
  const selection: Selections = {
    codeBasedSelections: segmentRanges.map((segmentRange) => ({
      range: segmentRange,
      type: 'default',
    })),
    otherSelections: [],
  }

  // radius
  const radius: KclCommandValue = {
    valueAst: createLiteral(radiusValue),
    valueText: radiusValue.toString(),
    valueCalculated: radiusValue.toString(),
  }

  // executeAst
  await kclManager.executeAst({ ast })

  // apply fillet to selection
  const result = modifyAstCloneWithFilletAndTag(ast, selection, radius)
  if (err(result)) {
    return result
  }
  const { modifiedAst } = result

  const newCode = recast(modifiedAst)

  expect(newCode).toContain(expectedCode)
}
describe('Testing applyFilletToSelection', () => {
  it('should add a fillet to a specific segment', async () => {
    const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)`
    const segmentSnippets = ['line([0, -20], %)']
    const radiusValue = 3
    const expectedCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %, $seg01)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> fillet({ radius: 3, tags: [seg01] }, %)`

    await runModifyAstCloneWithFilletAndTag(
      code,
      segmentSnippets,
      radiusValue,
      expectedCode
    )
  })
  it('should add a fillet to an already tagged segment', async () => {
    const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %, $seg01)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)`
    const segmentSnippets = ['line([0, -20], %, $seg01)']
    const radiusValue = 3
    const expectedCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %, $seg01)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> fillet({ radius: 3, tags: [seg01] }, %)`

    await runModifyAstCloneWithFilletAndTag(
      code,
      segmentSnippets,
      radiusValue,
      expectedCode
    )
  })
  it('should add a fillet with existing tag on other segment', async () => {
    const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %, $seg01)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)`
    const segmentSnippets = ['line([-20, 0], %)']
    const radiusValue = 3
    const expectedCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %, $seg01)
  |> line([0, -20], %)
  |> line([-20, 0], %, $seg02)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> fillet({ radius: 3, tags: [seg02] }, %)`

    await runModifyAstCloneWithFilletAndTag(
      code,
      segmentSnippets,
      radiusValue,
      expectedCode
    )
  })
  it('should add a fillet with existing fillet on other segment', async () => {
    const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %, $seg01)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> fillet({ radius: 5, tags: [seg01] }, %)`
    const segmentSnippets = ['line([-20, 0], %)']
    const radiusValue = 3
    const expectedCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %, $seg01)
  |> line([0, -20], %)
  |> line([-20, 0], %, $seg02)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> fillet({ radius: 5, tags: [seg01] }, %)
  |> fillet({ radius: 3, tags: [seg02] }, %)`

    await runModifyAstCloneWithFilletAndTag(
      code,
      segmentSnippets,
      radiusValue,
      expectedCode
    )
  })
  it('should add a fillet to two segments of a single extrusion', async () => {
    const code = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)`
    const segmentSnippets = ['line([20, 0], %)', 'line([-20, 0], %)']
    const radiusValue = 3
    const expectedCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %, $seg01)
  |> line([0, -20], %)
  |> line([-20, 0], %, $seg02)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> fillet({ radius: 3, tags: [seg01, seg02] }, %)`

    await runModifyAstCloneWithFilletAndTag(
      code,
      segmentSnippets,
      radiusValue,
      expectedCode
    )
  })
  it('should add fillets to two bodies', async () => {
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
    const radiusValue = 3
    const expectedCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %, $seg01)
  |> line([0, -20], %)
  |> line([-20, 0], %, $seg02)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(-15, sketch001)
  |> fillet({ radius: 3, tags: [seg01, seg02] }, %)
sketch002 = startSketchOn('XY')
  |> startProfileAt([30, 10], %)
  |> line([15, 0], %)
  |> line([0, -15], %, $seg03)
  |> line([-15, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude002 = extrude(-25, sketch002)
  |> fillet({ radius: 3, tags: [seg03] }, %)` // <-- able to add a new one

    await runModifyAstCloneWithFilletAndTag(
      code,
      segmentSnippets,
      radiusValue,
      expectedCode
    )
  })
})

describe('Testing isTagUsedInFillet', () => {
  const code = `sketch001 = startSketchOn('XZ')
  |> startProfileAt([7.72, 4.13], %)
  |> line([7.11, 3.48], %, $seg01)
  |> line([-3.29, -13.85], %)
  |> line([-6.37, 3.88], %, $seg02)
  |> close(%)
extrude001 = extrude(-5, sketch001)
  |> fillet({
       radius: 1.11,
       tags: [
         getOppositeEdge(seg01),
         seg01,
         getPreviousAdjacentEdge(seg02)
       ]
     }, %)
`
  it('should correctly identify getOppositeEdge and baseEdge edges', () => {
    const ast = parse(code)
    if (err(ast)) return
    const lineOfInterest = `line([7.11, 3.48], %, $seg01)`
    const range: [number, number] = [
      code.indexOf(lineOfInterest),
      code.indexOf(lineOfInterest) + lineOfInterest.length,
    ]
    const pathToNode = getNodePathFromSourceRange(ast, range)
    if (err(pathToNode)) return
    const callExp = getNodeFromPath<CallExpression>(
      ast,
      pathToNode,
      'CallExpression'
    )
    if (err(callExp)) return
    const edges = isTagUsedInFillet({ ast, callExp: callExp.node })
    expect(edges).toEqual(['getOppositeEdge', 'baseEdge'])
  })
  it('should correctly identify getPreviousAdjacentEdge edges', () => {
    const ast = parse(code)
    if (err(ast)) return
    const lineOfInterest = `line([-6.37, 3.88], %, $seg02)`
    const range: [number, number] = [
      code.indexOf(lineOfInterest),
      code.indexOf(lineOfInterest) + lineOfInterest.length,
    ]
    const pathToNode = getNodePathFromSourceRange(ast, range)
    if (err(pathToNode)) return
    const callExp = getNodeFromPath<CallExpression>(
      ast,
      pathToNode,
      'CallExpression'
    )
    if (err(callExp)) return
    const edges = isTagUsedInFillet({ ast, callExp: callExp.node })
    expect(edges).toEqual(['getPreviousAdjacentEdge'])
  })
  it('should correctly identify no edges', () => {
    const ast = parse(code)
    if (err(ast)) return
    const lineOfInterest = `line([-3.29, -13.85], %)`
    const range: [number, number] = [
      code.indexOf(lineOfInterest),
      code.indexOf(lineOfInterest) + lineOfInterest.length,
    ]
    const pathToNode = getNodePathFromSourceRange(ast, range)
    if (err(pathToNode)) return
    const callExp = getNodeFromPath<CallExpression>(
      ast,
      pathToNode,
      'CallExpression'
    )
    if (err(callExp)) return
    const edges = isTagUsedInFillet({ ast, callExp: callExp.node })
    expect(edges).toEqual([])
  })
})

describe('Testing button states', () => {
  const runButtonStateTest = async (
    code: string,
    segmentSnippet: string,
    expectedState: boolean
  ) => {
    // ast
    const astOrError = parse(code)
    if (err(astOrError)) {
      return new Error('AST not found')
    }
    const ast = astOrError

    // selectionRanges
    const range: [number, number] = segmentSnippet
      ? [
          code.indexOf(segmentSnippet),
          code.indexOf(segmentSnippet) + segmentSnippet.length,
        ]
      : [ast.end, ast.end] // empty line in the end of the code

    const selectionRanges: Selections = {
      codeBasedSelections: [
        {
          range,
          type: 'default',
        },
      ],
      otherSelections: [],
    }

    // state
    const buttonState = hasValidFilletSelection({
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
