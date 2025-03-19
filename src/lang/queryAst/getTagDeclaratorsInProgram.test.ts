import { assertParse, initPromise } from 'lang/wasm'
import { getTagDeclaratorsInProgram } from './getTagDeclaratorsInProgram'

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
    },
    bodyIndex,
  }
}

beforeAll(async () => {
  await initPromise
})

describe(`getTagDeclaratorsInProgram`, () => {
  it(`finds no tag declarators in an empty program`, () => {
    const tagDeclarators = getTagDeclaratorsInProgram(assertParse(''))
    expect(tagDeclarators).toEqual([])
  })
  it(`finds a single tag declarators in a small program`, () => {
    const tagDeclarators = getTagDeclaratorsInProgram(
      assertParse(`sketch001 = startSketchOn('XZ')
profile001 = startProfileAt([0, 0], sketch001)
  |> angledLine([0, 11], %, $a)`)
    )
    expect(tagDeclarators).toEqual([tagDeclaratorWithIndex('a', 107, 109, 1)])
  })
  it(`finds multiple tag declarators in a small program`, () => {
    const program = `sketch001 = startSketchOn('XZ')
profile001 = startProfileAt([0.07, 0], sketch001)
  |> angledLine([0, 11], %, $a)
  |> angledLine([segAng(a) + 90, 11.17], %, $b)
  |> angledLine([segAng(a), -segLen(a)], %, $c)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`
    const tagDeclarators = getTagDeclaratorsInProgram(assertParse(program))
    expect(tagDeclarators).toEqual([
      tagDeclaratorWithIndex('a', 110, 112, 1),
      tagDeclaratorWithIndex('b', 158, 160, 1),
      tagDeclaratorWithIndex('c', 206, 208, 1),
    ])
  })
  it(`finds tag declarators at different indices`, () => {
    const program = `sketch001 = startSketchOn('XZ')
profile001 = startProfileAt([0.07, 0], sketch001)
  |> angledLine([0, 11], %, $a)
profile002 = angledLine([segAng(a) + 90, 11.17], profile001, $b)
  |> angledLine([segAng(a), -segLen(a)], %, $c)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`
    const tagDeclarators = getTagDeclaratorsInProgram(assertParse(program))
    expect(tagDeclarators).toEqual([
      tagDeclaratorWithIndex('a', 110, 112, 1),
      tagDeclaratorWithIndex('b', 175, 177, 2),
      tagDeclaratorWithIndex('c', 223, 225, 2),
    ])
  })
})
