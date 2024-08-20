import {
  parse,
  recast,
  initPromise,
  PathToNode,
  Expr,
  Program,
  CallExpression,
  makeDefaultPlanes,
  PipeExpression,
  VariableDeclaration,
} from '../wasm'
import {
  addFillet,
  getPathToExtrudeForSegmentSelection,
  hasValidFilletSelection,
  isTagUsedInFillet,
} from './addFillet'
import { getNodeFromPath, getNodePathFromSourceRange } from '../queryAst'
import { createLiteral } from 'lang/modifyAst'
import { err } from 'lib/trap'
import { Selections } from 'lib/selections'
import { engineCommandManager, kclManager } from 'lib/singletons'
import { VITE_KC_DEV_TOKEN } from 'env'

beforeAll(async () => {
  await initPromise

  // THESE TEST WILL FAIL without VITE_KC_DEV_TOKEN set in .env.development.local
  await new Promise((resolve) => {
    engineCommandManager.start({
      // disableWebRTC: true,
      token: VITE_KC_DEV_TOKEN,
      // there does seem to be a minimum resolution, not sure what it is but 256 works ok.
      width: 256,
      height: 256,
      // executeCode: () => {},
      makeDefaultPlanes: () => makeDefaultPlanes(engineCommandManager),
      setMediaStream: () => {},
      setIsStreamReady: () => {},
      modifyGrid: async () => {},
      callbackOnEngineLiteConnect: async () => {
        resolve(true)
      },
    })
  })
  // await engineCommandManager.waitForReady
}, 20_000)

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

    const extrudeNodeResult = getNodeFromPath(ast, pathToExtrudeNode)
    if (err(extrudeNodeResult)) {
      return extrudeNodeResult
    }
    return extrudeNodeResult.node as CallExpression | PipeExpression
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
    const expedtedExtrudeNodeResult = getNodeFromPath(ast, expedtedExtrudePath)
    if (err(expedtedExtrudeNodeResult)) {
      return expedtedExtrudeNodeResult
    }
    const expectedExtrudeNode =
      expedtedExtrudeNodeResult.node as VariableDeclaration
    return expectedExtrudeNode.declarations[0].init as
      | CallExpression
      | PipeExpression
  }

  // ast
  const astOrError = parse(code)
  if (err(astOrError)) return new Error('AST not found')
  const ast = astOrError as Program

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

  // programMemory and artifactGraph
  await kclManager.executeAst(ast)
  const programMemory = kclManager.programMemory
  const artifactGraph = engineCommandManager.artifactGraph

  // get extrude expression
  const pathResult = getPathToExtrudeForSegmentSelection(
    ast,
    selection,
    programMemory,
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
    const code = `const sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, 10], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(-15, sketch001)`
    const selectedSegmentSnippet = `line([20, 0], %)`
    const expectedExtrudeSnippet = `const extrude001 = extrude(-15, sketch001)`
    await runGetPathToExtrudeForSegmentSelectionTest(
      code,
      selectedSegmentSnippet,
      expectedExtrudeSnippet
    )
  })
  it('should return the correct paths for a valid selection and extrusion in case of several extrusions and sketches', async () => {
    const code = `const sketch001 = startSketchOn('XY')
  |> startProfileAt([-30, 30], %)
  |> line([15, 0], %)
  |> line([0, -15], %)
  |> line([-15, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const sketch002 = startSketchOn('XY')
  |> startProfileAt([30, 30], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const sketch003 = startSketchOn('XY')
  |> startProfileAt([30, -30], %)
  |> line([25, 0], %)
  |> line([0, -25], %)
  |> line([-25, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(-15, sketch001)
const extrude002 = extrude(-15, sketch002)
const extrude003 = extrude(-15, sketch003)`
    const selectedSegmentSnippet = `line([20, 0], %)`
    const expectedExtrudeSnippet = `const extrude002 = extrude(-15, sketch002)`
    await runGetPathToExtrudeForSegmentSelectionTest(
      code,
      selectedSegmentSnippet,
      expectedExtrudeSnippet
    )
  })
  it('should not return any path for missing extrusion', async () => {
    const code = `const sketch001 = startSketchOn('XY')
  |> startProfileAt([-30, 30], %)
  |> line([15, 0], %)
  |> line([0, -15], %)
  |> line([-15, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const sketch002 = startSketchOn('XY')
  |> startProfileAt([30, 30], %)
  |> line([20, 0], %)
  |> line([0, -20], %)
  |> line([-20, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const sketch003 = startSketchOn('XY')
  |> startProfileAt([30, -30], %)
  |> line([25, 0], %)
  |> line([0, -25], %)
  |> line([-25, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(-15, sketch001)
const extrude003 = extrude(-15, sketch003)`
    const selectedSegmentSnippet = `line([20, 0], %)`
    const expectedExtrudeSnippet = ``
    await runGetPathToExtrudeForSegmentSelectionTest(
      code,
      selectedSegmentSnippet,
      expectedExtrudeSnippet
    )
  })
})

const runFilletTest = async (
  code: string,
  segmentSnippet: string,
  extrudeSnippet: string,
  radius = createLiteral(5) as Expr,
  expectedCode: string
) => {
  const astOrError = parse(code)
  if (err(astOrError)) {
    return new Error('AST not found')
  }

  const ast = astOrError as Program

  const segmentRange: [number, number] = [
    code.indexOf(segmentSnippet),
    code.indexOf(segmentSnippet) + segmentSnippet.length,
  ]
  const pathToSegmentNode: PathToNode = getNodePathFromSourceRange(
    ast,
    segmentRange
  )

  const extrudeRange: [number, number] = [
    code.indexOf(extrudeSnippet),
    code.indexOf(extrudeSnippet) + extrudeSnippet.length,
  ]

  const pathToExtrudeNode: PathToNode = getNodePathFromSourceRange(
    ast,
    extrudeRange
  )
  if (err(pathToExtrudeNode)) {
    return new Error('Path to extrude node not found')
  }

  const result = addFillet(ast, pathToSegmentNode, pathToExtrudeNode, radius)
  if (err(result)) {
    return result
  }
  const { modifiedAst } = result
  const newCode = recast(modifiedAst)

  expect(newCode).toContain(expectedCode)
}
describe('Testing addFillet', () => {
  /**
   * 1. Ideal Case
   */

  it('should add a fillet to a specific segment after extrusion, clean', async () => {
    const code = `
      const sketch001 = startSketchOn('XZ')
        |> startProfileAt([2.16, 49.67], %)
        |> line([101.49, 139.93], %)
        |> line([60.04, -55.72], %)
        |> line([1.29, -115.74], %)
        |> line([-87.24, -47.08], %)
        |> tangentialArcTo([56.15, -94.58], %)
        |> tangentialArcTo([14.68, -104.52], %)
        |> lineTo([profileStartX(%), profileStartY(%)], %)
        |> close(%)
      const extrude001 = extrude(50, sketch001)
    `
    const segmentSnippet = `line([60.04, -55.72], %)`
    const extrudeSnippet = `const extrude001 = extrude(50, sketch001)`
    const radius = createLiteral(5) as Expr
    const expectedCode = `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([2.16, 49.67], %)
  |> line([101.49, 139.93], %)
  |> line([60.04, -55.72], %, $seg01)
  |> line([1.29, -115.74], %)
  |> line([-87.24, -47.08], %)
  |> tangentialArcTo([56.15, -94.58], %)
  |> tangentialArcTo([14.68, -104.52], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(50, sketch001)
  |> fillet({ radius: 5, tags: [seg01] }, %)`

    await runFilletTest(
      code,
      segmentSnippet,
      extrudeSnippet,
      radius,
      expectedCode
    )
  })

  /**
   * 2. Case of existing tag in the other line
   */

  it('should add a fillet to a specific segment after extrusion with existing tag in any other line', async () => {
    const code = `
        const sketch001 = startSketchOn('XZ')
          |> startProfileAt([2.16, 49.67], %)
          |> line([101.49, 139.93], %)
          |> line([60.04, -55.72], %)
          |> line([1.29, -115.74], %)
          |> line([-87.24, -47.08], %, $seg01)
          |> tangentialArcTo([56.15, -94.58], %)
          |> tangentialArcTo([14.68, -104.52], %)
          |> lineTo([profileStartX(%), profileStartY(%)], %)
          |> close(%)
        const extrude001 = extrude(50, sketch001)
      `
    const segmentSnippet = `line([60.04, -55.72], %)`
    const extrudeSnippet = `const extrude001 = extrude(50, sketch001)`
    const radius = createLiteral(5) as Expr
    const expectedCode = `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([2.16, 49.67], %)
  |> line([101.49, 139.93], %)
  |> line([60.04, -55.72], %, $seg02)
  |> line([1.29, -115.74], %)
  |> line([-87.24, -47.08], %, $seg01)
  |> tangentialArcTo([56.15, -94.58], %)
  |> tangentialArcTo([14.68, -104.52], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(50, sketch001)
  |> fillet({ radius: 5, tags: [seg02] }, %)`

    await runFilletTest(
      code,
      segmentSnippet,
      extrudeSnippet,
      radius,
      expectedCode
    )
  })

  /**
   * 3. Case of existing tag in the fillet line
   */

  it('should add a fillet to a specific segment after extrusion with existing tag in that exact line', async () => {
    const code = `
        const sketch001 = startSketchOn('XZ')
          |> startProfileAt([2.16, 49.67], %)
          |> line([101.49, 139.93], %)
          |> line([60.04, -55.72], %)
          |> line([1.29, -115.74], %)
          |> line([-87.24, -47.08], %, $seg03)
          |> tangentialArcTo([56.15, -94.58], %)
          |> tangentialArcTo([14.68, -104.52], %)
          |> lineTo([profileStartX(%), profileStartY(%)], %)
          |> close(%)
        const extrude001 = extrude(50, sketch001)
      `
    const segmentSnippet = `line([-87.24, -47.08], %, $seg03)`
    const extrudeSnippet = `const extrude001 = extrude(50, sketch001)`
    const radius = createLiteral(5) as Expr
    const expectedCode = `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([2.16, 49.67], %)
  |> line([101.49, 139.93], %)
  |> line([60.04, -55.72], %)
  |> line([1.29, -115.74], %)
  |> line([-87.24, -47.08], %, $seg03)
  |> tangentialArcTo([56.15, -94.58], %)
  |> tangentialArcTo([14.68, -104.52], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(50, sketch001)
  |> fillet({ radius: 5, tags: [seg03] }, %)`

    await runFilletTest(
      code,
      segmentSnippet,
      extrudeSnippet,
      radius,
      expectedCode
    )
  })

  /**
   * 4. Case of existing fillet on some other segment
   */

  it('should add another fillet after the existing fillet', async () => {
    const code = `const sketch001 = startSketchOn('XZ')
            |> startProfileAt([2.16, 49.67], %)
            |> line([101.49, 139.93], %)
            |> line([60.04, -55.72], %)
            |> line([1.29, -115.74], %)
            |> line([-87.24, -47.08], %, $seg03)
            |> tangentialArcTo([56.15, -94.58], %)
            |> tangentialArcTo([14.68, -104.52], %)
            |> lineTo([profileStartX(%), profileStartY(%)], %)
            |> close(%)
          const extrude001 = extrude(50, sketch001)
            |> fillet({ radius: 10, tags: [seg03] }, %)`
    const segmentSnippet = `line([60.04, -55.72], %)`
    const extrudeSnippet = `const extrude001 = extrude(50, sketch001)`
    const radius = createLiteral(5) as Expr
    const expectedCode = `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([2.16, 49.67], %)
  |> line([101.49, 139.93], %)
  |> line([60.04, -55.72], %, $seg01)
  |> line([1.29, -115.74], %)
  |> line([-87.24, -47.08], %, $seg03)
  |> tangentialArcTo([56.15, -94.58], %)
  |> tangentialArcTo([14.68, -104.52], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(50, sketch001)
  |> fillet({ radius: 10, tags: [seg03] }, %)
  |> fillet({ radius: 5, tags: [seg01] }, %)`

    await runFilletTest(
      code,
      segmentSnippet,
      extrudeSnippet,
      radius,
      expectedCode
    )
  })
})

describe('Testing isTagUsedInFillet', () => {
  const code = `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([7.72, 4.13], %)
  |> line([7.11, 3.48], %, $seg01)
  |> line([-3.29, -13.85], %)
  |> line([-6.37, 3.88], %, $seg02)
  |> close(%)
const extrude001 = extrude(-5, sketch001)
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
    const ast = astOrError as Program

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
    const sketch001 = startSketchOn('XY')
      |> startProfileAt([-20, -5], %)
      |> line([0, 10], %)
      |> line([10, 0], %)
      |> line([0, -10], %)
      |> lineTo([profileStartX(%), profileStartY(%)], %)
      |> close(%)
    const extrude001 = extrude(-10, sketch001)
  `
  const codeWithoutBodies: string = `
    const sketch001 = startSketchOn('XY')
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
  it('hould return false when body exists and not a segment is selected', async () => {
    await runButtonStateTest(codeWithBody, `close(%)`, false)
  })
})
