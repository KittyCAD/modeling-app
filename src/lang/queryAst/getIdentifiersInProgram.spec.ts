import { getIdentifiersInProgram } from '@src/lang/queryAst/getIndentifiersInProgram'
import { assertParse } from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'

function identifier(name: string, start: number, end: number) {
  return {
    type: 'Name',
    start,
    end,
    moduleId: 0,
    commentStart: start,

    abs_path: false,
    path: [],
    name: {
      start,
      end,
      moduleId: 0,
      commentStart: start,
      type: 'Identifier',
      name,
    },
  }
}

beforeAll(async () => {
  await initPromise
})

describe(`getIdentifiersInProgram`, () => {
  it(`finds no identifiers in an empty program`, () => {
    const identifiers = getIdentifiersInProgram(assertParse(''))
    expect(identifiers).toEqual([])
  })
  it(`finds a single identifier in an expression`, () => {
    const identifiers = getIdentifiersInProgram(assertParse('55 + a'))
    expect(identifiers).toEqual([identifier('a', 5, 6)])
  })
  it(`finds multiple identifiers in an expression`, () => {
    const identifiers = getIdentifiersInProgram(assertParse('a + b + c'))
    expect(identifiers).toEqual([
      identifier('a', 0, 1),
      identifier('b', 4, 5),
      identifier('c', 8, 9),
    ])
  })
  it(`finds all the identifiers in a normal program`, () => {
    const program = assertParse(`x = 5 + 2
y = x * 2
z = y + 1`)
    const identifiers = getIdentifiersInProgram(program)
    expect(identifiers).toEqual([
      identifier('x', 14, 15),
      identifier('y', 24, 25),
    ])
  })
})
