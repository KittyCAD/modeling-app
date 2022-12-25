import { abstractSyntaxTree } from './abstractSyntaxTree'
import { lexer } from './tokeniser'
import { executor, ViewerArtifact, processShownObjects } from './executor'

describe('findClosingBrace', () => {
  test('finds the closing brace', () => {
    const code = `
sketch mySketch001 {
  lineTo(-1.59, -1.54)
  lineTo(0.46, -5.82)
}
  |> rx(45, %)
show(mySketch001)`
    const programMemory = executor(abstractSyntaxTree(lexer(code)))
    const geos: ViewerArtifact[] =
      programMemory?.return?.flatMap(
        ({ name }: { name: string }) =>
          processShownObjects(programMemory, programMemory?.root?.[name]) || []
      ) || []
    const artifactsWithouGeos = removeGeo(geos)
    expect(artifactsWithouGeos).toEqual([
      {
        type: 'parent',
        sourceRange: [74, 83],
        children: [
          {
            type: 'sketch',
            sourceRange: [20, 68],
            children: [
              {
                type: 'sketchBase',
                sourceRange: [0, 0],
              },
              {
                type: 'sketchLine',
                sourceRange: [24, 44],
              },
              {
                type: 'sketchLine',
                sourceRange: [47, 66],
              },
            ],
          },
        ],
      },
    ])
  })
})

function removeGeo(arts: ViewerArtifact[]): any {
  return arts.map((art) => {
    if (art.type === 'sketchLine' || art.type === 'sketchBase') {
      const { geo, ...rest } = art
      return rest
    }
    if (art.type === 'parent') {
      return {
        ...art,
        children: removeGeo(art.children),
      }
    }
    if (art.type === 'sketch') {
      return {
        ...art,
        children: removeGeo(art.children),
      }
    }
    return art
  })
}
