import { getTagDeclaratorsInProgram } from '@src/lang/queryAst/getTagDeclaratorsInProgram'
import { assertParse, initPromise } from '@src/lang/wasm'

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
      commentStart: start,
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
      assertParse(`sketch001 = startSketchOn(XZ)
profile001 = startProfileAt([0, 0], sketch001)
  |> angledLine(angle = 0, length = 11, tag = $a)`)
    )
    expect(tagDeclarators).toEqual([tagDeclaratorWithIndex('a', 123, 125, 1)])
  })
  it(`finds multiple tag declarators in a small program`, () => {
    const program = `sketch001 = startSketchOn(XZ)
profile001 = startProfileAt([0.07, 0], sketch001)
  |> angledLine(angle = 0, length = 11, tag = $a)
  |> angledLine(angle = segAng(a) + 90, length = 11.17, tag = $b)
  |> angledLine(angle = segAng(a), length = -segLen(a), tag = $c)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`
    const tagDeclarators = getTagDeclaratorsInProgram(assertParse(program))
    expect(tagDeclarators).toEqual([
      tagDeclaratorWithIndex('a', 126, 128, 1),
      tagDeclaratorWithIndex('b', 192, 194, 1),
      tagDeclaratorWithIndex('c', 258, 260, 1),
    ])
  })
  it(`finds tag declarators at different indices`, () => {
    const program = `sketch001 = startSketchOn(XZ)
profile001 = startProfileAt([0.07, 0], sketch001)
  |> angledLine(angle = 0, length = 11, tag = $a)
profile002 = angledLine(profile001, angle = segAng(a) + 90, length = 11.17, tag = $b)
  |> angledLine(angle = segAng(a), length = -segLen(a), tag = $c)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`
    const tagDeclarators = getTagDeclaratorsInProgram(assertParse(program))
    expect(tagDeclarators).toEqual([
      tagDeclaratorWithIndex('a', 126, 128, 1),
      tagDeclaratorWithIndex('b', 212, 214, 2),
      tagDeclaratorWithIndex('c', 278, 280, 2),
    ])
  })
})
