import { getNodePathFromSourceRange, getNodeFromPath } from './queryAst'
import { lexer } from './tokeniser'
import { abstractSyntaxTree } from './abstractSyntaxTree'
import { initPromise } from './rust'

beforeAll(() => initPromise)

describe('testing getNodePathFromSourceRange', () => {
  it('test it gets the right path for a `lineTo` CallExpression within a SketchExpression', () => {
    const code = `
const myVar = 5
const sk3 = startSketchAt([0, 0])
  |> lineTo([1, 2], %)
  |> lineTo({ to: [3, 4], tag: 'yo' }, %)
  |> close(%)
`
    const subStr = "lineTo({ to: [3, 4], tag: 'yo' }, %)"
    const lineToSubstringIndex = code.indexOf(subStr)
    const sourceRange: [number, number] = [
      lineToSubstringIndex,
      lineToSubstringIndex + subStr.length,
    ]

    const ast = abstractSyntaxTree(lexer(code))
    const nodePath = getNodePathFromSourceRange(ast, sourceRange)
    const { node } = getNodeFromPath<any>(ast, nodePath)

    expect([node.start, node.end]).toEqual(sourceRange)
    expect(node.type).toBe('CallExpression')
  })
})
