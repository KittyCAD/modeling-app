import {
  createLiteral,
  createIdentifier,
  createCallExpression,
  createObjectExpression,
  createArrayExpression,
  createPipeSubstitution,
  createVariableDeclaration,
  createPipeExpression,
  findUniqueName,
  addSketchTo,
} from './modifyAst'
import { recast } from './recast'

describe('Testing createLiteral', () => {
  it('should create a literal', () => {
    const result = createLiteral(5)
    expect(result.type).toBe('Literal')
    expect(result.value).toBe(5)
  })
})
describe('Testing createIdentifier', () => {
  it('should create an identifier', () => {
    const result = createIdentifier('myVar')
    expect(result.type).toBe('Identifier')
    expect(result.name).toBe('myVar')
  })
})
describe('Testing createCallExpression', () => {
  it('should create a call expression', () => {
    const result = createCallExpression('myFunc', [createLiteral(5)])
    expect(result.type).toBe('CallExpression')
    expect(result.callee.type).toBe('Identifier')
    expect(result.callee.name).toBe('myFunc')
    expect(result.arguments[0].type).toBe('Literal')
    expect((result.arguments[0] as any).value).toBe(5)
  })
})
describe('Testing createObjectExpression', () => {
  it('should create an object expression', () => {
    const result = createObjectExpression({
      myProp: createLiteral(5),
    })
    expect(result.type).toBe('ObjectExpression')
    expect(result.properties[0].type).toBe('ObjectProperty')
    expect(result.properties[0].key.name).toBe('myProp')
    expect(result.properties[0].value.type).toBe('Literal')
    expect((result.properties[0].value as any).value).toBe(5)
  })
})
describe('Testing createArrayExpression', () => {
  it('should create an array expression', () => {
    const result = createArrayExpression([createLiteral(5)])
    expect(result.type).toBe('ArrayExpression')
    expect(result.elements[0].type).toBe('Literal')
    expect((result.elements[0] as any).value).toBe(5)
  })
})
describe('Testing createPipeSubstitution', () => {
  it('should create a pipe substitution', () => {
    const result = createPipeSubstitution()
    expect(result.type).toBe('PipeSubstitution')
  })
})
describe('Testing createVariableDeclaration', () => {
  it('should create a variable declaration', () => {
    const result = createVariableDeclaration('myVar', createLiteral(5))
    expect(result.type).toBe('VariableDeclaration')
    expect(result.declarations[0].type).toBe('VariableDeclarator')
    expect(result.declarations[0].id.type).toBe('Identifier')
    expect(result.declarations[0].id.name).toBe('myVar')
    expect(result.declarations[0].init.type).toBe('Literal')
    expect((result.declarations[0].init as any).value).toBe(5)
  })
})
describe('Testing createPipeExpression', () => {
  it('should create a pipe expression', () => {
    const result = createPipeExpression([createLiteral(5)])
    expect(result.type).toBe('PipeExpression')
    expect(result.body[0].type).toBe('Literal')
    expect((result.body[0] as any).value).toBe(5)
  })
})

describe('Testing findUniqueName', () => {
  it('should find a unique name', () => {
    const result = findUniqueName(
      'yo01 yo02 yo03 yo04 yo05 yo06 yo07 yo08 yo09',
      'yo',
      2
    )
    expect(result).toBe('yo10')
  })
})
describe('Testing addSketchTo', () => {
  it('should add a sketch to a program', () => {
    const result = addSketchTo(
      {
        type: 'Program',
        body: [],
        start: 0,
        end: 0,
        nonCodeMeta: {},
      },
      'yz'
    )
    const str = recast(result.modifiedAst)
    expect(str).toBe(`const part001 = startSketchAt([0, 0])
  |> ry(90, %)
  |> lineTo([1, 1], %)
show(part001)`)
  })
})
