import { getNodePathFromSourceRange } from './abstractSyntaxTree'
import { lexer } from './tokeniser'
import { abstractSyntaxTree, getNodeFromPath } from './abstractSyntaxTree'

describe('testing getNodePathFromSourceRange', () => {
  it('test it gets the right path for a `lineTo` CallExpression within a SketchExpression', () => {
    const code = `
        const myVar = 5
        sketch sk3 {
            lineTo(1, 2)
            path yo = lineTo(3, 4)
            close()
        }
        `
    const subStr = 'lineTo(3, 4)'
    const lineToSubstringIndex = code.indexOf(subStr)
    const sourceRange: [number, number] = [
      lineToSubstringIndex,
      lineToSubstringIndex + subStr.length,
    ]

    const ast = abstractSyntaxTree(lexer(code))
    const nodePath = getNodePathFromSourceRange(ast, sourceRange)
    const node = getNodeFromPath(ast, nodePath)

    expect([node.start, node.end]).toEqual(sourceRange)
    expect(node.type).toBe('CallExpression')
  })
})
