import { abstractSyntaxTree } from './abstractSyntaxTree'
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
  giveSketchFnCallTag,
  moveValueIntoNewVariable,
} from './modifyAst'
import { recast } from './recast'
import { lexer } from './tokeniser'
import { initPromise } from './rust'
import { executor } from '../lib/testHelpers'

beforeAll(() => initPromise)

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
    expect(str).toBe(`const part001 = startSketchAt('default')
  |> ry(90, %)
  |> line('default', %)
show(part001)`)
  })
})

function giveSketchFnCallTagTestHelper(
  code: string,
  searchStr: string
): { tag: string; newCode: string; isTagExisting: boolean } {
  // giveSketchFnCallTag inputs and outputs an ast, which is very verbose for testing
  // this wrapper changes the input and output to code
  // making it more of an integration test, but easier to read the test intention is the goal
  const ast = abstractSyntaxTree(lexer(code))
  const start = code.indexOf(searchStr)
  const range: [number, number] = [start, start + searchStr.length]
  const { modifiedAst, tag, isTagExisting } = giveSketchFnCallTag(ast, range)
  const newCode = recast(modifiedAst)
  return { tag, newCode, isTagExisting }
}

describe('Testing giveSketchFnCallTag', () => {
  const code = `const part001 = startSketchAt([0, 0])
|> line([-2.57, -0.13], %)
|> line([0, 0.83], %)
|> line([0.82, 0.34], %)
show(part001)`
  it('Should add tag to a sketch function call', () => {
    const { newCode, tag, isTagExisting } = giveSketchFnCallTagTestHelper(
      code,
      'line([0, 0.83], %)'
    )
    expect(newCode).toContain("line({ to: [0, 0.83], tag: 'seg01' }, %)")
    expect(tag).toBe('seg01')
    expect(isTagExisting).toBe(false)
  })
  it('Should create a unique tag if seg01 already exists', () => {
    let _code = code.replace(
      'line([-2.57, -0.13], %)',
      "line({ to: [-2.57, -0.13], tag: 'seg01' }, %)"
    )
    const { newCode, tag, isTagExisting } = giveSketchFnCallTagTestHelper(
      _code,
      'line([0, 0.83], %)'
    )
    expect(newCode).toContain("line({ to: [0, 0.83], tag: 'seg02' }, %)")
    expect(tag).toBe('seg02')
    expect(isTagExisting).toBe(false)
  })
  it('Should return existing tag if it already exists', () => {
    const lineButWithTag = "line({ to: [-2.57, -0.13], tag: 'butts' }, %)"
    let _code = code.replace('line([-2.57, -0.13], %)', lineButWithTag)
    const { newCode, tag, isTagExisting } = giveSketchFnCallTagTestHelper(
      _code,
      lineButWithTag
    )
    expect(newCode).toContain(lineButWithTag) // no change
    expect(tag).toBe('butts')
    expect(isTagExisting).toBe(true)
  })
})

describe('Testing moveValueIntoNewVariable', () => {
  const fn = (fnName: string) => `const ${fnName} = (x) => {
  return x
}
`
  const code = `${fn('def')}${fn('ghi')}${fn('jkl')}${fn('hmm')}
const abc = 3
const identifierGuy = 5
const part001 = startSketchAt([-1.2, 4.83])
|> line([2.8, 0], %)
|> angledLine([100 + 100, 3.09], %)
|> angledLine([abc, 3.09], %)
|> angledLine([def('yo'), 3.09], %)
|> angledLine([ghi(%), 3.09], %)
|> angledLine([jkl('yo') + 2, 3.09], %)
const yo = 5 + 6
const yo2 = hmm([identifierGuy + 5])
show(part001)`
  it('should move a value into a new variable', async () => {
    const ast = abstractSyntaxTree(lexer(code))
    const programMemory = await executor(ast)
    const startIndex = code.indexOf('100 + 100') + 1
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      programMemory,
      [startIndex, startIndex],
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`const newVar = 100 + 100`)
    expect(newCode).toContain(`angledLine([newVar, 3.09], %)`)
  })
  it('should move a value into a new variable', async () => {
    const ast = abstractSyntaxTree(lexer(code))
    const programMemory = await executor(ast)
    const startIndex = code.indexOf('2.8') + 1
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      programMemory,
      [startIndex, startIndex],
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`const newVar = 2.8`)
    expect(newCode).toContain(`line([newVar, 0], %)`)
  })
  it('should move a value into a new variable', async () => {
    const ast = abstractSyntaxTree(lexer(code))
    const programMemory = await executor(ast)
    const startIndex = code.indexOf('def(')
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      programMemory,
      [startIndex, startIndex],
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`const newVar = def('yo')`)
    expect(newCode).toContain(`angledLine([newVar, 3.09], %)`)
  })
  it('should move a value into a new variable', async () => {
    const ast = abstractSyntaxTree(lexer(code))
    const programMemory = await executor(ast)
    const startIndex = code.indexOf('jkl(') + 1
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      programMemory,
      [startIndex, startIndex],
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`const newVar = jkl('yo') + 2`)
    expect(newCode).toContain(`angledLine([newVar, 3.09], %)`)
  })
  it('should move a value into a new variable', async () => {
    const ast = abstractSyntaxTree(lexer(code))
    const programMemory = await executor(ast)
    const startIndex = code.indexOf('identifierGuy +') + 1
    const { modifiedAst } = moveValueIntoNewVariable(
      ast,
      programMemory,
      [startIndex, startIndex],
      'newVar'
    )
    const newCode = recast(modifiedAst)
    expect(newCode).toContain(`const newVar = identifierGuy + 5`)
    expect(newCode).toContain(`const yo2 = hmm([newVar])`)
  })
})
