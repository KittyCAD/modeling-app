import { getTagDeclaratorsInProgram } from '@src/lang/queryAst/getTagDeclaratorsInProgram'
import { assertParse } from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'

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
profile001 = startProfile(sketch001, at = [0, 0])
  |> angledLine(angle = 0deg, length = 11, tag = $a)`)
    )
    expect(tagDeclarators).toEqual([tagDeclaratorWithIndex('a', 126, 128, 1)])
  })
  it(`finds multiple tag declarators in a small program`, () => {
    const program = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0.07, 0])
  |> angledLine(angle = 0deg, length = 11, tag = $a)
  |> angledLine(angle = segAng(a) + 90, length = 11.17, tag = $b)
  |> angledLine(angle = segAng(a), length = -segLen(a), tag = $c)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`
    const tagDeclarators = getTagDeclaratorsInProgram(assertParse(program))
    expect(tagDeclarators).toEqual([
      tagDeclaratorWithIndex('a', 129, 131, 1),
      tagDeclaratorWithIndex('b', 195, 197, 1),
      tagDeclaratorWithIndex('c', 261, 263, 1),
    ])
  })
  it(`finds tag declarators at different indices`, () => {
    const program = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0.07, 0])
  |> angledLine(angle = 0deg, length = 11, tag = $a)
profile002 = angledLine(profile001, angle = segAng(a) + 90, length = 11.17, tag = $b)
  |> angledLine(angle = segAng(a), length = -segLen(a), tag = $c)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`
    const tagDeclarators = getTagDeclaratorsInProgram(assertParse(program))
    expect(tagDeclarators).toEqual([
      tagDeclaratorWithIndex('a', 129, 131, 1),
      tagDeclaratorWithIndex('b', 215, 217, 2),
      tagDeclaratorWithIndex('c', 281, 283, 2),
    ])
  })
})
