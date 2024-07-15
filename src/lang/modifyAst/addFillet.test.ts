import {
  parse,
  recast,
  initPromise,
  PathToNode,
  Value,
  Program,
  CallExpression,
} from '../wasm'
import { addFillet, isTagUsedInFillet } from './addFillet'
import { getNodeFromPath, getNodePathFromSourceRange } from '../queryAst'
import { createLiteral } from 'lang/modifyAst'
import { err } from 'lib/trap'

beforeAll(async () => {
  await initPromise // Initialize the WASM environment before running tests
})

const runFilletTest = async (
  code: string,
  segmentSnippet: string,
  extrudeSnippet: string,
  radius = createLiteral(5) as Value,
  expectedCode: string
) => {
  const astOrError = parse(code)
  if (astOrError instanceof Error) {
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
  if (pathToExtrudeNode instanceof Error) {
    return new Error('Path to extrude node not found')
  }

  // const radius = createLiteral(5) as Value

  const result = addFillet(ast, pathToSegmentNode, pathToExtrudeNode, radius)
  if (result instanceof Error) {
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
    const radius = createLiteral(5) as Value
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
    const radius = createLiteral(5) as Value
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
    const radius = createLiteral(5) as Value
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
    const radius = createLiteral(5) as Value
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
         getOppositeEdge(seg01, %),
         seg01,
         getPreviousAdjacentEdge(seg02, %)
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
